import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CheckCircle2,
  Loader2,
  Clock,
  XCircle,
  Rocket,
  AlertTriangle,
  ChevronsDown,
} from 'lucide-react';
import type { DeployStep } from '../../types';
import type { DeployStepStreamState } from '../../hooks/usePipelineStream';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Steps that warrant a "taking a while" warning after 30 s */
const SLOW_STEP_IDS = new Set(['pods', 'health', 'portal']);

/** Knowledge-base suggestions keyed by the pattern they match in logs */
const CRASH_KB: Array<{ pattern: RegExp; fix: string }> = [
  {
    pattern: /CrashLoopBackOff/i,
    fix: 'Pod is crash-looping. Check image entrypoint, environment variables, and resource limits. Run `kubectl logs <pod> -n <namespace> --previous` for the last crash output.',
  },
  {
    pattern: /OOMKilled/i,
    fix: 'Pod was killed due to out-of-memory. Increase the memory limit in your Helm values (resources.limits.memory).',
  },
  {
    pattern: /ImagePullBackOff|ErrImagePull/i,
    fix: 'Kubernetes cannot pull the image. Verify the image tag exists in Harbor and the pull secret is correctly configured.',
  },
  {
    pattern: /Pending.*Insufficient/i,
    fix: 'Pod is stuck Pending due to insufficient cluster resources. Check node capacity with `kubectl describe node`.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

/** Scan a list of log lines for known crash patterns and return fix suggestions. */
function detectCrashKb(lines: string[]): string[] {
  const text = lines.join('\n');
  const fixes: string[] = [];
  for (const { pattern, fix } of CRASH_KB) {
    if (pattern.test(text)) fixes.push(fix);
  }
  return fixes;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Compact terminal-style log viewer for a deploy step.
 * Auto-scrolls to bottom with a sticky "jump to bottom" button.
 */
function DeployLogViewer({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [lines.length, userScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setUserScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 32);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setUserScrolledUp(false);
  }, []);

  if (lines.length === 0) return null;

  return (
    <div className="relative mt-2">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-[#0d1117] border border-gray-700/50 rounded-lg p-2 max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-0.5"
      >
        {lines.map((line, i) => {
          const lower = line.toLowerCase();
          const color =
            /error|fatal|fail|crash/.test(lower) ? 'text-red-400' :
            /warn/.test(lower)                   ? 'text-amber-400' :
            /success|completed|ready/.test(lower) ? 'text-emerald-400' :
            'text-gray-400';
          return (
            <div key={i} className={`whitespace-pre-wrap break-all ${color}`}>
              {line}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-1 right-1 flex items-center gap-1 bg-navy-700 border border-navy-500 text-cyan-400 hover:text-cyan-300 text-[10px] px-1.5 py-0.5 rounded-full shadow transition-colors"
        >
          <ChevronsDown className="w-2.5 h-2.5" />
          bottom
        </button>
      )}
    </div>
  );
}

/**
 * Single deploy step row with status icon, timing, optional log viewer,
 * slow-step warning, and crash KB suggestions.
 */
function DeployStepRow({
  step,
  streamState,
}: {
  step: DeployStep;
  streamState: DeployStepStreamState | undefined;
}) {
  // Prefer stream status when available
  const status = streamState?.status ?? step.status;
  const logs = streamState?.logs ?? [];
  const startedAt = streamState?.startedAt ?? null;
  const completedAt = streamState?.completedAt ?? null;

  // Live elapsed timer for running steps
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== 'running' || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  const elapsed = startedAt
    ? status === 'running'
      ? now - startedAt
      : completedAt
      ? completedAt - startedAt
      : null
    : null;

  const isRunning = status === 'running';
  const isSlowStep = SLOW_STEP_IDS.has(step.id);
  const elapsedSec = elapsed !== null ? Math.floor(elapsed / 1000) : 0;
  const showSlowWarning = isRunning && isSlowStep && elapsedSec >= 30;

  // Crash / error KB suggestions from logs
  const kbFixes = status === 'failed' || (isRunning && logs.length > 0)
    ? detectCrashKb(logs)
    : [];

  const Icon =
    status === 'completed' ? CheckCircle2 :
    status === 'failed'    ? XCircle :
    status === 'running'   ? Loader2 :
    Clock;

  const iconColor =
    status === 'completed' ? 'text-emerald-400' :
    status === 'failed'    ? 'text-red-400' :
    status === 'running'   ? 'text-cyan-400' :
    'text-gray-500';

  const rowBg =
    status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20' :
    status === 'failed'    ? 'bg-red-500/10 border-red-500/20' :
    status === 'running'   ? 'bg-cyan-500/5 border-cyan-500/30' :
    'bg-navy-700 border-navy-600';

  const labelColor =
    status === 'completed' ? 'text-gray-200' :
    status === 'running'   ? 'text-cyan-300' :
    status === 'failed'    ? 'text-red-300' :
    'text-gray-500';

  return (
    <div className={`rounded-lg border ${rowBg} p-3 transition-all duration-300`}>
      {/* Row header */}
      <div className="flex items-center gap-3">
        <Icon
          className={`w-5 h-5 flex-shrink-0 ${iconColor} ${isRunning ? 'animate-spin' : ''}`}
        />
        <span className={`text-sm font-medium flex-1 ${labelColor}`}>
          {step.label}
        </span>
        {elapsed !== null && (
          <span className="text-xs text-gray-500 font-mono tabular-nums shrink-0">
            {formatDuration(elapsed)}
          </span>
        )}
        {isRunning && (
          <span className="text-xs text-cyan-400 font-mono animate-pulse shrink-0">
            in progress
          </span>
        )}
      </div>

      {/* Log lines for this step (if any) */}
      {logs.length > 0 && <DeployLogViewer lines={logs} />}

      {/* Slow-step warning */}
      {showSlowWarning && (
        <div className="mt-2 flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            This step is taking longer than expected ({formatDuration(elapsed ?? 0)}).
            {step.id === 'pods' && ' Pods may be pulling images or waiting for cluster resources.'}
            {step.id === 'health' && ' Health checks may be misconfigured — verify your readiness probe path.'}
            {step.id === 'portal' && ' Portal registration may be waiting for the service endpoint to become ready.'}
          </span>
        </div>
      )}

      {/* Knowledge base crash suggestions */}
      {kbFixes.length > 0 && (
        <div className="mt-2 space-y-1">
          {kbFixes.map((fix, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5"
            >
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
              <span>{fix}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Step6Props {
  deploySteps: DeployStep[];
  isDeploying: boolean;
  error: string | null;
  /** Live deploy step states from SSE stream (optional — enhances the UI when present) */
  deployStreamStates?: Map<string, DeployStepStreamState>;
  /** Global deploy log lines from SSE stream (optional) */
  deployLogs?: string[];
}

export function Step6_Deploy({
  deploySteps,
  isDeploying,
  error,
  deployStreamStates,
  deployLogs = [],
}: Step6Props) {
  const completed = deploySteps.filter((s) => s.status === 'completed').length;
  const total = deploySteps.length;
  const progressPct = total > 0 ? (completed / total) * 100 : 0;

  // Detect crash patterns in the global deploy log
  const globalKbFixes = detectCrashKb(deployLogs);
  // Also check if CrashLoopBackOff appears anywhere
  const hasCrashLoop = /CrashLoopBackOff/i.test(deployLogs.join('\n'));

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Rocket className={`w-8 h-8 ${error ? 'text-red-400' : 'text-cyan-400'}`} />
          <h2 className="text-2xl font-bold text-gray-100">
            {error ? 'Deployment Failed' : isDeploying ? 'Deploying...' : 'Deploying...'}
          </h2>
        </div>
        <p className="text-gray-400">
          Provisioning resources on the SRE Platform
        </p>
      </div>

      {/* Overall progress bar */}
      <div className="max-w-xl mx-auto">
        <div className="progress-bar h-4 rounded-xl">
          <div
            className="progress-bar-fill rounded-xl"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-center text-sm text-gray-400 mt-2 font-mono">
          {Math.round(progressPct)}%
        </p>
      </div>

      {/* CrashLoopBackOff banner — shown immediately when detected */}
      {hasCrashLoop && (
        <div className="max-w-xl mx-auto bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-400 font-medium">CrashLoopBackOff detected</p>
            <p className="text-xs text-gray-400 mt-1">
              One or more pods are crash-looping. Check the logs below and verify your image
              entrypoint, environment variables, and resource limits.
            </p>
          </div>
        </div>
      )}

      {/* Deploy steps */}
      <div className="max-w-xl mx-auto space-y-3">
        {deploySteps.map((step) => (
          <DeployStepRow
            key={step.id}
            step={step}
            streamState={deployStreamStates?.get(step.id)}
          />
        ))}
      </div>

      {/* Global deploy log (stream) — shown only when there are logs not tied to a step */}
      {deployLogs.length > 0 && (
        <div className="max-w-xl mx-auto">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Deploy log
          </p>
          <DeployLogViewer lines={deployLogs} />
        </div>
      )}

      {/* Global KB fixes (when they come from stream logs, not step logs) */}
      {globalKbFixes.length > 0 && !hasCrashLoop && (
        <div className="max-w-xl mx-auto space-y-2">
          {globalKbFixes.map((fix, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>{fix}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="max-w-xl mx-auto bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
