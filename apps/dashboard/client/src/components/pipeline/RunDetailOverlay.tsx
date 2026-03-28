import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { GateEvidenceRow } from './GateEvidenceRow';
import { ReviewForm } from './ReviewForm';
import {
  fetchPipelineRun,
  reviewPipelineRun,
  submitForReview,
  deployPipelineRun,
  retryPipelineRun as retryRun,
  updateFindingDisposition,
} from '../../api/pipeline';
import type { PipelineRun } from '../../types/api';
import { useConfig, serviceUrl } from '../../context/ConfigContext';

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

interface RunDetailOverlayProps {
  runId: string | null;
  isReview?: boolean;
  onClose: () => void;
  onActionComplete?: () => void;
  onOpenApp?: (url: string, title: string) => void;
}

export function RunDetailOverlay({ runId, isReview = false, onClose, onActionComplete, onOpenApp }: RunDetailOverlayProps) {
  const config = useConfig();
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPipelineRun(runId);
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run details');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  // Poll for deploying status
  useEffect(() => {
    if (!run || run.status !== 'deploying') return;
    const id = setInterval(loadRun, 5000);
    return () => clearInterval(id);
  }, [run, loadRun]);

  if (!runId) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSubmitForReview = async () => {
    if (!run) return;
    if (!confirm('Submit this pipeline run for ISSM review?')) return;
    try {
      await submitForReview(run.id);
      onClose();
      onActionComplete?.();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDeploy = async () => {
    if (!run) return;
    if (!confirm('Deploy this approved pipeline run?')) return;
    try {
      await deployPipelineRun(run.id);
      loadRun();
      onActionComplete?.();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRetry = async () => {
    if (!run) return;
    if (!confirm('Retry this pipeline run?')) return;
    try {
      await retryRun(run.id);
      onClose();
      onActionComplete?.();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleReview = async (decision: 'approved' | 'rejected' | 'returned', comment: string) => {
    if (!run) return;
    setReviewLoading(true);
    try {
      await reviewPipelineRun(run.id, decision, comment);
      onClose();
      onActionComplete?.();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setReviewLoading(false);
    }
  };

  const handleDispositionChange = async (findingId: number, disposition: string, mitigation: string) => {
    if (!run) return;
    try {
      await updateFindingDisposition(run.id, findingId, disposition, mitigation);
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const audit = (run as unknown as Record<string, unknown>)?.audit as Array<{ timestamp?: string; action?: string; event?: string; user?: string; detail?: string; details?: string }> | undefined;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end ${isReview ? '' : ''}`}
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-card border-l border-border overflow-y-auto animate-[slideInRight_0.25s_ease] ${
          isReview ? 'w-full max-w-full' : 'w-full max-w-[700px]'
        }`}
      >
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Spinner size="lg" />
            <span className="ml-3 text-text-dim">Loading run details...</span>
          </div>
        ) : error ? (
          <div className="text-red text-sm py-16 text-center">{error}</div>
        ) : run ? (
          <div className="p-5">
            {/* Header */}
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-lg font-bold text-text-primary">
                  {run.app_name || 'Pipeline Run'}
                </h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${statusBadgeClass(run.status)}`}>
                    {(run.status || 'pending').replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-surface text-text-dim border border-border">
                    {run.classification || 'Unclassified'}
                  </span>
                </div>
                <div className="text-xs text-text-dim mt-2">
                  Team: <strong>{run.team || '--'}</strong> &middot;&nbsp;
                  Created by: <strong>{run.submitted_by || '--'}</strong> &middot;&nbsp;
                  {timeAgo(run.created_at)}
                </div>
              </div>
              <button
                className="text-2xl text-text-dim hover:text-text-primary transition-colors"
                onClick={onClose}
              >
                &times;
              </button>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mb-5">
              {(run.status === 'scanning' || run.status === 'pending') && (
                <Button variant="primary" onClick={handleSubmitForReview}>Submit for Review</Button>
              )}
              {run.status === 'review_pending' && !isReview && (
                <span className="text-xs text-yellow flex items-center gap-1.5">Awaiting ISSM Review</span>
              )}
              {run.status === 'approved' && (
                <Button variant="success" onClick={handleDeploy}>Deploy Now</Button>
              )}
              {run.status === 'deployed' && run.deployed_url && (
                <a
                  href={run.deployed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-success no-underline"
                >
                  Open Deployed App
                </a>
              )}
              {(run.status === 'failed' || run.status === 'scanning') && (
                <Button variant="warn" onClick={handleRetry}>Restart Pipeline</Button>
              )}
              {run.status === 'rejected' && (
                <span className="text-xs text-red">
                  Rejected{run.review?.comment ? ': ' + run.review.comment : ''}
                </span>
              )}
              {onOpenApp && run.status !== 'deployed' && run.status !== 'failed' && (
                <Button variant="primary" onClick={() => {
                  const wizardUrl = `${serviceUrl(config, 'dsop')}?runId=${run.id}`;
                  onOpenApp(wizardUrl, 'DSOP Security Pipeline');
                  onClose();
                }}>Open in Wizard</Button>
              )}
            </div>

            {/* ISSM Review Form (only in review mode and when status is review_pending) */}
            {isReview && run.status === 'review_pending' && (
              <div className="mb-5">
                <ReviewForm onSubmit={handleReview} loading={reviewLoading} />
              </div>
            )}

            {/* Gate Summary Bar (quick glance for ISSM) */}
            {run.gates && run.gates.length > 0 && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                {(() => {
                  const passed = run.gates.filter(g => g.status === 'passed').length;
                  const warnings = run.gates.filter(g => g.status === 'warning').length;
                  const failed = run.gates.filter(g => g.status === 'failed').length;
                  const pending = run.gates.filter(g => g.status === 'pending' || g.status === 'running').length;
                  return (
                    <>
                      {passed > 0 && <span className="text-[11px] px-2 py-0.5 rounded bg-green/10 text-green border border-green/20">{passed} passed</span>}
                      {warnings > 0 && <span className="text-[11px] px-2 py-0.5 rounded bg-yellow/10 text-yellow border border-yellow/20">{warnings} warning</span>}
                      {failed > 0 && <span className="text-[11px] px-2 py-0.5 rounded bg-red/10 text-red border border-red/20">{failed} failed</span>}
                      {pending > 0 && <span className="text-[11px] px-2 py-0.5 rounded bg-surface text-text-dim border border-border">{pending} pending</span>}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Gate Timeline */}
            {run.gates && run.gates.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-text-primary mb-3">
                  {isReview ? 'Security Gate Evidence' : 'Gate Results'}
                </h3>
                {(() => {
                  // Auto-expand the first gate that has findings or failed
                  const firstWithIssues = run.gates.findIndex(g =>
                    g.status === 'failed' || g.status === 'warning' || (g.findings && g.findings.length > 0)
                  );
                  return run.gates.map((gate, i) => (
                    <GateEvidenceRow
                      key={gate.gate_id || i}
                      gate={gate}
                      isReview={isReview}
                      runId={run.id}
                      defaultExpanded={i === firstWithIssues}
                      onDispositionChange={!isReview ? handleDispositionChange : undefined}
                    />
                  ));
                })()}
              </div>
            )}

            {/* Audit Trail */}
            {audit && audit.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-text-primary mb-3">Audit Trail</h3>
                <ul className="space-y-2">
                  {audit.map((ev, i) => (
                    <li key={i} className="flex items-start gap-3 text-xs">
                      <span className="text-text-dim whitespace-nowrap">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '--'}
                      </span>
                      <span className="text-text-primary">
                        {ev.action || ev.event || '--'}
                        {ev.user && <> by <strong>{ev.user}</strong></>}
                        {(ev.detail || ev.details) && <> &mdash; {ev.detail || ev.details}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
