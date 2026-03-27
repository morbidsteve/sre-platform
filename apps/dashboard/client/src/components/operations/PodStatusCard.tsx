import React from 'react';
import { Server, RefreshCw, AlertCircle } from 'lucide-react';
import type { OpsPodStatus } from '../../api/ops';

interface PodStatusCardProps {
  pod: OpsPodStatus;
}

function phaseColor(phase: string, ready: boolean): string {
  if (ready && phase === 'Running') return 'border-green/30 bg-green/5';
  if (phase === 'Running' && !ready) return 'border-yellow/30 bg-yellow/5';
  if (phase === 'Failed' || phase === 'CrashLoopBackOff') return 'border-red/30 bg-red/5';
  if (phase === 'Pending') return 'border-yellow/30 bg-yellow/5';
  return 'border-border bg-surface';
}

function phaseTextColor(phase: string, ready: boolean): string {
  if (ready && phase === 'Running') return 'text-green';
  if (phase === 'Running' && !ready) return 'text-yellow';
  if (phase === 'Failed' || phase === 'CrashLoopBackOff') return 'text-red';
  if (phase === 'Pending') return 'text-yellow';
  return 'text-text-dim';
}

function StatusDot({ ready, phase }: { ready: boolean; phase: string }) {
  const color =
    ready && phase === 'Running'
      ? 'bg-green'
      : phase === 'Pending' || (phase === 'Running' && !ready)
      ? 'bg-yellow'
      : 'bg-red';
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`}
      style={ready && phase === 'Running' ? { boxShadow: '0 0 4px var(--green)' } : undefined}
    />
  );
}

export function PodStatusCard({ pod }: PodStatusCardProps) {
  const cardClass = phaseColor(pod.phase, pod.ready);
  const phaseClass = phaseTextColor(pod.phase, pod.ready);

  // Shorten pod name for display — trim the replicaset/deploy hash suffix
  const shortName = pod.name.replace(/-[a-z0-9]{5,10}-[a-z0-9]{5}$/, '-…') || pod.name;

  return (
    <div className={`border rounded-[var(--radius)] p-3 ${cardClass}`}>
      {/* Name + status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot ready={pod.ready} phase={pod.phase} />
          <span
            className="text-[11px] font-mono text-text-primary truncate"
            title={pod.name}
          >
            {shortName}
          </span>
        </div>
        <span className={`text-[10px] font-mono font-semibold flex-shrink-0 ${phaseClass}`}>
          {pod.phase}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-x-2 text-[10px] font-mono text-text-dim">
        <div className="flex flex-col gap-0.5">
          <span className="text-text-muted uppercase tracking-wide text-[9px]">Ready</span>
          <span className={pod.ready ? 'text-green' : 'text-yellow'}>
            {pod.readyContainers}/{pod.totalContainers}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-text-muted uppercase tracking-wide text-[9px]">Restarts</span>
          <span className={pod.restarts > 0 ? 'text-yellow' : 'text-text-dim'}>
            {pod.restarts > 0 ? (
              <span className="flex items-center gap-0.5">
                <RefreshCw className="w-2.5 h-2.5" />
                {pod.restarts}
              </span>
            ) : (
              '0'
            )}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-text-muted uppercase tracking-wide text-[9px]">Age</span>
          <span>{pod.age}</span>
        </div>
      </div>

      {/* Node */}
      {pod.node && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-text-muted">
          <Server className="w-2.5 h-2.5" />
          <span className="truncate">{pod.node}</span>
        </div>
      )}

      {/* Warning indicator for crash loop */}
      {pod.restarts > 3 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-red">
          <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
          <span>Possible crash loop ({pod.restarts} restarts)</span>
        </div>
      )}
    </div>
  );
}
