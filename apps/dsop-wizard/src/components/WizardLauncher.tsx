import React, { useEffect, useState } from 'react';
import { Rocket, Eye, PlayCircle, AlertCircle, Loader2, Shield } from 'lucide-react';
import type { PipelineRun, PipelineRunStatus } from '../types';
import { listPipelineRuns } from '../api';

interface WizardLauncherProps {
  onStartNew: () => void;
  onSelectRun: (runId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-zinc-500/20 text-zinc-400',
  scanning: 'bg-blue-500/20 text-blue-400',
  review_pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  deploying: 'bg-blue-500/20 text-blue-400',
  deployed: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
  rejected: 'bg-red-500/20 text-red-400',
  returned: 'bg-amber-500/20 text-amber-400',
  undeployed: 'bg-zinc-500/20 text-zinc-400',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  scanning: 'Scanning',
  review_pending: 'In Review',
  approved: 'Approved',
  deploying: 'Deploying',
  deployed: 'Deployed',
  failed: 'Failed',
  rejected: 'Rejected',
  returned: 'Returned',
  undeployed: 'Undeployed',
};

const RESUMABLE_STATUSES: Set<PipelineRunStatus> = new Set([
  'pending',
  'scanning',
  'review_pending',
  'approved',
  'deploying',
]);

function timeAgo(dateStr: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return 'recently';
  }
}

export function WizardLauncher({ onStartNew, onSelectRun }: WizardLauncherProps) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listPipelineRuns(20)
      .then((result) => {
        if (cancelled) return;
        setRuns(result.runs || []);
        setTotal(result.total ?? (result.runs?.length || 0));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load pipeline runs');
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
              <Shield className="w-5 h-5 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-100 tracking-tight">
              DSOP Security Pipeline
            </h1>
          </div>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Deploy applications through the DoD Software Operations Pipeline with automated security scanning and ISSM review.
          </p>
        </div>

        {/* Start New Pipeline */}
        <button
          onClick={onStartNew}
          className="w-full group bg-navy-800 hover:bg-navy-750 border border-navy-600 hover:border-cyan-500/50 rounded-xl p-5 transition-all duration-200 text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center group-hover:bg-cyan-500/25 transition-colors">
              <Rocket className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold text-gray-100 group-hover:text-cyan-300 transition-colors">
                Start New Pipeline
              </div>
              <div className="text-sm text-gray-400 mt-0.5">
                Deploy a new application through the security pipeline
              </div>
            </div>
            <PlayCircle className="w-5 h-5 text-gray-500 group-hover:text-cyan-400 transition-colors" />
          </div>
        </button>

        {/* Previous Runs */}
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-navy-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">Previous Runs</h2>
            {!loading && !error && (
              <span className="text-xs text-gray-500 font-mono">
                {total} total
              </span>
            )}
          </div>

          {loading && (
            <div className="px-5 py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              <p className="text-sm text-gray-500">Loading pipeline runs...</p>
            </div>
          )}

          {error && (
            <div className="px-5 py-8 flex flex-col items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <p className="text-sm text-gray-400 text-center">{error}</p>
              <p className="text-xs text-gray-500">You can still start a new pipeline.</p>
            </div>
          )}

          {!loading && !error && runs.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-500">No pipeline runs yet.</p>
              <p className="text-xs text-gray-600 mt-1">Start a new pipeline above to get started.</p>
            </div>
          )}

          {!loading && !error && runs.length > 0 && (
            <div className="divide-y divide-navy-700/50">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider bg-navy-850">
                <span>Application</span>
                <span className="w-24 text-center">Status</span>
                <span className="w-24 text-center hidden sm:block">Team</span>
                <span className="w-16 text-right hidden sm:block">When</span>
                <span className="w-20 text-right">Action</span>
              </div>

              {/* Rows */}
              {runs.map((run) => {
                const isResumable = RESUMABLE_STATUSES.has(run.status);
                const statusColor = STATUS_COLORS[run.status] || STATUS_COLORS.pending;
                const statusLabel = STATUS_LABELS[run.status] || run.status;

                return (
                  <div
                    key={run.id}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-3 items-center hover:bg-navy-750/50 transition-colors"
                  >
                    {/* App name */}
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-200 truncate block">
                        {run.app_name || 'Unknown'}
                      </span>
                    </div>

                    {/* Status badge */}
                    <div className="w-24 flex justify-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {/* Team */}
                    <div className="w-24 text-center hidden sm:block">
                      <span className="text-xs text-gray-400 font-mono truncate">
                        {run.team || '-'}
                      </span>
                    </div>

                    {/* Time */}
                    <div className="w-16 text-right hidden sm:block">
                      <span className="text-xs text-gray-500">
                        {timeAgo(run.created_at)}
                      </span>
                    </div>

                    {/* Action button */}
                    <div className="w-20 flex justify-end">
                      <button
                        onClick={() => onSelectRun(run.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isResumable
                            ? 'bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 border border-cyan-500/30'
                            : 'bg-navy-700 text-gray-300 hover:bg-navy-600 border border-navy-500'
                        }`}
                      >
                        {isResumable ? (
                          <>
                            <PlayCircle className="w-3.5 h-3.5" />
                            Resume
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
