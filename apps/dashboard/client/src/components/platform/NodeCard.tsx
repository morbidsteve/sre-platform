import React from 'react';
import type { PlatformNode } from '../../api/platform';

interface NodeCardProps {
  node: PlatformNode;
}

function UsageBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-[#1a2035] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(Math.max(pct, 2), 100)}%` }}
      />
    </div>
  );
}

function cpuBarColor(pct: number): string {
  if (pct > 85) return 'bg-red';
  if (pct > 65) return 'bg-yellow';
  return 'bg-green';
}

function memBarColor(pct: number): string {
  if (pct > 85) return 'bg-red';
  if (pct > 70) return 'bg-yellow';
  return 'bg-[#60a5fa]';
}

export function PlatformNodeCard({ node }: NodeCardProps) {
  const isReady = node.status === 'Ready';
  const borderColor = isReady ? 'border-green/30' : 'border-red/40';
  const statusColor = isReady ? 'text-green' : 'text-red';
  const dotColor = isReady ? 'bg-green' : 'bg-red';
  const cpuPct = node.cpu?.pct ?? 0;
  const memPct = node.memory?.pct ?? 0;

  return (
    <div className={`bg-[#0d1117] border ${borderColor} rounded-lg p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`}
            style={isReady ? { boxShadow: '0 0 5px var(--green)' } : undefined}
          />
          <span className="text-sm font-semibold text-text-bright font-mono truncate">{node.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {(Array.isArray(node.roles) ? node.roles : (node.roles || '').split(',').filter(Boolean)).map((role) => (
            <span
              key={role}
              className={`text-[9px] font-mono font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                role === 'control-plane' || role === 'etcd'
                  ? 'bg-[#3b82f6]/15 text-[#3b82f6]'
                  : 'bg-green/10 text-green'
              }`}
            >
              {role === 'control-plane' ? 'CP' : role === 'worker' ? 'W' : role}
            </span>
          ))}
          {node.unschedulable && (
            <span className="text-[9px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-red/15 text-red">
              CORDONED
            </span>
          )}
          <span className={`text-[10px] font-mono font-semibold ${statusColor}`}>{node.status}</span>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-text-dim">
        {node.ip && <span>{node.ip}</span>}
        {node.kubelet && <span>{node.kubelet}</span>}
        {node.age && <span>up {node.age}</span>}
        <span className="text-text-muted">
          {node.pods?.count ?? 0}/{node.pods?.allocatable ?? '?'} pods
        </span>
      </div>

      {/* CPU */}
      <div>
        <div className="flex items-center justify-between text-[9px] font-mono mb-1">
          <span className="text-text-dim uppercase tracking-wide">CPU</span>
          <span className="text-text-primary">
            {node.cpu?.usedFmt ?? '0'} / {node.cpu?.allocFmt ?? '?'} ({cpuPct}%)
          </span>
        </div>
        <UsageBar pct={cpuPct} color={cpuBarColor(cpuPct)} />
      </div>

      {/* Memory */}
      <div>
        <div className="flex items-center justify-between text-[9px] font-mono mb-1">
          <span className="text-text-dim uppercase tracking-wide">MEM</span>
          <span className="text-text-primary">
            {node.memory?.usedFmt ?? '0'} / {node.memory?.allocFmt ?? '?'} ({memPct}%)
          </span>
        </div>
        <UsageBar pct={memPct} color={memBarColor(memPct)} />
      </div>
    </div>
  );
}
