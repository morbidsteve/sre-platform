import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  SkipForward,
  Clock,
  Wifi,
  WifiOff,
  ChevronsDown,
} from 'lucide-react';
import { usePipelineStream, type GateStreamState } from '../../hooks/usePipelineStream';
import type { SecurityGate } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const GATE_LABELS: Record<string, string> = {
  SAST: 'SAST (Semgrep)',
  SECRETS: 'Secrets (Gitleaks)',
  ARTIFACT_STORE: 'Build (Kaniko)',
  SBOM: 'SBOM (Trivy)',
  CVE: 'CVE Scan (Trivy)',
  DAST: 'DAST (ZAP)',
  ISSM_REVIEW: 'ISSM Review',
  IMAGE_SIGNING: 'Image Signing',
};

function statusIcon(status: string) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />;
    case 'skipped':
      return <SkipForward className="w-4 h-4 text-gray-500 shrink-0" />;
    default:
      return <Clock className="w-4 h-4 text-gray-600 shrink-0" />;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'passed':   return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'failed':   return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'warning':  return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'running':  return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    case 'skipped':  return 'text-gray-500 bg-gray-800 border-gray-700';
    default:         return 'text-gray-600 bg-gray-800/50 border-gray-700/50';
  }
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return 'text-red-400';
    case 'high':     return 'text-orange-400';
    case 'warning':
    case 'medium':   return 'text-amber-400';
    default:         return 'text-blue-400';
  }
}

/**
 * Formats an elapsed duration (in milliseconds) to a compact human string.
 * e.g. 45000 → "45s", 125000 → "2m 5s"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ── Log line coloriser ────────────────────────────────────────────────────────

/** Returns a Tailwind text-color class for a raw log line. */
function logLineColor(line: string): string {
  const lower = line.toLowerCase();
  if (/error|fatal|fail/.test(lower)) return 'text-red-400';
  if (/\bwarn(ing)?\b/.test(lower))    return 'text-amber-400';
  if (/--- scan complete ---|passed/.test(lower)) return 'text-emerald-400';
  // git-clone / kaniko step prefix
  if (/^\[git-clone\]|^\[kaniko\]/.test(line))   return ''; // handled separately
  // Timestamp-looking prefix (ISO-ish or HH:MM:SS)
  if (/^\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/.test(line)) return 'text-gray-500';
  return 'text-gray-300';
}

/**
 * Renders a single log line, handling the special [git-clone] / [kaniko]
 * prefix colour separately from the rest of the text.
 */
function LogLine({ line, index }: { line: string; index: number }) {
  const prefixMatch = line.match(/^(\[(git-clone|kaniko)\])\s*/);

  return (
    <div className="flex gap-2 min-w-0">
      {/* Line number */}
      <span className="select-none text-gray-600 shrink-0 w-8 text-right">{index + 1}</span>
      {/* Content */}
      {prefixMatch ? (
        <span className="min-w-0 break-all whitespace-pre-wrap">
          <span className="text-cyan-400 font-semibold">{prefixMatch[1]}</span>
          <span className="text-gray-200">{line.slice(prefixMatch[0].length)}</span>
        </span>
      ) : (
        <span className={`min-w-0 break-all whitespace-pre-wrap ${logLineColor(line)}`}>
          {line}
        </span>
      )}
    </div>
  );
}

// ── Auto-scrolling terminal log viewer ───────────────────────────────────────

