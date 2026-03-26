import React, { useRef, useEffect, useState } from 'react';
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

// ── Auto-scrolling log viewer ─────────────────────────────────────────────────

function LogViewer({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [lines.length]);

  if (lines.length === 0) return null;

  return (
    <div className="mt-2 bg-[#0d1117] border border-gray-700/50 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs text-gray-300 leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">
          {line}
        </div>
      ))}
      <div ref={bottomRef} />
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

      {/* Progress bar */}
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-navy-800/80 border-b border-navy-700">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          <span className="ml-2 text-xs font-mono text-gray-400">pipeline live feed</span>
        </div>
        <div className="flex items-center gap-1.5">
          {stream.done ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              scan complete
            </span>
          ) : stream.connected ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              live
            </span>
          ) : runId ? (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <WifiOff className="w-3 h-3" />
              connecting...
            </span>
          ) : null}
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
