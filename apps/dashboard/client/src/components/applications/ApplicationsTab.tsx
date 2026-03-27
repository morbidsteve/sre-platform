import React, { useState, useCallback } from 'react';
import { Search, RefreshCw, Rocket, ExternalLink, BarChart3, Trash2, RotateCcw, FileCode, X, Copy, Download, Clock, Check, AlertTriangle, ShieldAlert, Stethoscope, Gauge } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { useUserContext } from '../../context/UserContext';
import { useToast } from '../../context/ToastContext';
import { SkeletonCard } from '../ui/Skeleton';
import { fetchRollbackHistory, rollbackApp, fetchAppManifest } from '../../api/apps';
import { AppDiagnostics } from './AppDiagnostics';
import { OperationsCockpit } from '../operations/OperationsCockpit';
import type { RollbackHistoryEntry, App } from '../../types/api';

// Policy name → fix guidance (sourced from error-knowledge-base.js)
const POLICY_FIXES: Record<string, string> = {
  'require-run-as-nonroot': 'Add `USER 1000` to your Dockerfile, or set `securityContext.runAsNonRoot: true` in your Helm values.',
  'require-security-context': 'Ensure your deployment has `securityContext.allowPrivilegeEscalation: false` and `capabilities.drop: ["ALL"]`.',
  'restrict-image-registries': 'Pull your image from `harbor.apps.sre.example.com`, not Docker Hub.',
  'disallow-latest-tag': 'Pin your image to a specific version tag (e.g., `:v1.2.3`), not `:latest`.',
  'require-resource-limits': 'Set `resources.requests` and `resources.limits` for CPU and memory.',
  'require-probes': 'Add `livenessProbe` and `readinessProbe` to your container spec.',
  'require-labels': 'Add required labels: `app.kubernetes.io/name`, `app.kubernetes.io/part-of`, `sre.io/team`.',
  'verify-image-signatures': 'Sign your image with Cosign before pushing to Harbor.',
  'disallow-privileged-containers': 'Remove `privileged: true` from your container securityContext.',
  'disallow-host-namespaces': 'Remove hostPID, hostIPC, and hostNetwork from your pod spec.',
  'disallow-privilege-escalation': 'Set `allowPrivilegeEscalation: false` in your container securityContext.',
  'require-drop-all-capabilities': 'Add `capabilities.drop: [ALL]` to your container securityContext.',
  'disallow-default-namespace': 'Deploy to your team namespace instead of "default".',
  'require-network-policies': 'Contact your platform admin. Run `./scripts/onboard-tenant.sh <team-name>`.',
};

function getPolicyFixFromMessage(message: string): string | null {
  for (const [policyName, fix] of Object.entries(POLICY_FIXES)) {
    if (message.toLowerCase().includes(policyName.toLowerCase())) {
      return fix;
    }
  }
  return null;
}

type AppStatusLabel = 'Running' | 'Deploying' | 'Failed' | 'Policy Denied';

interface AppStatus {
  label: AppStatusLabel;
  color: 'green' | 'yellow' | 'red';
  reason: string | null;
}

function getAppStatus(app: App): AppStatus {
  const hasPolicyViolation = app.policyViolations && app.policyViolations.length > 0;
  if (hasPolicyViolation) {
    return { label: 'Policy Denied', color: 'red', reason: app.statusReason || null };
  }
  const reason = app.statusReason || '';
  if (
    app.status === 'failed' ||
    reason.includes('CrashLoop') ||
    reason.includes('Error') ||
    reason.includes('BackOff') ||
    reason.includes('ImagePull') ||
    reason.includes('OOMKilled') ||
    reason.includes('Failed')
  ) {
    return { label: 'Failed', color: 'red', reason: reason || null };
  }
  if (app.ready) {
    return { label: 'Running', color: 'green', reason: null };
  }
  return { label: 'Deploying', color: 'yellow', reason: reason || 'Waiting for pods...' };
}

