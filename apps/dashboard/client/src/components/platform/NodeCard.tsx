import React, { useState } from 'react';
import type { PlatformNode } from '../../api/platform';
import { NodeDetailSlideOut } from './DetailSlideOut';

interface NodeCardProps {
  node: PlatformNode;
}

const HUD_ACCENT = '#00ff88';
const HUD_AMBER = '#ffaa00';
const HUD_RED = '#ff3344';
const HUD_DIM_GREEN = '#1a3a2a';
const HUD_TEXT = '#c8ffd8';
const HUD_LABEL = '#4a7a5a';

function barColor(pct: number, highThresh: number, warnThresh: number): string {
  if (pct > highThresh) return HUD_RED;
  if (pct > warnThresh) return HUD_AMBER;
  return HUD_ACCENT;
}

function UsageBar({ pct, high, warn }: { pct: number; high: number; warn: number }) {
  const color = barColor(pct, high, warn);
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#0a1a10' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(Math.max(pct, 2), 100)}%`,
          background: color,
          boxShadow: `0 0 4px ${color}`,
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
  const dotColor = isReady ? HUD_ACCENT : HUD_RED;
  const borderColor = isReady ? 'rgba(0,255,136,0.15)' : 'rgba(255,51,68,0.25)';
  const hoverBorder = isReady ? 'rgba(0,255,136,0.35)' : 'rgba(255,51,68,0.45)';

  return (
    <>
      <div
        className="flex flex-col gap-2.5 p-3 rounded cursor-pointer transition-all duration-150 group"
        style={{
          background: '#080c12',
          border: `1px solid ${borderColor}`,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.border = `1px solid ${hoverBorder}`; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 12px ${isReady ? 'rgba(0,255,136,0.08)' : 'rgba(255,51,68,0.08)'}`; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.border = `1px solid ${borderColor}`; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
        onClick={() => setShowDetail(true)}
        title="Click for node details"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={isReady ? 'hud-pulse-green' : 'hud-pulse-red'}
              style={{
                display: 'inline-block',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: dotColor,
                flexShrink: 0,
              }}
            />
            <span className="text-[11px] font-mono font-bold truncate" style={{ color: HUD_TEXT }}>
              {node.name}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {(Array.isArray(node.roles) ? node.roles : String(node.roles || '').split(',').filter(Boolean)).map((role) => (
              <span
                key={role}
                className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  color: role === 'control-plane' || role === 'etcd' ? '#60a5fa' : HUD_ACCENT,
                  background: role === 'control-plane' || role === 'etcd' ? 'rgba(96,165,250,0.1)' : 'rgba(0,255,136,0.07)',
                  border: `1px solid ${role === 'control-plane' || role === 'etcd' ? 'rgba(96,165,250,0.2)' : 'rgba(0,255,136,0.15)'}`,
                }}
              >
                {role === 'control-plane' ? 'CP' : role === 'worker' ? 'W' : role}
              </span>
            ))}
            {node.unschedulable && (
              <span
                className="text-[8px] font-mono font-bold uppercase px-1.5 py-0.5 rounded"
                style={{ color: HUD_RED, background: 'rgba(255,51,68,0.1)', border: '1px solid rgba(255,51,68,0.2)' }}
              >
                CORD
              </span>
            )}
          </div>
        </div>

        {/* Status tag */}
        <div className="flex items-center justify-between text-[9px] font-mono">
          <span style={{ color: HUD_LABEL }}>
            {node.ip && <span className="mr-2">{node.ip}</span>}
            {node.kubelet && <span>{node.kubelet}</span>}
          </span>
          <span style={{ color: HUD_LABEL }}>
            {node.pods?.count ?? 0}/{node.pods?.allocatable ?? '?'} pods
          </span>
        </div>

        {/* CPU */}
        <div>
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span style={{ color: HUD_LABEL }} className="uppercase tracking-widest">CPU</span>
            <span style={{ color: barColor(cpuPct, 85, 65) }}>
              {node.cpu?.usedFmt ?? '0'} / {node.cpu?.allocFmt ?? '?'} · {cpuPct}%
            </span>
          </div>
          <UsageBar pct={cpuPct} high={85} warn={65} />
        </div>

        {/* MEM */}
        <div>
          <div className="flex items-center justify-between text-[9px] font-mono mb-1">
            <span style={{ color: HUD_LABEL }} className="uppercase tracking-widest">MEM</span>
            <span style={{ color: barColor(memPct, 85, 70) }}>
              {node.memory?.usedFmt ?? '0'} / {node.memory?.allocFmt ?? '?'} · {memPct}%
            </span>
          </div>
          <UsageBar pct={memPct} high={85} warn={70} />
        </div>

        {/* Click hint */}
        <div
          className="text-[8px] font-mono uppercase tracking-widest text-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: HUD_ACCENT }}
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
