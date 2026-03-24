import React from 'react';
import { EmptyState } from '../ui/EmptyState';
import type { PipelineRun } from '../../types/api';

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    scanning: 'bg-accent/15 text-accent',
    pending: 'bg-surface text-text-dim',
    review_pending: 'bg-yellow/15 text-yellow',
    approved: 'bg-green/15 text-green',
    deployed: 'bg-green/15 text-green',
    rejected: 'bg-red/15 text-red',
    failed: 'bg-red/15 text-red',
    deploying: 'bg-accent/15 text-accent',
  };
  return map[status] || 'bg-surface text-text-dim';
}

function gateCircleColor(status: string): string {
  if (status === 'passed') return 'var(--green)';
  if (status === 'warning') return 'var(--yellow)';
  if (status === 'failed') return 'var(--red)';
  if (status === 'running') return 'var(--accent)';
  return 'var(--border)';
}

interface PipelineTableProps {
  runs: PipelineRun[];
  onSelectRun: (id: string) => void;
  totalCount: number;
}

export function PipelineTable({ runs, onSelectRun, totalCount }: PipelineTableProps) {
  if (runs.length === 0) {
    return <EmptyState title="No pipeline runs found" description="No runs match the current filters." />;
  }

  return (
    <div className="card-base overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Pipeline Runs</h2>
        <span className="text-xs text-text-dim">{totalCount} run{totalCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 px-3 text-text-dim font-medium text-xs">App Name</th>
              <th className="py-2 px-3 text-text-dim font-medium text-xs">Team</th>
              <th className="py-2 px-3 text-text-dim font-medium text-xs">Status</th>
              <th className="py-2 px-3 text-text-dim font-medium text-xs">Classification</th>
              <th className="py-2 px-3 text-text-dim font-medium text-xs">Created</th>
              <th className="py-2 px-3 text-text-dim font-medium text-xs">Gates</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const gates = run.gates || [];
              const passed = gates.filter((g) => g.status === 'passed').length;

              return (
                <tr
                  key={run.id}
                  className="border-b border-border hover:bg-surface/50 cursor-pointer transition-colors"
                  onClick={() => onSelectRun(run.id)}
                >
                  <td className="py-2 px-3 font-semibold text-text-primary">{run.app_name || '--'}</td>
                  <td className="py-2 px-3 text-text-dim">{run.team || '--'}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${statusBadgeClass(run.status)}`}>
                      {(run.status || 'pending').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-surface text-text-dim border border-border">
                      {run.classification || 'Unclassified'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-text-dim">{timeAgo(run.created_at)}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-0.5">
                      {gates.map((g, i) => (
                        <span
                          key={i}
                          className={`inline-block w-2.5 h-2.5 rounded-full ${g.status === 'running' ? 'animate-pulse' : ''}`}
                          style={{ background: gateCircleColor(g.status) }}
                          title={`${g.short_name || g.name}: ${g.status}`}
                        />
                      ))}
                      {gates.length > 0 && (
                        <span className="text-[11px] text-text-dim ml-1">{passed}/{gates.length}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