function LogViewer({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Scroll to bottom when new lines arrive, unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [lines.length, userScrolledUp]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setUserScrolledUp(!atBottom);
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
        className="bg-[#0d1117] border border-gray-700/50 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5"
      >
        {lines.map((line, i) => (
          <LogLine key={i} line={line} index={i} />
        ))}
        <div ref={bottomRef} />
      </div>
      {/* Scroll-to-bottom button — only shown when user has scrolled up */}
      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 flex items-center gap-1 bg-navy-700 border border-navy-500 text-cyan-400 hover:text-cyan-300 text-xs px-2 py-1 rounded-full shadow-lg transition-colors"
        >
          <ChevronsDown className="w-3 h-3" />
          bottom
        </button>
      )}
      {/* Line count */}
      <p className="text-right text-[10px] text-gray-600 mt-0.5 font-mono">
        {lines.length} line{lines.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, status }: { value: number; status: string }) {
  const color =
    status === 'passed'  ? 'bg-emerald-500' :
    status === 'failed'  ? 'bg-red-500' :
    status === 'warning' ? 'bg-amber-500' :
    status === 'running' ? 'bg-cyan-500' : 'bg-gray-600';

  return (
    <div className="w-full bg-gray-800 rounded-full h-1 mt-2">
      <div
        className={`${color} h-1 rounded-full transition-all duration-500`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ── Live elapsed timer ─────────────────────────────────────────────────────

/**
 * Shows elapsed time for a running gate, ticking every second.
 * For completed gates, shows a static final duration.
 */
function GateTiming({
  status,
  startedAt,
  completedAt,
}: {
  status: string;
  startedAt: number | null;
  completedAt: number | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== 'running' || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  if (!startedAt) return null;

  const elapsed = status === 'running'
    ? now - startedAt
    : completedAt
    ? completedAt - startedAt
    : null;

  if (elapsed === null) return null;

  return (
    <span className="text-xs text-gray-500 font-mono tabular-nums shrink-0">
      {formatDuration(elapsed)}
    </span>
  );
}

// ── Single gate row ───────────────────────────────────────────────────────────

function GateStreamRow({
  gateName,
  streamState,
  staticGate,
}: {
  gateName: string;
  streamState: GateStreamState | undefined;
  staticGate: SecurityGate | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  // Merge stream state with static gate data (stream wins when available)
  const status =
    streamState?.status ?? staticGate?.status ?? 'pending';
  const summary =
    streamState?.summary ?? staticGate?.summary ?? '';
  const progress =
    streamState?.progress ?? staticGate?.progress ?? 0;
  const logs = streamState?.logs ?? [];
  const streamFindings = streamState?.findings ?? [];
  const startedAt = streamState?.startedAt ?? null;
  const completedAt = streamState?.completedAt ?? null;

  // Use stream findings when present; fall back to gate findings from polling
  const displayFindings =
    streamFindings.length > 0
      ? streamFindings
      : (staticGate?.findings ?? []).map((f) => ({
          severity: f.severity,
          title: f.title,
          location: f.location ?? '',
        }));

  const isActive = status === 'running';
  const hasContent = logs.length > 0 || displayFindings.length > 0 || summary;
  const label = GATE_LABELS[gateName] ?? gateName;

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive
          ? 'border-cyan-500/40 bg-cyan-500/5'
          : status === 'passed'
          ? 'border-emerald-500/20 bg-navy-800/60'
          : status === 'failed'
          ? 'border-red-500/20 bg-red-500/5'
          : status === 'warning'
          ? 'border-amber-500/20 bg-amber-500/5'
          : 'border-navy-600 bg-navy-800/40'
      }`}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => hasContent && setExpanded((v) => !v)}
        disabled={!hasContent}
      >
        {statusIcon(status)}
        <span
          className={`flex-1 text-sm font-medium ${
            status === 'pending' ? 'text-gray-500' : 'text-gray-200'
          }`}
        >
          {label}
        </span>
        {/* Timing */}
        <GateTiming status={status} startedAt={startedAt} completedAt={completedAt} />
        {displayFindings.length > 0 && (
          <span className="text-xs text-gray-500">
            {displayFindings.length} finding{displayFindings.length !== 1 ? 's' : ''}
          </span>
        )}
        <span
          className={`text-xs px-2 py-0.5 rounded border font-medium ${statusBadgeClass(status)}`}
        >
          {status}
        </span>
        {hasContent && (
          expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        )}
      </button>

      {/* Progress bar (running or partially done) */}
      {(status === 'running' || (status !== 'pending' && progress > 0 && progress < 100)) && (
        <div className="px-3 pb-1">
          <ProgressBar value={progress} status={status} />
        </div>
      )}

      {/* Expanded content */}
      {expanded && hasContent && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-700/40 pt-2">
          {summary && (
            <p className="text-xs text-gray-400">{summary}</p>
          )}
          {displayFindings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                Findings
              </p>
              {displayFindings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`font-medium uppercase shrink-0 ${severityColor(f.severity)}`}>
                    {f.severity.substring(0, 4)}
                  </span>
                  <span className="text-gray-300 truncate">{f.title}</span>
                  {f.location && (
                    <span className="text-gray-500 shrink-0 font-mono">{f.location}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <LogViewer lines={logs} />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PipelineStreamProps {
  /** The pipeline run ID to connect to */
  runId: string | null | undefined;
  /** Current gate state from the polling mechanism (used as fallback) */
  gates: SecurityGate[];
}

/**
 * PipelineStream — terminal-style live feed of pipeline gate execution.
 *
 * This is an additive enhancement: it subscribes to the SSE stream and shows
 * live logs / gate statuses. The existing polling mechanism continues to work
 * alongside it; stream state takes priority when available.
 */
export function PipelineStream({ runId, gates }: PipelineStreamProps) {
  const stream = usePipelineStream(runId);

  // Build ordered gate list from polled gates (preserves gate_order)
  const orderedGateNames = gates.map((g) => g.shortName);
  // Also include any gate names seen in the stream that aren't in the polled list
  const streamGateNames = Array.from(stream.gates.keys());
  const allGateNames = [
    ...orderedGateNames,
    ...streamGateNames.filter((n) => !orderedGateNames.includes(n)),
  ];

  // Build a map from shortName → SecurityGate for fast lookup
  const gateByShortName = new Map<string, SecurityGate>();
  for (const g of gates) {
    gateByShortName.set(g.shortName, g);
  }

  return (
    <div className="bg-navy-900 border border-navy-600 rounded-xl overflow-hidden">
      {/* Terminal chrome header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-navy-800/80 border-b border-navy-700">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          <span className="ml-2 text-xs font-mono text-gray-400">pipeline live feed</span>
        </div>
        {/* Connection status indicator */}
        <div className="flex items-center gap-1.5">
          {stream.done ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              scan complete
            </span>
          ) : stream.connected ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              connected
            </span>
          ) : runId ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <WifiOff className="w-3 h-3" />
              connecting...
            </span>
          ) : (
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              disconnected
            </span>
          )}
        </div>
      </div>

      {/* Gate rows */}
      <div className="p-3 space-y-2">
        {allGateNames.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">
            Waiting for pipeline to start...
          </p>
        ) : (
          allGateNames.map((gateName) => (
            <GateStreamRow
              key={gateName}
              gateName={gateName}
              streamState={stream.gates.get(gateName)}
              staticGate={gateByShortName.get(gateName)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {stream.pipelineStatus && (
        <div className="px-4 py-2 bg-navy-800/60 border-t border-navy-700 text-xs text-gray-500 font-mono">
          pipeline → {stream.pipelineStatus}
        </div>
      )}
    </div>
  );
}
