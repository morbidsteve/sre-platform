import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, CheckCircle, Clock, Trash2, AlertTriangle, Filter } from 'lucide-react';
import { SkeletonCard } from '../ui/Skeleton';
import { PipelineStatsCards } from '../pipeline/PipelineStatsCards';
import { PipelineFilters } from '../pipeline/PipelineFilters';
import { PipelineTable } from '../pipeline/PipelineTable';
import { PipelinePagination } from '../pipeline/PipelinePagination';
import { RunDetailOverlay } from '../pipeline/RunDetailOverlay';
import { fetchPipelineStats, fetchPipelineRuns, deletePipelineRun } from '../../api/pipeline';
import { fetchAuditEvents } from '../../api/audit';
import { fetchPolicyViolations } from '../../api/apps';
import { useUserContext } from '../../context/UserContext';
import { useModal } from '../../context/ModalContext';
import { useToast } from '../../context/ToastContext';
import type { PipelineStats, PipelineRun, AuditEvent, PolicyViolation, PolicyViolationSummary } from '../../types/api';

const PAGE_LIMIT = 20;

interface SecurityTabProps {
  active: boolean;
  onOpenApp?: (url: string, title: string) => void;
}

export function SecurityTab({ active, onOpenApp }: SecurityTabProps) {
  const { isAdmin, isIssm } = useUserContext();
  const canReview = isAdmin || isIssm;
  const { confirm } = useModal();
  const { showToast } = useToast();

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
  const [policyViolations, setPolicyViolations] = useState<PolicyViolation[]>([]);
  const [violationSummary, setViolationSummary] = useState<PolicyViolationSummary>({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
  const [violationNsFilter, setViolationNsFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchPipelineStats();
      setStats(data);
    } catch {
      setError('Failed to load pipeline stats');
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
      setError('Failed to load pipeline runs');
    }
  }, [statusFilter, searchFilter, offset]);

  const loadPendingReviews = useCallback(async () => {
    if (!canReview) return;
    try {
      const data = await fetchPipelineRuns({ status: 'review_pending', limit: 10 });
      setPendingRuns(data.runs || []);
    } catch {
      // non-critical
    }
  }, [canReview]);

  const loadSecurityEvents = useCallback(async () => {
    try {
      const events = await fetchAuditEvents();
      setSecurityEvents((events || []).slice(0, 20));
    } catch {
      // non-critical
    }
  }, []);

  const loadPolicyViolations = useCallback(async () => {
    try {
      const data = await fetchPolicyViolations();
      setPolicyViolations(data.violations || []);
      setViolationSummary(data.summary || { critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    } catch {
      // non-critical — Kyverno PolicyReports may not be available
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setError(null);
    await Promise.all([loadStats(), loadRuns(), loadPendingReviews(), loadSecurityEvents(), loadPolicyViolations()]);
    setInitialLoading(false);
  }, [loadStats, loadRuns, loadPendingReviews, loadSecurityEvents, loadPolicyViolations]);

  useEffect(() => {
    if (!active) return;
    refreshAll();
    const id = setInterval(refreshAll, 10000);
    return () => clearInterval(id);
  }, [active, refreshAll]);

  const handleDeleteRun = useCallback((run: PipelineRun) => {
    confirm(
      'Delete Pipeline Run',
      `Are you sure you want to delete the pipeline run for "${run.app_name}"? This action cannot be undone.`,
      async () => {
        try {
          await deletePipelineRun(run.id);
          showToast(`Pipeline run for "${run.app_name}" deleted`, 'success');
          refreshAll();
        } catch {
          showToast('Failed to delete pipeline run', 'error');
        }
      },
      { confirmLabel: 'Delete', danger: true },
    );
  }, [confirm, showToast, refreshAll]);

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
      {/* Error Banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded border text-sm"
             style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--red)' }}>
          {error} — <button className="underline" onClick={refreshAll}>Retry</button>
        </div>
      )}

      {/* Section 1: Review Queue */}
      {canReview && (
        <div className="mb-6">
          <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            ISSM Review Queue
          </h2>
          {initialLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : pendingRuns.length === 0 ? (
            <div className="bg-card border border-border rounded-[var(--radius)] p-5 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green" />
              <span className="text-sm text-text-primary">No pending reviews</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingRuns.map((run) => {
                const gates = run.gates || [];
                const passed = gates.filter((g) => g.status === 'passed' || g.status === 'warning').length;
                const failed = gates.filter((g) => g.status === 'failed').length;
                const total = gates.length || 8;

                // SLA timer based on created_at (when run entered review_pending)
                const sla = getSlaMeta(run.created_at);

                // Aggregate finding counts by severity for priority indication
                const allFindings = gates.flatMap((g) => g.findings || []);
                const critCount = allFindings.filter((f) => f.severity === 'critical').length;
                const highCount = allFindings.filter((f) => f.severity === 'high').length;
                const medCount = allFindings.filter((f) => f.severity === 'medium').length;

                // Determine border color by severity: critical/failed = red, warnings = yellow
                const borderClass = failed > 0 || critCount > 0
                  ? 'border-l-red'
                  : highCount > 0
                  ? 'border-l-yellow'
                  : 'border-l-yellow';

                return (
                  <div
                    key={run.id}
                    className={`bg-card border-l-[3px] ${borderClass} border border-border rounded-[var(--radius)] p-4 cursor-pointer hover:bg-surface-hover transition-all`}
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
                    {/* Gate status bar */}
                    <div className="flex items-center gap-1 mb-1.5">
                      {gates.map((g, i) => {
                        const color =
                          g.status === 'passed' ? 'bg-green' :
                          g.status === 'warning' ? 'bg-yellow' :
                          g.status === 'failed' ? 'bg-red' : 'bg-surface-hover';
                        return <span key={i} className={`w-2.5 h-2.5 rounded-full ${color}`} title={`${g.short_name}: ${g.status}`} />;
                      })}
                      <span className="text-[11px] text-text-dim ml-1">{passed}/{total} gates</span>
                    </div>
                    {/* Findings severity summary */}
                    {allFindings.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-2">
                        {critCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red border border-red/20 font-semibold">{critCount} critical</span>}
                        {highCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red border border-red/20">{highCount} high</span>}
                        {medCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/10 text-yellow border border-yellow/20">{medCount} medium</span>}
                        {critCount === 0 && highCount === 0 && medCount === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">{allFindings.length} low/info</span>
                        )}
                      </div>
                    )}
                    {allFindings.length === 0 && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">0 findings</span>
                      </div>
                    )}
                    {/* SLA Timer */}
                    <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded text-[11px] font-medium ${
                      sla.color === 'red' ? 'bg-red/10 text-red border border-red/20' :
                      sla.color === 'yellow' ? 'bg-yellow/10 text-yellow border border-yellow/20' :
                      'bg-green/10 text-green border border-green/20'
                    }`}>
                      {sla.color === 'red' ? (
                        <AlertTriangle className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {sla.label}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-text-dim">
                      <span>By {run.submitted_by || '--'}</span>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        className="btn btn-primary text-xs flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReviewRun(run.id);
                        }}
                      >
                        Review Now
                      </button>
                      <button
                        className="btn btn-danger text-xs !px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRun(run);
                        }}
                        title="Delete run"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
        {initialLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
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
              <div className={`text-2xl font-bold ${
                violationSummary.total === 0 ? 'text-green' :
                violationSummary.critical > 0 || violationSummary.high > 0 ? 'text-red' : 'text-yellow'
              }`}>
                {violationSummary.total}
              </div>
              {violationSummary.total > 0 && (
                <div className="text-[10px] text-text-dim mt-0.5">
                  {violationSummary.critical > 0 && <span className="text-red">{violationSummary.critical}C </span>}
                  {violationSummary.high > 0 && <span className="text-red">{violationSummary.high}H </span>}
                  {violationSummary.medium > 0 && <span className="text-yellow">{violationSummary.medium}M </span>}
                  {violationSummary.low > 0 && <span className="text-text-dim">{violationSummary.low}L</span>}
                </div>
              )}
            </div>
            <div className="card-base p-4 text-center">
              <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">Gate Failure Rate</h3>
              <div className={`text-2xl font-bold ${failRate <= 20 ? 'text-green' : 'text-red'}`}>
                {stats ? `${failRate}%` : '--'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 2b: Kyverno Policy Violations */}
      {violationSummary.total > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Kyverno Policy Violations
            </h2>
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-text-dim" />
              <select
                value={violationNsFilter}
                onChange={(e) => setViolationNsFilter(e.target.value)}
                className="appearance-none bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary font-mono cursor-pointer hover:border-accent focus:border-accent focus:outline-none"
              >
                <option value="">All Namespaces</option>
                {[...new Set(policyViolations.map(v => v.namespace))].sort().map(ns => (
                  <option key={ns} value={ns}>{ns}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
            <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-card">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Severity</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Policy</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Rule</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Resource</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {policyViolations
                    .filter(v => !violationNsFilter || v.namespace === violationNsFilter)
                    .map((v, idx) => {
                      const sevClass =
                        v.severity === 'critical' ? 'bg-red/15 text-red border-red/20' :
                        v.severity === 'high' ? 'bg-red/10 text-red border-red/20' :
                        v.severity === 'medium' ? 'bg-yellow/15 text-yellow border-yellow/20' :
                        'bg-text-dim/10 text-text-dim border-text-dim/20';

                      return (
                        <tr key={idx} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                          <td className="py-2 px-3">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${sevClass}`}>
                              {v.severity}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-text-primary font-mono">{v.policy}</td>
                          <td className="py-2 px-3 text-xs text-text-dim font-mono">{v.rule}</td>
                          <td className="py-2 px-3 text-xs text-text-dim">{v.namespace}</td>
                          <td className="py-2 px-3 text-xs text-text-primary truncate max-w-[150px]">{v.resource}</td>
                          <td className="py-2 px-3 text-xs text-text-dim truncate max-w-[300px]">{v.message}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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
          onDeleteRun={canReview ? handleDeleteRun : undefined}
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
          onOpenApp={onOpenApp}
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

/** SLA thresholds in hours */
const SLA_WARN_HOURS = 4;
const SLA_CRIT_HOURS = 8;

/** Returns SLA status for a review queue item based on created_at timestamp */
function getSlaMeta(dateStr: string | undefined): { color: 'green' | 'yellow' | 'red'; elapsed: string; label: string } {
  if (!dateStr) return { color: 'green', elapsed: '--', label: 'Unknown' };
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffH = diffMs / 3_600_000;
  const hours = Math.floor(diffH);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  if (diffH >= SLA_CRIT_HOURS) return { color: 'red', elapsed, label: `Waiting ${elapsed} (SLA breached)` };
  if (diffH >= SLA_WARN_HOURS) return { color: 'yellow', elapsed, label: `Waiting ${elapsed} (SLA warning)` };
  return { color: 'green', elapsed, label: `Waiting ${elapsed}` };
}
