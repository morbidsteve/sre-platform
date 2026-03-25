import React, { useState, useCallback } from 'react';
import { Search, RefreshCw, Rocket, ExternalLink, BarChart3, Trash2, RotateCcw, FileCode, X, Copy, Download, Clock, Check } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { useUserContext } from '../../context/UserContext';
import { SkeletonCard } from '../ui/Skeleton';
import { fetchRollbackHistory, rollbackApp, fetchAppManifest } from '../../api/apps';
import type { RollbackHistoryEntry } from '../../types/api';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

  // Rollback modal state
  const [rollbackTarget, setRollbackTarget] = useState<{ namespace: string; name: string } | null>(null);
  const [rollbackHistory, setRollbackHistory] = useState<RollbackHistoryEntry[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackInProgress, setRollbackInProgress] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

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
      setRollbackTarget(null);
      setTimeout(refreshApps, 3000);
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setRollbackInProgress(false);
    }
  }, [rollbackTarget, refreshApps]);

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

  const handleDelete = async (namespace: string, name: string) => {
    if (!confirm(`Delete ${name} from ${namespace}? This removes all pods, services, and resources.`)) {
      return;
    }
    try {
      const resp = await fetch(
        `/api/apps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      );
      if (resp.ok) {
        setDeletedKeys((prev) => new Set(prev).add(`${namespace}/${name}`));
        setTimeout(refreshApps, 3000);
      }
    } catch {
      // handle silently
    }
  };

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

  const runningCount = filtered.filter((a) => a.ready).length;
  const deployingCount = filtered.filter((a) => !a.ready).length;
  const countText =
    filtered.length > 0
      ? `${runningCount} running${deployingCount > 0 ? `, ${deployingCount} deploying` : ''}`
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

            return (
              <div
                key={`${app.namespace}/${app.name}`}
                className={`bg-card border border-border border-l-[3px] rounded-[var(--radius)] p-4 transition-all ${
                  app.ready ? 'border-l-green' : 'border-l-yellow'
                } ${
                  hasUrl ? 'cursor-pointer hover:border-border-hover hover:bg-surface-hover' : ''
                }`}
                onClick={hasUrl ? () => handleOpenService(app.url!) : undefined}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-text-bright">{app.name}</span>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                      app.ready
                        ? 'bg-[rgba(64,192,87,0.15)] text-green'
                        : 'bg-[rgba(250,176,5,0.15)] text-yellow'
                    }`}
                  >
                    {app.ready ? 'Running' : 'Deploying'}
                  </span>
                </div>

                <div className="text-xs text-text-dim font-mono mb-2 truncate">
                  {app.image ? `${app.image}:${app.tag}` : 'unknown'}
                </div>

                {hasUrl ? (
                  <a
                    className="text-xs text-accent hover:underline block mb-2 truncate"
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {app.host}
                  </a>
                ) : (
                  <span className="text-xs text-text-dim block mb-2">Cluster-internal only</span>
                )}

                <div className="flex items-center gap-3 text-[11px] text-text-dim mb-3">
                  <span>{app.team || app.namespace}</span>
                  <span>{app.namespace}</span>
                  {app.port && <span>:{app.port}</span>}
                </div>

                <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
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
                  {hasUrl && (
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
                      onClick={() => handleDelete(app.namespace, app.name)}
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
    </div>
  );
}