interface ApplicationsTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onOpenApp: (url: string, title: string) => void;
  onSwitchTab: (tab: string) => void;
}

export function ApplicationsTab({ user, onOpenApp, onSwitchTab }: ApplicationsTabProps) {
  const config = useConfig();
  const { apps: appsData } = useData();
  const { apps, loading, refreshApps } = appsData;
  const { selectedTeam, isAdmin: isAdminUser } = useUserContext();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

  // Rollback modal state
  const [rollbackTarget, setRollbackTarget] = useState<{ namespace: string; name: string } | null>(null);
  const [rollbackHistory, setRollbackHistory] = useState<RollbackHistoryEntry[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackInProgress, setRollbackInProgress] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  // Diagnostics panel state
  const [diagTarget, setDiagTarget] = useState<{ namespace: string; name: string } | null>(null);

  // Operations cockpit state
  const [cockpitTarget, setCockpitTarget] = useState<{ namespace: string; name: string } | null>(null);

  // YAML export modal state
  const [yamlTarget, setYamlTarget] = useState<{ namespace: string; name: string } | null>(null);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlCopied, setYamlCopied] = useState(false);

  const handleOpenRollback = useCallback(async (namespace: string, name: string) => {
    setRollbackTarget({ namespace, name });
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const data = await fetchRollbackHistory(namespace, name);
      setRollbackHistory(data.history || []);
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setRollbackLoading(false);
    }
  }, []);

  const handleRollback = useCallback(async (revision: number) => {
    if (!rollbackTarget) return;
    setRollbackInProgress(true);
    setRollbackError(null);
    try {
      await rollbackApp(rollbackTarget.namespace, rollbackTarget.name, revision);
      showToast(`Rolled back ${rollbackTarget.name} to revision ${revision}`, 'success');
      setRollbackTarget(null);
      setTimeout(refreshApps, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rollback failed';
      setRollbackError(message);
      showToast(`Rollback failed: ${message}`, 'error');
    } finally {
      setRollbackInProgress(false);
    }
  }, [rollbackTarget, refreshApps, showToast]);

  const handleOpenYaml = useCallback(async (namespace: string, name: string) => {
    setYamlTarget({ namespace, name });
    setYamlLoading(true);
    setYamlCopied(false);
    try {
      const data = await fetchAppManifest(namespace, name);
      setYamlContent(data.yaml);
    } catch (err) {
      setYamlContent('# Failed to load manifest: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setYamlLoading(false);
    }
  }, []);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yamlContent).then(() => {
      setYamlCopied(true);
      setTimeout(() => setYamlCopied(false), 2000);
    });
  }, [yamlContent]);

  const handleDownloadYaml = useCallback(() => {
    if (!yamlTarget) return;
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${yamlTarget.name}-${yamlTarget.namespace}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [yamlContent, yamlTarget]);

  const [deleteTarget, setDeleteTarget] = useState<{ namespace: string; name: string } | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const { namespace, name } = deleteTarget;
    setDeleteInProgress(true);
    try {
      const resp = await fetch(
        `/api/apps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      );
      if (resp.ok) {
        setDeletedKeys((prev) => new Set(prev).add(`${namespace}/${name}`));
        showToast(`Deleted ${name}`, 'success');
        setTimeout(refreshApps, 3000);
      } else {
        const data = await resp.json().catch(() => ({}));
        showToast(`Delete failed: ${data.error || `HTTP ${resp.status}`}`, 'error');
      }
    } catch (err) {
      showToast(`Delete failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
    } finally {
      setDeleteInProgress(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, refreshApps, showToast]);

  const handleOpenService = (url: string) => {
    if (url.includes(`dsop.${config.domain}`)) {
      onOpenApp(url, 'DSOP Security Pipeline');
      return;
    }
    if (url.includes(`portal.${config.domain}`)) {
      onOpenApp(url, 'App Portal');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  // Filter out optimistically deleted apps, then apply team filter, then search
  const visibleApps = apps.filter((a) => !deletedKeys.has(`${a.namespace}/${a.name}`));

  // Apply team filter
  const teamFiltered = selectedTeam
    ? visibleApps.filter((a) => a.namespace === selectedTeam || a.team === selectedTeam.replace(/^team-/, ''))
    : visibleApps;

  const filtered = searchQuery
    ? teamFiltered.filter((a) => {
        const q = searchQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          (a.team || '').toLowerCase().includes(q) ||
          (a.image || '').toLowerCase().includes(q) ||
          (a.namespace || '').toLowerCase().includes(q)
        );
      })
    : teamFiltered;

  const runningCount = filtered.filter((a) => getAppStatus(a).label === 'Running').length;
  const deployingCount = filtered.filter((a) => getAppStatus(a).label === 'Deploying').length;
  const failedCount = filtered.filter((a) => {
    const s = getAppStatus(a).label;
    return s === 'Failed' || s === 'Policy Denied';
  }).length;
  const countText =
    filtered.length > 0
      ? `${runningCount} running${deployingCount > 0 ? `, ${deployingCount} deploying` : ''}${failedCount > 0 ? `, ${failedCount} failed` : ''}`
      : '';

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright mb-1">Applications</h2>
          <p className="text-text-dim text-[13px]">
            Running applications on the SRE Platform.
          </p>
        </div>
      </div>

      {/* Search and controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search apps by name, team, namespace, or image..."
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-xs text-text-dim font-mono">{countText}</span>
        <button
          className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1"
          onClick={refreshApps}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* App Cards Grid */}
      {loading && visibleApps.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-card border border-border rounded-[var(--radius)]">
          <h3 className="text-base font-semibold text-text-primary mb-2">
            {visibleApps.length === 0 ? 'No applications deployed yet' : 'No apps match your search'}
          </h3>
          {visibleApps.length === 0 && (
            <>
              <p className="text-sm text-text-dim mb-4">
                Get started by deploying your first application.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => onSwitchTab('deploy')}
              >
                <Rocket className="w-4 h-4 inline-block mr-1" />
                Go to Deploy
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((app) => {
            const hasUrl = !!(app.url && app.host);
            const grafanaUrl = `${serviceUrl(config, 'grafana')}/explore?orgId=1&left=%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22expr%22:%22%7Bnamespace%3D%5C%22${encodeURIComponent(app.namespace)}%5C%22%7D%22%7D%5D%7D`;
            const appStatus = getAppStatus(app);
            const isFailed = appStatus.color === 'red';

            const borderColor = isFailed
              ? 'border-l-red'
              : appStatus.color === 'green'
              ? 'border-l-green'
              : 'border-l-yellow';

            const badgeClass = isFailed
              ? 'bg-[rgba(239,68,68,0.15)] text-red'
              : appStatus.color === 'green'
              ? 'bg-[rgba(64,192,87,0.15)] text-green'
              : 'bg-[rgba(250,176,5,0.15)] text-yellow';

            return (
              <div
                key={`${app.namespace}/${app.name}`}
                className={`bg-card border border-border border-l-[3px] rounded-[var(--radius)] p-4 transition-all ${borderColor} ${
                  hasUrl && !isFailed ? 'cursor-pointer hover:border-border-hover hover:bg-surface-hover' : ''
                }`}
                onClick={hasUrl && !isFailed ? () => handleOpenService(app.url!) : undefined}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {isFailed && <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0" />}
                    <span className="font-semibold text-sm text-text-bright">{app.name}</span>
                  </div>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${badgeClass}`}>
                    {appStatus.label}
                  </span>
                </div>

                <div className="text-xs text-text-dim font-mono mb-2 truncate">
                  {app.image ? `${app.image}:${app.tag}` : 'unknown'}
                </div>

                {/* Failure reason */}
                {isFailed && appStatus.reason && (
                  <div className="mb-2 px-2 py-1.5 rounded bg-red/5 border border-red/20 text-xs text-red font-mono">
                    {appStatus.reason}
                  </div>
                )}

                {/* Policy violations */}
                {app.policyViolations && app.policyViolations.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {app.policyViolations.slice(0, 2).map((pv, idx) => {
                      const policyNameMatch = pv.message.match(/policy\s+([\w-]+)/i);
                      const policyName = policyNameMatch ? policyNameMatch[1] : '';
                      const fix = getPolicyFixFromMessage(pv.message);
                      return (
                        <div key={idx} className="px-2 py-1.5 rounded bg-red/5 border border-red/20">
                          <div className="flex items-start gap-1.5">
                            <ShieldAlert className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              {policyName && (
                                <div className="text-[11px] font-mono text-red font-semibold">{policyName}</div>
                              )}
                              <div className="text-[11px] text-text-dim leading-tight">{pv.message.substring(0, 120)}</div>
                              {fix && (
                                <div className="mt-1 text-[11px] text-text-primary font-mono bg-bg rounded px-1.5 py-1 leading-relaxed">
                                  Fix: {fix}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {hasUrl && !isFailed ? (
                  <a
                    className="text-xs text-accent hover:underline block mb-2 truncate"
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {app.host}
                  </a>
                ) : !isFailed ? (
                  <span className="text-xs text-text-dim block mb-2">Cluster-internal only</span>
                ) : null}

                <div className="flex items-center gap-3 text-[11px] text-text-dim mb-3">
                  <span>{app.team || app.namespace}</span>
                  <span>{app.namespace}</span>
                  {app.port && <span>:{app.port}</span>}
                </div>

                <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 ${isFailed ? 'btn-danger' : ''}`}
                    onClick={() => setDiagTarget({ namespace: app.namespace, name: app.name })}
                    title="Open diagnostics panel"
                  >
                    <Stethoscope className="w-3 h-3" />
                    Diagnose
                  </button>
                  {(user.isAdmin || user.role === 'developer') && (
                    <button
                      className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 border-accent/40 text-accent hover:bg-accent/10"
                      onClick={() => setCockpitTarget({ namespace: app.namespace, name: app.name })}
                      title="Open Operations Cockpit"
                    >
                      <Gauge className="w-3 h-3" />
                      Cockpit
                    </button>
                  )}
                  <a
                    className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
                    href={grafanaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BarChart3 className="w-3 h-3" />
                    Logs
                  </a>
                  <button
                    className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1"
                    onClick={() => handleOpenYaml(app.namespace, app.name)}
                    title="Export YAML"
                  >
                    <FileCode className="w-3 h-3" />
                    YAML
                  </button>
                  {(user.isAdmin || user.role === 'developer') && (
                    <button
                      className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1"
                      onClick={() => handleOpenRollback(app.namespace, app.name)}
                      title="Rollback to previous version"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Rollback
                    </button>
                  )}
                  {hasUrl && !isFailed && (
                    <a
                      className="btn btn-primary text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                  )}
                  {user.isAdmin && (
                    <button
                      className="btn btn-danger text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1"
                      onClick={() => setDeleteTarget({ namespace: app.namespace, name: app.name })}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Diagnostics Panel */}
      {diagTarget && (
        <AppDiagnostics
          namespace={diagTarget.namespace}
          name={diagTarget.name}
          onClose={() => setDiagTarget(null)}
        />
      )}

      {/* Operations Cockpit */}
      {cockpitTarget && (
        <OperationsCockpit
          namespace={cockpitTarget.namespace}
          name={cockpitTarget.name}
          onClose={() => setCockpitTarget(null)}
        />
      )}

      {/* Rollback Modal */}
      {rollbackTarget && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setRollbackTarget(null); }}
        >
          <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl" style={{ animation: 'confirmIn 0.2s ease-out' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-bright flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
                Rollback {rollbackTarget.name}
              </h3>
              <button onClick={() => setRollbackTarget(null)} className="text-text-dim hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[400px] overflow-y-auto">
              {rollbackError && (
                <div className="mb-3 px-3 py-2 rounded text-xs border bg-red/10 border-red/20 text-red">{rollbackError}</div>
              )}
              {rollbackLoading ? (
                <div className="text-center py-8 text-text-dim text-sm">Loading version history...</div>
              ) : rollbackHistory.length === 0 ? (
                <div className="text-center py-8 text-text-dim text-sm">No version history available</div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-dim mb-3">Select a version to rollback to:</p>
                  {rollbackHistory.map((entry, idx) => (
                    <div
                      key={entry.revision}
                      className={`flex items-center justify-between p-3 rounded border transition-colors ${
                        idx === 0
                          ? 'border-green/30 bg-green/5'
                          : 'border-border bg-surface hover:bg-surface-hover cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-semibold text-text-bright">v{entry.revision}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          entry.status === 'deployed' ? 'bg-green/15 text-green' :
                          entry.status === 'superseded' ? 'bg-text-dim/15 text-text-dim' :
                          'bg-yellow/15 text-yellow'
                        }`}>
                          {entry.status}
                        </span>
                        <span className="text-xs text-text-dim flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {entry.updated ? new Date(entry.updated).toLocaleString() : '--'}
                        </span>
                      </div>
                      {idx === 0 ? (
                        <span className="text-[10px] text-green font-medium">current</span>
                      ) : (
                        <button
                          className="btn text-[11px] !px-2.5 !py-1 !min-h-0"
                          onClick={() => handleRollback(entry.revision)}
                          disabled={rollbackInProgress}
                        >
                          {rollbackInProgress ? 'Rolling back...' : 'Rollback'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* YAML Export Modal */}
      {yamlTarget && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setYamlTarget(null); }}
        >
          <div className="bg-card border border-border rounded-xl w-full max-w-3xl mx-4 overflow-hidden shadow-2xl" style={{ animation: 'confirmIn 0.2s ease-out' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-bright flex items-center gap-2">
                <FileCode className="w-4 h-4" />
                {yamlTarget.name} — YAML Manifest
              </h3>
              <div className="flex items-center gap-2">
                <button
                  className="btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1"
                  onClick={handleCopyYaml}
                  disabled={yamlLoading}
                >
                  {yamlCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {yamlCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1"
                  onClick={handleDownloadYaml}
                  disabled={yamlLoading}
                >
                  <Download className="w-3 h-3" />
                  Download
                </button>
                <button onClick={() => setYamlTarget(null)} className="text-text-dim hover:text-text-primary">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="px-5 py-4 max-h-[500px] overflow-auto">
              {yamlLoading ? (
                <div className="text-center py-8 text-text-dim text-sm">Loading manifest...</div>
              ) : (
                <pre className="text-xs font-mono text-text-primary bg-bg p-4 rounded border border-border overflow-x-auto whitespace-pre">
                  {yamlContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleteInProgress) setDeleteTarget(null); }}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-sm mx-4 overflow-hidden shadow-2xl"
            style={{ animation: 'confirmIn 0.2s ease-out' }}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-bright flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red" />
                Confirm Delete
              </h3>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteInProgress}
                className="text-text-dim hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-text-primary mb-1">
                Delete <span className="font-semibold text-text-bright">{deleteTarget.name}</span>?
              </p>
              <p className="text-xs text-text-dim mb-4">
                This removes all pods, services, and resources from{' '}
                <span className="font-mono">{deleteTarget.namespace}</span>. This cannot be undone.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  className="btn text-xs !py-1.5 !px-3 !min-h-0"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteInProgress}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1"
                  onClick={handleDeleteConfirm}
                  disabled={deleteInProgress}
                >
                  <Trash2 className="w-3 h-3" />
                  {deleteInProgress ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
