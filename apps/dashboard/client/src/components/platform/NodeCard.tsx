import React, { useState } from 'react';
import type { PlatformNode } from '../../api/platform';
import { NodeDetailSlideOut } from './DetailSlideOut';

interface NodeCardProps {
  node: PlatformNode;
}

function barColor(pct: number, highThresh: number, warnThresh: number): string {
  if (pct > highThresh) return 'var(--red)';
  if (pct > warnThresh) return 'var(--yellow)';
  return 'var(--green)';
}

function UsageBar({ pct, high, warn }: { pct: number; high: number; warn: number }) {
  const color = barColor(pct, high, warn);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(Math.max(pct, 2), 100)}%`,
          background: color,
        }}
      />
    </div>
  );
}

export function PlatformNodeCard({ node }: NodeCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const isReady = node.status === 'Ready';
  const cpuPct = node.cpu?.pct ?? 0;
  const memPct = node.memory?.pct ?? 0;
  const dotColor = isReady ? 'var(--green)' : 'var(--red)';
  const borderColor = 'var(--border)';
  const hoverBorder = isReady ? 'var(--border-hover)' : 'rgba(248,113,113,0.4)';

  return (
    <>
      <div
        className="flex flex-col gap-2.5 p-3 rounded cursor-pointer transition-all duration-150 group"
        style={{
          background: 'var(--surface)',
          border: `1px solid ${borderColor}`,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = hoverBorder; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = borderColor; }}
        onClick={() => setShowDetail(true)}
        title="Click for node details"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              style={{
                display: 'inline-block',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: dotColor,
                flexShrink: 0,
              }}
            />
            <span className="text-[11px] font-mono font-bold truncate" style={{ color: 'var(--text-bright)' }}>
              {node.name}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {(Array.isArray(node.roles) ? node.roles : String(node.roles || '').split(',').filter(Boolean)).map((role) => (
              <span
                key={role}
                className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  color: role === 'control-plane' || role === 'etcd' ? '#60a5fa' : 'var(--green)',
                  background: role === 'control-plane' || role === 'etcd' ? 'rgba(96,165,250,0.1)' : 'rgba(52,211,153,0.1)',
                  border: `1px solid ${role === 'control-plane' || role === 'etcd' ? 'rgba(96,165,250,0.25)' : 'rgba(52,211,153,0.25)'}`,
                }}
              >
                {role === 'control-plane' ? 'CP' : role === 'worker' ? 'W' : role}
              </span>
            ))}
            {node.unschedulable && (
              <span
                className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded"
                style={{ color: 'var(--red)', background: 'rgba(255,51,68,0.1)', border: '1px solid rgba(255,51,68,0.2)' }}
              >
                CORD
              </span>
            )}
          </div>
        </div>

        {/* Status tag */}
        <div className="flex items-center justify-between text-[9px] font-mono">
          <span style={{ color: 'var(--text-dim)' }}>
            {node.ip && <span className="mr-2">{node.ip}</span>}
            {node.kubelet && <span>{node.kubelet}</span>}
          </span>
          <span style={{ color: 'var(--text-dim)' }}>
            {node.pods?.count ?? 0}/{node.pods?.allocatable ?? '?'} pods
          </span>
        </div>

        {/* CPU */}
        <div>
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span style={{ color: 'var(--text-dim)' }} className="uppercase tracking-widest">CPU</span>
            <span style={{ color: barColor(cpuPct, 85, 65) }}>
              {node.cpu?.usedFmt ?? '0'} / {node.cpu?.allocFmt ?? '?'} · {cpuPct}%
            </span>
          </div>
          <UsageBar pct={cpuPct} high={85} warn={65} />
        </div>

        {/* MEM */}
        <div>
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span style={{ color: 'var(--text-dim)' }} className="uppercase tracking-widest">MEM</span>
            <span style={{ color: barColor(memPct, 85, 70) }}>
              {node.memory?.usedFmt ?? '0'} / {node.memory?.allocFmt ?? '?'} · {memPct}%
            </span>
          </div>
          <UsageBar pct={memPct} high={85} warn={70} />
        </div>

        {/* Click hint */}
        <div
          className="text-[8px] font-mono uppercase tracking-widest text-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--text-dim)' }}
        >
          ▶ DETAILS
        </div>
      </div>

      {showDetail && (
        <NodeDetailSlideOut node={node} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
