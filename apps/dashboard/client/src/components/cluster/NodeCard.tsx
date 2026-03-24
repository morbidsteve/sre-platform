import React from 'react';
import { StatusDot } from '../ui/StatusDot';
import { Badge } from '../ui/Badge';
import { UsageBar } from '../ui/UsageBar';
import type { ClusterNodeDetail } from '../../types/api';

interface NodeCardProps {
  node: ClusterNodeDetail;
}

export function NodeCard({ node }: NodeCardProps) {
  const statusColor = node.status === 'Ready' ? 'green' : 'red';
  const cpuPct = node.cpu?.pct ?? 0;
  const memPct = node.memory?.pct ?? 0;

  return (
    <div className="card-base p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusDot color={statusColor as 'green' | 'red'} />
          <h4 className="text-sm font-semibold text-text-primary">{node.name}</h4>
          {node.roles.map((role) => (
            <span
              key={role}
              className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                role === 'control-plane' || role === 'etcd'
                  ? 'bg-accent/15 text-accent'
                  : 'bg-green/15 text-green'
              }`}
            >
              {role}
            </span>
          ))}
        </div>
        {node.unschedulable && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red/15 text-red">
            CORDONED
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim mb-3">
        {node.kubelet && <span>{node.kubelet}</span>}
        {node.os && <span>{node.os}</span>}
        {node.runtime && <span>{node.runtime}</span>}
        {node.ip && <span className="font-mono">{node.ip}</span>}
        {node.age && <span>Age: {node.age}</span>}
      </div>

      {/* Usage Bars */}
      <UsageBar
        label="CPU"
        used={cpuPct}
        total={100}
        unit="%"
      />
      <div className="text-[10px] text-text-dim -mt-2 mb-2">
        {node.cpu?.usedFmt ?? '0'} / {node.cpu?.allocFmt ?? '?'}
      </div>
      <UsageBar
        label="Memory"
        used={memPct}
        total={100}
        unit="%"
      />
      <div className="text-[10px] text-text-dim -mt-2 mb-2">
        {node.memory?.usedFmt ?? '0'} / {node.memory?.allocFmt ?? '?'}
      </div>

      {/* Conditions */}
      <div className="flex flex-wrap gap-1 mt-2">
        {node.conditions.map((c) => {
          const ok =
            (c.type === 'Ready' && c.status === 'True') ||
            (c.type !== 'Ready' && c.status === 'False');
          return (
            <Badge key={c.type} variant={ok ? 'green' : 'yellow'}>
              {c.type}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
