import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, CheckCircle, Clock } from 'lucide-react';
import { PipelineStatsCards } from '../pipeline/PipelineStatsCards';
import { PipelineFilters } from '../pipeline/PipelineFilters';
import { PipelineTable } from '../pipeline/PipelineTable';
import { PipelinePagination } from '../pipeline/PipelinePagination';
import { RunDetailOverlay } from '../pipeline/RunDetailOverlay';
import { fetchPipelineStats, fetchPipelineRuns } from '../../api/pipeline';
import { fetchAuditEvents } from '../../api/audit';
import { useUserContext } from '../../context/UserContext';
import type { PipelineStats, PipelineRun, AuditEvent } from '../../types/api';

const PAGE_LIMIT = 20;

interface SecurityTabProps {
  active: boolean;
}

export function SecurityTab({ active }: SecurityTabProps) {
  const { isAdmin, isIssm } = useUserContext();
  const canReview = isAdmin || isIssm;

  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [pendingRuns, setPendingRuns] = useState<PipelineRun[]>([]);
  const [securityEvents, setSecurityEvents] = useState<AuditEvent[]>([]);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchPipelineStats();
      setStats(data);
    } catch {
      // silently fail
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await fetchPipelineRuns({
        status: statusFilter || undefined,
        search: searchFilter || undefined,
        offset,
        limit: PAGE_LIMIT,
      });
      setRuns(data.runs || []);
      setTotal(data.total || 0);
    } catch {
      // silently fail
    }
  }, [statusFilter, searchFilter, offset]);

  const loadPendingReviews = useCallback(async () => {
    if (!canReview) return;
    try {
      const data = await fetchPipelineRuns({ status: 'review_pending', limit: 10 });
      setPendingRuns(data.runs || []);
    } catch {
      // silently fail
    }
  }, [canReview]);

  const loadSecurityEvents = useCallback(async () => {
    try {
      const events = await fetchAuditEvents();
      setSecurityEvents((events || []).slice(0, 20));
    } catch {
      // silently fail
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadStats();
    loadRuns();
    loadPendingReviews();
    loadSecurityEvents();
  }, [loadStats, loadRuns, loadPendingReviews, loadSecurityEvents]);

  useEffect(() => {
    if (!active) return;
    refreshAll();
    const id = setInterval(refreshAll, 10000);
    return () => clearInterval(id);
  }, [active, refreshAll]);

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setOffset(0);
  };

  const handleSearchChange = (search: string) => {
    setSearchFilter(search);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
    }, 300);
  };

  const handleSelectRun = (id: string) => {
    const run = runs.find((r) => r.id === id) || pendingRuns.find((r) => r.id === id);
    setSelectedRunId(id);
    setIsReviewMode(canReview && run?.status === 'review_pending');
  };

  const handleReviewRun = (id: string) => {
    setSelectedRunId(id);
    setIsReviewMode(true);
  };

  // Compute posture metrics
  const passRate = stats && stats.total > 0
    ? Math.round(((stats.approved + stats.deployed) / stats.total) * 100)
    : 0;
  const failRate = stats && stats.total > 0
    ? Math.round((stats.failed / stats.total) * 100)
    : 0;

  return (
    <div>
      {/* Section 1: Review Queue */}
      {canReview && (
        <div className="mb-6">
          <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            ISSM Review Queue
          </h2>
          {pendingRuns.length === 0 ? (
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green" />
              <span className="text-sm text-text-primary">No pending reviews</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingRuns.map((run) => {
                const gates = run.gates || [];
                const passed = gates.filter((g) => g.status === 'passed' || g.status === 'warning').length;
                const total = gates.length || 8;
                const timeWaiting = run.updated_at
                  ? formatTimeAgo(run.updated_at)
                  : '--';

                return (
                  <div
                    key={run.id}
                    className="bg-card border-l-[3px] border-l-yellow border border-border rounded-[var(--radius)] p-4 cursor-pointer hover:bg-surface-hover transition-all"
                    onClick={() => handleReviewRun(run.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-semibold text-sm text-text-bright">
                        {run.app_name}
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-yellow/15 text-yellow">
                        review pending
                      </span>
                    </div>
                    <div className="text-xs text-text-dim mb-2">
                      {run.image_url || run.git_url || 'No source'}
                    </div>
                    <div className="flex items-center gap-1 mb-2">
                      {gates.map((g, i) => {
                        const color =
                          g.status === 'passed' ? 'bg-green' :
                          g.status === 'warning' ? 'bg-yellow' :
                          g.status === 'failed' ? 'bg-red' : 'bg-surface-hover';
                        return <span key={i} className={`w-2.5 h-2.5 rounded-full ${color}`} title={`${g.short_name}: ${g.status}`} />;
                      })}
                      <span className="text-[11px] text-text-dim ml-1">{passed}/{total} gates</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-text-dim">
                      <span>By {run.submitted_by || '--'}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeWaiting}
                      </span>
                    </div>
                    <button
                      className="btn btn-primary text-xs w-full mt-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReviewRun(run.id);
                      }}
                    >
                      Review Now
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Section 2: Security Posture Cards */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Security Posture
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card-base p-4 text-center">
            <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">Pipeline Pass Rate</h3>
            <div className={`text-2xl font-bold ${passRate >= 80 ? 'text-green' : passRate >= 50 ? 'text-yellow' : 'text-red'}`}>
              {stats ? `${passRate}%` : '--'}
            </div>
          </div>
          <div className="card-base p-4 text-center">
            <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">Total Runs</h3>
            <div className="text-2xl font-bold text-text-primary">
              {stats ? stats.total : '--'}
            </div>
          </div>
          <div className="card-base p-4 text-center">
            <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">Policy Violations</h3>
            <div className="text-2xl font-bold text-text-dim">0</div>
            <div className="text-[10px] text-text-dim mt-0.5">Kyverno integration coming</div>
          </div>
          <div className="card-base p-4 text-center">
            <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">Gate Failure Rate</h3>
            <div className={`text-2xl font-bold ${failRate <= 20 ? 'text-green' : 'text-red'}`}>
              {stats ? `${failRate}%` : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Pipeline Runs */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Pipeline Runs
        </h2>
        <PipelineFilters
          statusFilter={statusFilter}
          searchFilter={searchFilter}
          onStatusChange={handleStatusChange}
          onSearchChange={handleSearchChange}
        />
        <PipelineTable
          runs={runs}
          onSelectRun={handleSelectRun}
          totalCount={total}
        />
        <PipelinePagination
          offset={offset}
          limit={PAGE_LIMIT}
          total={total}
          onPrev={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
          onNext={() => setOffset(offset + PAGE_LIMIT)}
        />
      </div>

      {/* Section 4: Recent Security Events */}
      <div>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Recent Security Events
        </h2>
        <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
          {securityEvents.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-dim text-sm">No recent events</div>
          ) : (
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-card">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Time</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Resource</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Message</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {securityEvents.map((event, idx) => {
                    const ts = event.timestamp ? new Date(event.timestamp).toLocaleString() : 'N/A';
                    const isWarning = event.type === 'Warning';
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-border last:border-0 hover:bg-surface/50 transition-colors ${isWarning ? 'bg-yellow/5' : ''}`}
                      >
                        <td className="py-2 px-3 text-xs text-text-dim whitespace-nowrap">{ts}</td>
                        <td className="py-2 px-3 text-xs text-text-dim">{event.namespace}</td>
                        <td className="py-2 px-3 text-xs text-text-primary truncate max-w-[200px]">{event.kind}/{event.name}</td>
                        <td className="py-2 px-3 text-xs text-text-primary truncate max-w-[300px]">{event.message}</td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                            isWarning ? 'bg-yellow/15 text-yellow' : 'bg-green/15 text-green'
                          }`}>{event.type}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Run Detail / Review Overlay */}
      {selectedRunId && (
        <RunDetailOverlay
          runId={selectedRunId}
          isReview={isReviewMode}
          onClose={() => setSelectedRunId(null)}
          onActionComplete={refreshAll}
        />
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
