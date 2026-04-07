import React, { useState, useEffect, useRef } from 'react';
import { getConfig } from '../../config';
import {
  ArrowLeft,
  Rocket,
  Download,
  FileCheck,
  Shield,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  Globe,
  Server,
  Tag,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  XCircle,
  RotateCcw,
  Send,
  ChevronDown,
  Code2,
  Eye,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { getGateOutput, type GateOutputResponse } from '../../api';
import type { AppInfo, DetectionResult, SecurityGate, SecurityException, PipelineRun, PipelineRunStatus } from '../../types';

interface Step5Props {
  appInfo: AppInfo;
  detection: DetectionResult;
  gates: SecurityGate[];
  onBack: () => void;
  onDeploy: () => void;
  pipelineRun?: PipelineRun | null;
  pipelineRunStatus?: PipelineRunStatus | null;
  onSubmitForReview?: () => void;
  onRefreshPipelineRun?: () => void;
  onDownloadPackage?: () => void;
  isAdmin?: boolean;
  onReviewPipelineRun?: (decision: 'approved' | 'rejected' | 'returned', comment: string) => Promise<void>;
  securityExceptions?: SecurityException[];
}

const exceptionLabels: Record<string, string> = {
  run_as_root: 'Run as Root',
  writable_filesystem: 'Writable Filesystem',
  host_networking: 'Host Networking',
  host_ports: 'Host Ports',
  privileged_container: 'Privileged Container',
  privilege_escalation: 'Privilege Escalation',
  custom_capability: 'Custom Capability',
  restricted_volumes: 'Restricted Volume Types',
  unsafe_sysctls: 'Unsafe Sysctls',
};

type ReviewDecision = 'approved' | 'rejected' | 'returned';

const typeLabels: Record<string, string> = {
  'docker-compose': 'Docker Compose',
  dockerfile: 'Dockerfile',
  helm: 'Helm Chart',
  kustomize: 'Kustomize',
  container: 'Container Image',
};

const severityColors: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  low: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  info: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
};

const gateStatusConfig: Record<string, { color: string; label: string }> = {
  passed: { color: 'text-emerald-400', label: 'PASSED' },
  failed: { color: 'text-red-400', label: 'FAILED' },
  warning: { color: 'text-amber-400', label: 'WARNING' },
  skipped: { color: 'text-gray-400', label: 'SKIPPED' },
  running: { color: 'text-cyan-400', label: 'RUNNING' },
  pending: { color: 'text-gray-500', label: 'PENDING' },
};

