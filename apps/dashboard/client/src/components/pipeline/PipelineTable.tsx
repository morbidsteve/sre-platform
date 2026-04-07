import React, { useState } from 'react';
import { Trash2, RotateCcw, XCircle } from 'lucide-react';
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
    pending: 'bg-[var(--color-surface)] text-text-dim',
    review_pending: 'bg-yellow/15 text-yellow',
    approved: 'bg-green/15 text-green',
    deployed: 'bg-green/15 text-green',
    rejected: 'bg-red/15 text-red',
    failed: 'bg-red/15 text-red',
    deploying: 'bg-accent/15 text-accent',
    deployed_unhealthy: 'bg-red/15 text-red',
    deployed_partial: 'bg-yellow/15 text-yellow',
    cancelled: 'bg-[var(--color-surface)] text-text-dim',
    undeployed: 'bg-[var(--color-surface)] text-text-dim',
  };
  return map[status] || 'bg-[var(--color-surface)] text-text-dim';
}

function gateCircleColor(status: string): string {
  if (status === 'passed') return 'var(--green)';
  if (status === 'warning') return 'var(--yellow)';
  if (status === 'failed') return 'var(--red)';
  if (status === 'running') return 'var(--accent)';
  return 'var(--border)';
}

type SortField = 'app_name' | 'team' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

function SortHeader({ field, label, current, dir, onToggle }: {
  field: SortField; label: string; current: SortField; dir: SortDir; onToggle: (f: SortField) => void;
}) {
  return (
    <th
      className="text-left text-[11px] text-text-dim font-medium px-3 py-2 cursor-pointer hover:text-text-primary select-none"
      onClick={() => onToggle(field)}
    >
      {label}
      {current === field && (
        <span className="ml-1">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  );
}

interface PipelineTableProps {
  runs: PipelineRun[];
  onSelectRun: (id: string) => void;
  onDeleteRun?: (run: PipelineRun) => void;
  onRetryRun?: (run: PipelineRun) => void;
  onCancelRun?: (run: PipelineRun) => void;
  totalCount: number;
}

export function PipelineTable({ runs, onSelectRun, onDeleteRun, onRetryRun, onCancelRun, totalCount }: PipelineTableProps) {
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedRuns = [...runs].sort((a, b) => {
    const aVal = (a as any)[sortField] || '';
    const bVal = (b as any)[sortField] || '';
    const cmp = String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (runs.length === 0) {
    return <EmptyState title="No pipeline runs found" description="No runs match the current filters." />;
  }

  const hasActions = onDeleteRun || onRetryRun || onCancelRun;
  const cancellableStatuses = ['pending', 'scanning', 'review_pending'];
  const retryableStatuses = ['failed', 'cancelled'];

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
              <SortHeader field="app_name" label="App Name" current={sortField} dir={sortDir} onToggle={toggleSort} />
              <SortHeader field="team" label="Team" current={sortField} dir={sortDir} onToggle={toggleSort} />
              <SortHeader field="status" label="Status" current={sortField} dir={sortDir} onToggle={toggleSort} />
              <th className="py-2 px-3 text-text-dim font-medium text-[11px]">Classification</th>
              <SortHeader field="created_at" label="Created" current={sortField} dir={sortDir} onToggle={toggleSort} />
              <th className="py-2 px-3 text-text-dim font-medium text-[11px]">Gates</th>
              {hasActions && <th className="py-2 px-3 text-text-dim font-medium text-[11px] w-24">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedRuns.map((run) => {
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
                  {hasActions && (
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {onCancelRun && cancellableStatuses.includes(run.status) && (
                          <button
                            className="p-1 rounded hover:bg-yellow/10 text-text-dim hover:text-yellow transition-colors"
                            onClick={() => onCancelRun(run)}
                            title="Cancel run"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onRetryRun && retryableStatuses.includes(run.status) && (
                          <button
                            className="p-1 rounded hover:bg-accent/10 text-text-dim hover:text-accent transition-colors"
                            onClick={() => onRetryRun(run)}
                            title="Retry run"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDeleteRun && (
                          <button
                            className="p-1 rounded hover:bg-red/10 text-text-dim hover:text-red transition-colors"
                            onClick={() => onDeleteRun(run)}
                            title="Delete run"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