function RawOutputViewer({ runId, gateId, shortName }: { runId: string; gateId: number; shortName: string }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GateOutputResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const loadOutput = async () => {
    if (data) return; // Already loaded
    setLoading(true);
    setError(null);
    try {
      const result = await getGateOutput(runId, gateId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOutput();
  }, [runId, gateId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
        <span className="text-xs text-gray-500">Loading scan output...</span>
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-red-400 py-1">{error}</p>;
  }

  if (!data?.rawOutput) {
    return <p className="text-xs text-gray-600 py-1">No raw output available.</p>;
  }

  const raw = data.rawOutput;
  const toolOutput = raw.toolOutput as Record<string, unknown> | unknown[] | null;
  const sn = shortName.toUpperCase();

  return (
    <div className="space-y-2 mt-2 pt-2 border-t border-navy-700">
      {/* SAST / Semgrep table */}
      {sn === 'SAST' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput) && Array.isArray((toolOutput as Record<string, unknown>).results) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">
            Semgrep: {((toolOutput as Record<string, unknown>).results as unknown[]).length} result(s)
          </p>
          {((toolOutput as Record<string, unknown>).results as Array<Record<string, unknown>>).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-navy-700">
                    <th className="text-left px-2 py-1">Rule</th>
                    <th className="text-left px-2 py-1">Severity</th>
                    <th className="text-left px-2 py-1">File</th>
                    <th className="text-left px-2 py-1">Line</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {((toolOutput as Record<string, unknown>).results as Array<Record<string, unknown>>).slice(0, 30).map((r, i) => {
                    const extra = r.extra as Record<string, unknown> | undefined;
                    const start = r.start as Record<string, number> | undefined;
                    return (
                      <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                        <td className="px-2 py-1 font-mono text-cyan-400/80 max-w-[150px] truncate">{String(r.check_id || '--')}</td>
                        <td className="px-2 py-1">
                          <span className={`text-xs font-bold uppercase ${
                            String(extra?.severity) === 'ERROR' ? 'text-red-400' :
                            String(extra?.severity) === 'WARNING' ? 'text-amber-400' : 'text-gray-400'
                          }`}>{String(extra?.severity || 'info')}</span>
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-400 max-w-[120px] truncate">{String(r.path || '--')}</td>
                        <td className="px-2 py-1 font-mono text-gray-400">{start?.line || '--'}</td>
                        <td className="px-2 py-1 text-gray-500 max-w-[200px] truncate">{String(extra?.message || '').substring(0, 100)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {((toolOutput as Record<string, unknown>).results as unknown[]).length > 30 && (
                <p className="text-xs text-gray-600 mt-1">Showing 30 of {((toolOutput as Record<string, unknown>).results as unknown[]).length}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Secrets / Gitleaks table */}
      {sn === 'SECRETS' && Array.isArray(toolOutput) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Gitleaks: {toolOutput.length} finding(s)</p>
          {toolOutput.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-navy-700">
                    <th className="text-left px-2 py-1">Rule</th>
                    <th className="text-left px-2 py-1">File</th>
                    <th className="text-left px-2 py-1">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {(toolOutput as Array<Record<string, unknown>>).slice(0, 30).map((s, i) => (
                    <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                      <td className="px-2 py-1 font-mono text-red-400">{String(s.RuleID || s.Description || '--')}</td>
                      <td className="px-2 py-1 font-mono text-gray-400 max-w-[150px] truncate">{String(s.File || '--')}</td>
                      <td className="px-2 py-1 font-mono text-gray-400">{String(s.StartLine || '--')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CVE / Trivy table */}
      {sn === 'CVE' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput) && Array.isArray((toolOutput as Record<string, unknown>).Results) && (
        <div>
          {(() => {
            const allVulns: Array<{ cve: string; pkg: string; severity: string; fixedVersion: string; title: string }> = [];
            ((toolOutput as Record<string, unknown>).Results as Array<Record<string, unknown>>).forEach((r) => {
              ((r.Vulnerabilities || []) as Array<Record<string, unknown>>).forEach((v) => {
                allVulns.push({
                  cve: String(v.VulnerabilityID || '--'),
                  pkg: String(v.PkgName || '--'),
                  severity: String(v.Severity || 'unknown'),
                  fixedVersion: String(v.FixedVersion || '--'),
                  title: String(v.Title || ''),
                });
              });
            });
            return (
              <>
                <p className="text-xs text-gray-500 mb-1">
                  Trivy: {allVulns.length} vulnerabilities across {((toolOutput as Record<string, unknown>).Results as unknown[]).length} target(s)
                </p>
                {allVulns.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-navy-700">
                          <th className="text-left px-2 py-1">CVE ID</th>
                          <th className="text-left px-2 py-1">Package</th>
                          <th className="text-left px-2 py-1">Severity</th>
                          <th className="text-left px-2 py-1">Fixed In</th>
                          <th className="text-left px-2 py-1">Title</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allVulns.slice(0, 30).map((v, i) => (
                          <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                            <td className="px-2 py-1 font-mono text-cyan-400/80">{v.cve}</td>
                            <td className="px-2 py-1 font-mono text-gray-400">{v.pkg}</td>
                            <td className="px-2 py-1">
                              <span className={`text-xs font-bold uppercase ${
                                v.severity.toLowerCase() === 'critical' ? 'text-red-400' :
                                v.severity.toLowerCase() === 'high' ? 'text-orange-400' :
                                v.severity.toLowerCase() === 'medium' ? 'text-amber-400' : 'text-gray-400'
                              }`}>{v.severity}</span>
                            </td>
                            <td className="px-2 py-1 font-mono text-gray-500">{v.fixedVersion}</td>
                            <td className="px-2 py-1 text-gray-500 max-w-[180px] truncate">{v.title.substring(0, 80)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {allVulns.length > 30 && (
                      <p className="text-xs text-gray-600 mt-1">Showing 30 of {allVulns.length}</p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* SBOM / Syft table */}
      {sn === 'SBOM' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput) && Array.isArray((toolOutput as Record<string, unknown>).packages) && (
        <div>
          {(() => {
            const pkgs = (toolOutput as Record<string, unknown>).packages as Array<Record<string, unknown>>;
            return (
              <>
                <p className="text-xs text-gray-500 mb-1">SBOM (SPDX): {pkgs.length} packages</p>
                {pkgs.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-navy-700">
                          <th className="text-left px-2 py-1">Package</th>
                          <th className="text-left px-2 py-1">Version</th>
                          <th className="text-left px-2 py-1">License</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkgs.slice(0, 20).map((p, i) => (
                          <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                            <td className="px-2 py-1 font-mono text-gray-300">{String(p.name || '--')}</td>
                            <td className="px-2 py-1 font-mono text-gray-400">{String(p.versionInfo || '--')}</td>
                            <td className="px-2 py-1 text-gray-500">{String(p.licenseConcluded || p.licenseDeclared || '--')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pkgs.length > 20 && (
                      <p className="text-xs text-gray-600 mt-1">Showing 20 of {pkgs.length}</p>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Full JSON toggle */}
      <button
        type="button"
        onClick={() => setShowJson(!showJson)}
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        <Code2 className="w-3.5 h-3.5" />
        {showJson ? 'Hide' : 'Show'} full JSON
      </button>
      {showJson && (
        <pre className="bg-navy-950 border border-navy-700 rounded-lg p-3 text-xs font-mono text-gray-400 max-h-80 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ReviewGateDetail({ gate, runId }: { gate: SecurityGate; runId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const cfg = gateStatusConfig[gate.status] || gateStatusConfig.pending;
  const hasFindings = gate.findings.length > 0;
  const isDeferred = gate.summary?.startsWith('Deferred');
  const canShowRaw = gate.status !== 'pending' && gate.status !== 'running' && runId;

  return (
    <div className={`border rounded-lg overflow-hidden ${
      gate.status === 'failed' ? 'border-red-500/30' :
      gate.status === 'warning' ? 'border-amber-500/30' :
      gate.status === 'passed' ? 'border-emerald-500/20' :
      'border-navy-600'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-700/50 transition-colors"
      >
        <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${cfg.color}`} />
        <span className="text-sm font-medium text-gray-200 flex-1">
          {gate.shortName}
        </span>
        {hasFindings && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-navy-700 text-gray-400 border border-navy-600">
            {gate.findings.length} finding{gate.findings.length !== 1 ? 's' : ''}
          </span>
        )}
        {isDeferred && (
          <span className="text-xs text-gray-500">(auto)</span>
        )}
        <span className={`text-xs font-mono font-semibold ${cfg.color}`}>{cfg.label}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-navy-600 px-4 py-3 bg-navy-900/40 space-y-3">
          {/* Gate description + summary */}
          <p className="text-xs text-gray-400">{gate.description}</p>
          {gate.summary && (
            <p className="text-xs font-mono text-cyan-400/80">{gate.summary}</p>
          )}

          {/* Findings detail */}
          {hasFindings && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Findings ({gate.findings.length})
              </p>
              {gate.findings.map((f, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 border ${severityColors[f.severity] || severityColors.info}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-bold uppercase flex-shrink-0 mt-0.5">
                      {f.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200">{f.title}</p>
                      {f.description && <p className="text-xs text-gray-400 mt-0.5">{f.description}</p>}
                      {f.location && <p className="text-xs font-mono text-gray-500 mt-0.5">{f.location}</p>}
                    </div>
                    {f.disposition && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                        {f.disposition.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  {f.mitigation && (
                    <p className="text-xs text-gray-400 mt-1.5 ml-12 italic">
                      Mitigation: {f.mitigation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* No findings */}
          {!hasFindings && gate.status === 'passed' && !isDeferred && (
            <p className="text-xs text-emerald-400/70">No findings — clean scan.</p>
          )}

          {/* Report link */}
          {gate.reportUrl && (
            <a
              href={gate.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
            >
              <Globe className="w-3.5 h-3.5" />
              View Full Report
            </a>
          )}

          {/* Raw Output Viewer */}
          {canShowRaw && (
            <div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowRawOutput(!showRawOutput); }}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-cyan-400 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                {showRawOutput ? 'Hide' : 'View'} Raw Scan Output
              </button>
              {showRawOutput && (
                <RawOutputViewer runId={runId} gateId={gate.id} shortName={gate.shortName} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Step5_Review({
  appInfo,
  detection,
  gates,
  onBack,
  onDeploy,
  pipelineRun,
  pipelineRunStatus,
  onSubmitForReview,
  onRefreshPipelineRun,
  onDownloadPackage,
  isAdmin,
  onReviewPipelineRun,
  securityExceptions,
}: Step5Props) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Auto-submit for review on mount if not already submitted
  useEffect(() => {
    if (pipelineRun && onSubmitForReview && !isReviewPending && !isApproved && !isRejected && pipelineRunStatus !== 'deployed') {
      onSubmitForReview();
    }
    // Also refresh to get latest status
    if (onRefreshPipelineRun) {
      onRefreshPipelineRun();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Poll for review status when in review_pending state (for non-admin users waiting)
  useEffect(() => {
    if (pipelineRunStatus === 'review_pending' && onRefreshPipelineRun && !isAdmin) {
      pollRef.current = setInterval(() => {
        onRefreshPipelineRun();
      }, 5000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pipelineRunStatus, onRefreshPipelineRun]);

  const passed = gates.filter((g) => g.status === 'passed').length;
  const warnings = gates.filter((g) => g.status === 'warning').length;
  const total = gates.length;

  const allFindings = gates.flatMap((g) => g.findings);
  const totalFindings = allFindings.length;
  const reviewedFindings = allFindings.filter((f) => f.disposition).length;
  const criticalFindings = allFindings.filter((f) => f.severity === 'critical').length;
  const highFindings = allFindings.filter((f) => f.severity === 'high').length;

  const critHighFindings = allFindings.filter(
    (f) => f.severity === 'critical' || f.severity === 'high'
  );
  const critHighReviewed = critHighFindings.filter((f) => f.disposition).length;
  const allCritHighReviewed = critHighFindings.length > 0 && critHighReviewed === critHighFindings.length;

  const isReviewPending = pipelineRunStatus === 'review_pending';
  const isApproved = pipelineRunStatus === 'approved';
  const isRejected = pipelineRunStatus === 'rejected';

  // Get latest review info if available
  const latestReview = pipelineRun?.reviews?.length
    ? pipelineRun.reviews[pipelineRun.reviews.length - 1]
    : null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">
          Deployment Review
        </h2>
        <p className="text-gray-400 mt-2">
          Review the configuration before deploying to the SRE Platform
        </p>
      </div>

      {/* ISSM Review Status Banner / Inline Review Form */}
      {pipelineRun && isReviewPending && !isAdmin && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-5 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-cyan-400">Awaiting ISSM Review</p>
            <p className="text-xs text-gray-400 mt-1">
              Your pipeline run has been submitted for security review. This page will update automatically when a decision is made.
            </p>
          </div>
        </div>
      )}

      {/* Inline ISSM Review Form for Admin Users */}
      {pipelineRun && isReviewPending && isAdmin && onReviewPipelineRun && (
        <div className="bg-navy-800 border border-cyan-500/30 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="bg-navy-900/60 border-b border-navy-600 px-6 py-4 flex items-center gap-3">
            <Shield className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">ISSM Review</h3>
              <p className="text-xs text-gray-500 mt-0.5">Review security scan results and render a deployment decision</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Gate Results — Summary bar + Expandable detail per gate */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Security Gate Evidence</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2 text-center">
                  <p className="text-lg font-bold font-mono text-emerald-400">{passed}</p>
                  <p className="text-xs text-gray-500">Passed</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2 text-center">
                  <p className="text-lg font-bold font-mono text-amber-400">{warnings}</p>
                  <p className="text-xs text-gray-500">Warnings</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-center">
                  <p className="text-lg font-bold font-mono text-red-400">
                    {gates.filter((g) => g.status === 'failed').length}
                  </p>
                  <p className="text-xs text-gray-500">Failed</p>
                </div>
              </div>

              {/* Expandable gate details */}
              <div className="space-y-2">
                {gates.map((gate) => (
                  <ReviewGateDetail key={gate.id} gate={gate} runId={pipelineRun?.id} />
                ))}
              </div>
            </div>

            {/* Security Exceptions (in ISSM review) */}
            {securityExceptions && securityExceptions.filter((e) => e.enabled).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Security Exceptions Requested</p>
                <div className="space-y-1.5">
                  {securityExceptions.filter((e) => e.enabled).map((exc) => (
                    <div
                      key={exc.type}
                      className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-amber-300">
                          {exceptionLabels[exc.type] || exc.type}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 ml-6">
                        {exc.justification}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decision Cards */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Decision</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Approve */}
                <button
                  type="button"
                  onClick={() => setReviewDecision('approved')}
                  className={`text-left rounded-lg border-2 p-4 transition-all ${
                    reviewDecision === 'approved'
                      ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                      : 'border-navy-600 bg-navy-900/40 hover:border-emerald-500/40 hover:bg-emerald-500/5'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className={`w-5 h-5 ${reviewDecision === 'approved' ? 'text-emerald-400' : 'text-gray-500'}`} />
                    <span className={`text-sm font-semibold ${reviewDecision === 'approved' ? 'text-emerald-400' : 'text-gray-300'}`}>
                      Approve
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">Application meets security requirements for deployment</p>
                </button>

                {/* Reject */}
                <button
                  type="button"
                  onClick={() => setReviewDecision('rejected')}
                  className={`text-left rounded-lg border-2 p-4 transition-all ${
                    reviewDecision === 'rejected'
                      ? 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30'
                      : 'border-navy-600 bg-navy-900/40 hover:border-red-500/40 hover:bg-red-500/5'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldX className={`w-5 h-5 ${reviewDecision === 'rejected' ? 'text-red-400' : 'text-gray-500'}`} />
                    <span className={`text-sm font-semibold ${reviewDecision === 'rejected' ? 'text-red-400' : 'text-gray-300'}`}>
                      Reject
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">Application has unresolved security concerns</p>
                </button>

                {/* Return for Rework */}
                <button
                  type="button"
                  onClick={() => setReviewDecision('returned')}
                  className={`text-left rounded-lg border-2 p-4 transition-all ${
                    reviewDecision === 'returned'
                      ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                      : 'border-navy-600 bg-navy-900/40 hover:border-amber-500/40 hover:bg-amber-500/5'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className={`w-5 h-5 ${reviewDecision === 'returned' ? 'text-amber-400' : 'text-gray-500'}`} />
                    <span className={`text-sm font-semibold ${reviewDecision === 'returned' ? 'text-amber-400' : 'text-gray-300'}`}>
                      Return for Rework
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">Additional remediation needed before review</p>
                </button>
              </div>
            </div>

            {/* Comment */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Comment
                {(reviewDecision === 'rejected' || reviewDecision === 'returned') && (
                  <span className="text-red-400 ml-1">*</span>
                )}
              </label>
              <textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={
                  reviewDecision === 'approved'
                    ? 'Optional: Add notes for the deployment record...'
                    : reviewDecision === 'rejected'
                    ? 'Required: Describe the security concerns...'
                    : reviewDecision === 'returned'
                    ? 'Required: Describe what needs to be remediated...'
                    : 'Select a decision above, then add your comments...'
                }
                rows={3}
                className="w-full bg-navy-900/60 border border-navy-600 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 resize-none"
              />
            </div>

            {/* Error */}
            {reviewError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-400">{reviewError}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={
                  !reviewDecision ||
                  isSubmittingReview ||
                  ((reviewDecision === 'rejected' || reviewDecision === 'returned') && !reviewComment.trim())
                }
                onClick={async () => {
                  if (!reviewDecision) return;
                  setIsSubmittingReview(true);
                  setReviewError(null);
                  try {
                    await onReviewPipelineRun(reviewDecision, reviewComment.trim());
                  } catch (err) {
                    setReviewError(err instanceof Error ? err.message : 'Review submission failed');
                  } finally {
                    setIsSubmittingReview(false);
                  }
                }}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  reviewDecision === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : reviewDecision === 'rejected'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : reviewDecision === 'returned'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-navy-600 text-gray-400'
                }`}
              >
                {isSubmittingReview ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Submit Review
              </button>
            </div>
          </div>
        </div>
      )}

      {pipelineRun && isApproved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5 flex items-center gap-4">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Approved by ISSM</p>
            {latestReview && (
              <p className="text-xs text-gray-400 mt-1">
                Reviewed by {latestReview.reviewer}
                {latestReview.comment ? ` — "${latestReview.comment}"` : ''}
                {' '}on {new Date(latestReview.reviewed_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}

      {pipelineRun && isRejected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 flex items-center gap-4">
          <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">Rejected by ISSM</p>
            {latestReview && (
              <>
                <p className="text-xs text-gray-400 mt-1">
                  Reviewed by {latestReview.reviewer} on {new Date(latestReview.reviewed_at).toLocaleString()}
                </p>
                {latestReview.comment && (
                  <p className="text-sm text-red-300 mt-2 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/20">
                    "{latestReview.comment}"
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Admin Override Warning — shown when admin can deploy without ISSM approval */}
      {isAdmin && !isApproved && !isRejected && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-yellow-400 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" />
            Admin Override Available
          </div>
          <p className="text-xs text-yellow-300/70 mt-1">
            You may deploy without ISSM approval. This bypasses RAISE 2.0 gates and will be recorded in the audit trail.
          </p>
        </div>
      )}

      {/* Security Exceptions — Prominent display for ISSM reviewers */}
      {securityExceptions && securityExceptions.filter((e) => e.enabled).length > 0 && (isAdmin || isReviewPending) && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
          <h4 className="text-orange-400 font-semibold text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Security Exceptions Requested ({securityExceptions.filter((e) => e.enabled).length})
          </h4>
          <div className="mt-3 space-y-2">
            {securityExceptions.filter((e) => e.enabled).map((exc, i) => (
              <div key={i} className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
                <span className="text-xs font-mono text-orange-300">
                  {exc.type.replace(/_/g, ' ').toUpperCase()}
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  Justification: {exc.justification}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Server className="w-4 h-4" />
          Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">App:</span>
            <span className="text-gray-200 font-mono font-medium">
              {appInfo.name || 'my-app'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Type:</span>
            <span className="text-gray-200">
              {typeLabels[detection.repoType]} ({detection.services.length} svc
              {detection.services.length !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Namespace:</span>
            <span className="text-gray-200 font-mono">{appInfo.team}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Classification:</span>
            <Badge
              variant={
                appInfo.classification === 'UNCLASSIFIED'
                  ? 'success'
                  : appInfo.classification === 'SECRET' ||
                    appInfo.classification === 'TOP SECRET' ||
                    appInfo.classification === 'TS//SCI'
                  ? 'danger'
                  : 'warning'
              }
            >
              {appInfo.classification}
            </Badge>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <span className="text-gray-500 w-28">URL:</span>
            <span className="text-cyan-400 font-mono">
              {appInfo.name || 'my-app'}.{getConfig().domain}
            </span>
          </div>
          {pipelineRun && (
            <div className="flex items-center gap-2 md:col-span-2">
              <span className="text-gray-500 w-28">Pipeline Run:</span>
              <span className="text-gray-300 font-mono text-xs">
                {pipelineRun.id}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Security Summary */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Security Assessment
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400 font-mono">
              {passed + warnings}/{total}
            </p>
            <p className="text-xs text-gray-500 mt-1">Gates Cleared</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-400 font-mono">
              MODERATE
            </p>
            <p className="text-xs text-gray-500 mt-1">Impact Level</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-cyan-400 font-mono">
              {criticalFindings}C / {highFindings}H
            </p>
            <p className="text-xs text-gray-500 mt-1">CVEs (Crit/High)</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-purple-400 font-mono">
              SPDX
            </p>
            <p className="text-xs text-gray-500 mt-1">SBOM Format</p>
          </div>
        </div>
      </div>

      {/* Security Exceptions Summary */}
      {securityExceptions && securityExceptions.filter((e) => e.enabled).length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Security Exceptions
          </h3>
          <div className="space-y-2">
            {securityExceptions.filter((e) => e.enabled).map((exc) => (
              <div
                key={exc.type}
                className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-3"
              >
                <Lock className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {exceptionLabels[exc.type] || exc.type}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{exc.justification}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
                  Pending Review
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Findings Review Status */}
      {totalFindings > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <FileCheck className="w-4 h-4" />
            Finding Mitigations
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-gray-300">
                  {reviewedFindings} of {totalFindings} findings reviewed with mitigations
                </span>
                <span className="text-xs font-mono text-gray-500">
                  {Math.round((reviewedFindings / totalFindings) * 100)}%
                </span>
              </div>
              <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    reviewedFindings === totalFindings ? 'bg-emerald-500' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${(reviewedFindings / totalFindings) * 100}%` }}
                />
              </div>
            </div>
          </div>
          {allCritHighReviewed ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400">
                All critical/high findings addressed
              </span>
            </div>
          ) : critHighFindings.length > 0 ? (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-amber-400">
                {critHighFindings.length - critHighReviewed} critical/high finding{critHighFindings.length - critHighReviewed !== 1 ? 's' : ''} still need mitigations
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={onDownloadPackage}
          className="flex items-center justify-center gap-3 p-4 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group"
        >
          <Download className="w-5 h-5 text-gray-400 group-hover:text-cyan-400" />
          <div className="text-left">
            <p className="text-sm font-medium text-gray-200">
              Download Package
            </p>
            <p className="text-xs text-gray-500">
              SBOM + Scan Reports + STIG Checklist
            </p>
          </div>
        </button>
        {isApproved ? (
          <button className="flex items-center justify-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl group cursor-default">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-emerald-400">Review Approved</p>
              <p className="text-xs text-gray-500">Cleared for deployment</p>
            </div>
          </button>
        ) : isReviewPending && !isAdmin ? (
          <button className="flex items-center justify-center gap-3 p-4 bg-navy-800 border border-navy-600 rounded-xl group cursor-default">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <div className="text-left">
              <p className="text-sm font-medium text-cyan-400">Review Pending...</p>
              <p className="text-xs text-gray-500">Awaiting ISSM decision</p>
            </div>
          </button>
        ) : !isReviewPending && !isApproved && onSubmitForReview ? (
          <button
            onClick={onSubmitForReview}
            className="flex items-center justify-center gap-3 p-4 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group"
          >
            <FileCheck className="w-5 h-5 text-gray-400 group-hover:text-cyan-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-gray-200">Submit for ISSM Review</p>
              <p className="text-xs text-gray-500">Route to security officer</p>
            </div>
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <Button
          variant="secondary"
          onClick={onBack}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          {isRejected ? 'Go Back to Fix' : 'Back'}
        </Button>
        <Button
          onClick={() => {
            if (isAdmin && !pipelineRun?.reviews?.some((r) => r.decision === 'approved')) {
              if (!window.confirm('Deploy without ISSM review? This bypasses RAISE 2.0 approval gates and will be audited.')) {
                return;
              }
            }
            onDeploy();
          }}
          disabled={isRejected || (!isApproved && !isAdmin)}
          icon={<Rocket className="w-4 h-4" />}
          size="lg"
          className="px-8"
        >
          Deploy to Staging
        </Button>
      </div>
    </div>
  );
}
