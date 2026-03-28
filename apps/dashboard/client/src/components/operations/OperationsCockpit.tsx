import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, RefreshCw, RotateCcw, Activity, Cpu, MemoryStick,
  Terminal, Calendar, Code2, Settings2, Loader2, AlertTriangle,
  CheckCircle2, Clock, Play, Pause, Repeat, Trash2,
} from 'lucide-react';
import { PodStatusCard } from './PodStatusCard';
import { EventsTimeline } from './EventsTimeline';
import { OpsLogViewer } from './LogViewer';
import { ConfigEditor } from './ConfigEditor';
import {
  fetchOpsDiagnostics,
  patchOpsConfig,
  restartApp,
  reconcileApp,
  suspendApp,
  resumeApp,
  redeployApp,
  deleteApp,
  fetchAvailableTags,
} from '../../api/ops';
import type { OpsDiagnostics, OpsConfig } from '../../api/ops';
import { useToast } from '../../context/ToastContext';

// ── Cockpit tab IDs ─────────────────────────────────────────────────────────

const COCKPIT_TABS = [
  { id: 'config', label: 'Configuration', icon: Settings2 },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'yaml', label: 'YAML', icon: Code2 },
] as const;

type CockpitTab = (typeof COCKPIT_TABS)[number]['id'];

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, restartCount }: { status: string; restartCount: number }) {
  const isCrash = status.toLowerCase().includes('crash') || restartCount > 5;
  const isPending = status.toLowerCase() === 'pending' || status.toLowerCase() === 'unknown';
  const isRunning = status.toLowerCase() === 'running';

  const color = isCrash
    ? 'bg-red/15 text-red border-red/30'
    : isPending
    ? 'bg-yellow/15 text-yellow border-yellow/30'
    : isRunning
    ? 'bg-green/15 text-green border-green/30'
    : 'bg-text-muted/15 text-text-dim border-border';

  const dot = isCrash
    ? 'bg-red'
    : isPending
    ? 'bg-yellow'
    : isRunning
    ? 'bg-green'
    : 'bg-text-dim';

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${color}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${dot}`}
        style={isRunning && !isCrash ? { boxShadow: '0 0 4px var(--green)' } : undefined}
      />
      {status}
    </span>
  );
}

// ── Resource usage bar ───────────────────────────────────────────────────────

function ResourceBar({
  label,
  used,
  limit,
  request,
  pct,
  unit,
}: {
  label: string;
  used: string | null;
  limit: string;
  request: string;
  pct: number | null;
  unit: 'cpu' | 'mem';
}) {
  const barColor =
    pct === null
      ? 'bg-accent/40'
      : pct > 85
      ? 'bg-red'
      : pct > 65
      ? 'bg-yellow'
      : 'bg-green';

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
        <div className="flex items-center gap-1.5">
          {unit === 'cpu' ? (
            <Cpu className="w-3 h-3 text-text-dim" />
          ) : (
            <MemoryStick className="w-3 h-3 text-text-dim" />
          )}
          <span className="text-text-dim uppercase tracking-wide text-[9px]">{label}</span>
        </div>
        <span className="text-text-primary">
          {used ? `${used}` : '—'} / limit {limit}
        </span>
      </div>
      <div className="h-1.5 bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: pct !== null ? `${Math.min(pct, 100)}%` : '8%' }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono text-text-muted mt-0.5">
        <span>req {request}</span>
        {pct !== null && <span>{pct}%</span>}
      </div>
    </div>
  );
}

// ── Main OperationsCockpit ──────────────────────────────────────────────────

export interface OperationsCockpitProps {
  namespace: string;
  name: string;
  onClose: () => void;
}

export function OperationsCockpit({ namespace, name, onClose }: OperationsCockpitProps) {
  const { showToast } = useToast();

  const [data, setData] = useState<OpsDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CockpitTab>('config');
  const [applying, setApplying] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'suspend' | 'resume' | 'redeploy' | 'delete' | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [yamlCopied, setYamlCopied] = useState(false);

  // Poll interval ref so we can cancel on close
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await fetchOpsDiagnostics(namespace, name);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, [namespace, name]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Poll every 10s for pod/event updates
  useEffect(() => {
    pollRef.current = setInterval(() => {
      // Silent refresh — don't show loading spinner on poll
      fetchOpsDiagnostics(namespace, name)
        .then((d) => setData(d))
        .catch(() => {/* silent */});
    }, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [namespace, name]);

  // Fetch available tags from Harbor
  useEffect(() => {
    fetchAvailableTags(namespace, name)
      .then((r) => setAvailableTags(r.tags))
      .catch(() => {/* silent — tags are optional */});
  }, [namespace, name]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleApplyConfig = useCallback(async (config: OpsConfig) => {
    setApplying(true);
    try {
      await patchOpsConfig(namespace, name, config);
      showToast(`Configuration applied to ${name}`, 'success');
      // Reload after apply
      setTimeout(load, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply config';
      showToast(`Apply failed: ${msg}`, 'error');
    } finally {
      setApplying(false);
    }
  }, [namespace, name, load, showToast]);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartApp(namespace, name);
      showToast(`Restart triggered for ${name}`, 'success');
      setTimeout(load, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restart failed';
      showToast(`Restart failed: ${msg}`, 'error');
    } finally {
      setTimeout(() => setRestarting(false), 3000);
    }
  }, [namespace, name, load, showToast, restarting]);

  const handleReconcile = useCallback(async () => {
    if (reconciling) return;
    setReconciling(true);
    try {
      await reconcileApp(namespace, name);
      showToast(`Reconcile triggered for ${name}`, 'success');
      setTimeout(load, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reconcile failed';
      showToast(`Reconcile failed: ${msg}`, 'error');
    } finally {
      setTimeout(() => setReconciling(false), 3000);
    }
  }, [namespace, name, load, showToast, reconciling]);

  const handleSuspend = useCallback(async () => {
    setSuspendBusy(true);
    setConfirmAction(null);
    try {
      await suspendApp(namespace, name);
      setSuspended(true);
      showToast(`${name} suspended`, 'success');
      setTimeout(load, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Suspend failed';
      showToast(`Suspend failed: ${msg}`, 'error');
    } finally {
      setSuspendBusy(false);
    }
  }, [namespace, name, load, showToast]);

  const handleResume = useCallback(async () => {
    setSuspendBusy(true);
    setConfirmAction(null);
    try {
      await resumeApp(namespace, name);
      setSuspended(false);
      showToast(`${name} resumed`, 'success');
      setTimeout(load, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Resume failed';
      showToast(`Resume failed: ${msg}`, 'error');
    } finally {
      setSuspendBusy(false);
    }
  }, [namespace, name, load, showToast]);

  const handleRedeploy = useCallback(async () => {
    setRedeploying(true);
    setConfirmAction(null);
    try {
      await redeployApp(namespace, name);
      showToast(`Redeploy triggered for ${name}`, 'success');
      setTimeout(load, 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Redeploy failed';
      showToast(`Redeploy failed: ${msg}`, 'error');
    } finally {
      setTimeout(() => setRedeploying(false), 5000);
    }
  }, [namespace, name, load, showToast]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setConfirmAction(null);
    try {
      await deleteApp(namespace, name);
      showToast(`${name} deleted`, 'success');
      setTimeout(onClose, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(`Delete failed: ${msg}`, 'error');
      setDeleting(false);
    }
  }, [namespace, name, onClose, showToast]);

  const handleCopyYaml = () => {
    if (!data?.helmReleaseYaml) return;
    navigator.clipboard.writeText(data.helmReleaseYaml).then(() => {
      setYamlCopied(true);
      setTimeout(() => setYamlCopied(false), 2000);
    });
  };

  // Pod list for log viewer
  const podList = (data?.pods || []).map((p) => ({
    name: p.name,
    containers: p.containers.length > 0 ? p.containers : [name],
  }));

  return (
    <div
      className="fixed inset-0 z-[350] flex"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Full-screen panel */}
      <div
        className="relative flex flex-col w-full max-w-[1400px] mx-auto my-4 bg-[#0a0e1a] border border-border rounded-xl overflow-hidden shadow-2xl"
        style={{ animation: 'confirmIn 0.2s ease-out' }}
      >
        {/* ── Header bar ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-[#0d1117] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Activity className="w-4 h-4 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-text-bright font-mono">{name}</span>
                <span className="text-[11px] text-text-dim font-mono">{namespace}</span>
                {data && (
                  <StatusBadge
                    status={data.app.status}
                    restartCount={data.app.restartCount}
                  />
                )}
              </div>
              {data && (
                <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted mt-0.5 flex-wrap">
                  <span className="truncate max-w-[280px]">{data.app.image}:{data.app.tag}</span>
                  {data.app.uptime && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      up {data.app.uptime}
                    </span>
                  )}
                  {data.app.restartCount > 0 && (
                    <span className="text-yellow flex items-center gap-0.5">
                      <RotateCcw className="w-2.5 h-2.5" />
                      {data.app.restartCount} restarts
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 ${reconciling ? 'opacity-50' : ''}`}
              onClick={handleReconcile}
              disabled={reconciling}
              title="Reconcile Flux HelmRelease"
            >
              <Repeat className={`w-3 h-3 ${reconciling ? 'animate-spin' : ''}`} />
              {reconciling ? 'Reconciling…' : 'Reconcile'}
            </button>
            <button
              className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 ${suspendBusy ? 'opacity-50' : ''}`}
              onClick={() => setConfirmAction(suspended ? 'resume' : 'suspend')}
              disabled={suspendBusy}
              title={suspended ? 'Resume Flux reconciliation' : 'Suspend Flux reconciliation'}
            >
              {suspended ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {suspendBusy ? '…' : suspended ? 'Resume' : 'Suspend'}
            </button>
            <button
              className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 ${restarting ? 'opacity-50' : ''}`}
              onClick={handleRestart}
              disabled={restarting}
              title="Restart all pods"
            >
              <RotateCcw className={`w-3 h-3 ${restarting ? 'animate-spin' : ''}`} />
              {restarting ? 'Restarting…' : 'Restart'}
            </button>
            <button
              className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 text-yellow ${redeploying ? 'opacity-50' : ''}`}
              onClick={() => setConfirmAction('redeploy')}
              disabled={redeploying}
              title="Delete and recreate HelmRelease"
            >
              <RefreshCw className={`w-3 h-3 ${redeploying ? 'animate-spin' : ''}`} />
              {redeploying ? 'Redeploying…' : 'Redeploy'}
            </button>
            <button
              className={`btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1 text-red hover:bg-red/10 ${deleting ? 'opacity-50' : ''}`}
              onClick={() => setConfirmAction('delete')}
              disabled={deleting}
              title="Permanently delete application"
            >
              <Trash2 className="w-3 h-3" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button
              className="btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1"
              onClick={() => { setLoading(true); load(); }}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-text-dim hover:text-text-primary transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Primary Issue Banner ──────────────────────────────────────── */}
        {data?.primaryIssue && (
          <div
            className={`flex items-start gap-2 px-5 py-2.5 border-b text-xs font-mono flex-shrink-0 ${
              data.primaryIssue.severity === 'critical'
                ? 'border-red/30 bg-red/5 text-red'
                : 'border-yellow/30 bg-yellow/5 text-yellow'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">{data.primaryIssue.type}:</span>{' '}
              {data.primaryIssue.message}
            </div>
          </div>
        )}

        {/* ── Body ──────────────────────────────────────────────────────── */}
        {loading && !data ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : error && !data ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <AlertTriangle className="w-8 h-8 text-yellow" />
            <div className="text-sm text-text-dim">{error}</div>
            <button className="btn text-xs !py-1.5 !px-3 !min-h-0" onClick={load}>
              Retry
            </button>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* ── Left column: Status & Monitoring (30%) ────────────── */}
            <div className="w-[30%] min-w-[240px] border-r border-border flex flex-col overflow-hidden bg-[#0d1117]">
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Pod Status Cards */}
                <section>
                  <div className="flex items-center justify-between mb-2.5">
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
                      Pods ({data?.pods.length ?? 0})
                    </h4>
                    {(data?.pods.filter((p) => p.restarts > 0).length ?? 0) > 0 && (
                      <span className="text-[9px] font-mono text-yellow flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {data!.pods.filter((p) => p.restarts > 0).length} restarting
                      </span>
                    )}
                  </div>
                  {data && data.pods.length > 0 ? (
                    <div className="space-y-2">
                      {data.pods.map((pod) => (
                        <PodStatusCard key={pod.name} pod={pod} />
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-text-muted font-mono text-center py-4">
                      No pods found
                    </div>
                  )}
                </section>

                {/* Resource Usage */}
                {data?.resources && (
                  <section>
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-dim mb-2.5">
                      Resource Usage
                    </h4>
                    <div className="bg-surface border border-border rounded-[var(--radius)] p-3 space-y-3">
                      <ResourceBar
                        label="CPU"
                        used={data.resources.cpu.used}
                        limit={data.resources.cpu.limit}
                        request={data.resources.cpu.request}
                        pct={data.resources.cpu.pct}
                        unit="cpu"
                      />
                      <ResourceBar
                        label="Memory"
                        used={data.resources.memory.used}
                        limit={data.resources.memory.limit}
                        request={data.resources.memory.request}
                        pct={data.resources.memory.pct}
                        unit="mem"
                      />
                    </div>
                  </section>
                )}

                {/* Events Timeline (compact) */}
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-dim mb-2.5">
                    Recent Events
                  </h4>
                  <EventsTimeline
                    events={data?.events.slice(0, 10) || []}
                    maxHeight="240px"
                    compact
                  />
                </section>

                {/* Quick status */}
                {data && (
                  <section>
                    <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-dim mb-2.5">
                      Health
                    </h4>
                    <div className="space-y-1.5">
                      {[
                        {
                          label: 'Pods Ready',
                          ok: data.pods.every((p) => p.ready),
                          detail: `${data.pods.filter((p) => p.ready).length}/${data.pods.length}`,
                        },
                        {
                          label: 'No Crash Loops',
                          ok: data.pods.every((p) => p.restarts < 5),
                          detail: data.pods.some((p) => p.restarts >= 5)
                            ? `${data.pods.filter((p) => p.restarts >= 5).length} pod(s)`
                            : 'OK',
                        },
                        {
                          label: 'No Warning Events',
                          ok: !data.events.some((e) => e.type === 'Warning'),
                          detail: data.events.some((e) => e.type === 'Warning')
                            ? `${data.events.filter((e) => e.type === 'Warning').length} warning(s)`
                            : 'OK',
                        },
                      ].map(({ label, ok, detail }) => (
                        <div key={label} className="flex items-center justify-between text-[11px] font-mono">
                          <div className="flex items-center gap-1.5">
                            {ok ? (
                              <CheckCircle2 className="w-3 h-3 text-green flex-shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-yellow flex-shrink-0" />
                            )}
                            <span className="text-text-dim">{label}</span>
                          </div>
                          <span className={ok ? 'text-green' : 'text-yellow'}>{detail}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>

            {/* ── Right column: Tabs (70%) ──────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center gap-1 px-4 pt-3 border-b border-border flex-shrink-0 bg-[#0d1117]">
                {COCKPIT_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono border-b-2 transition-all -mb-px ${
                        activeTab === tab.id
                          ? 'border-accent text-accent'
                          : 'border-transparent text-text-dim hover:text-text-primary hover:border-border-hover'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-5 min-h-0">
                {/* ── Tab: Configuration ── */}
                {activeTab === 'config' && data && (
                  <ConfigEditor
                    config={data.config}
                    policyExceptions={data.policyExceptions}
                    availableTags={availableTags}
                    onApply={handleApplyConfig}
                    applying={applying}
                  />
                )}
                {activeTab === 'config' && !data && (
                  <div className="text-text-dim text-xs font-mono text-center py-12">
                    Loading configuration…
                  </div>
                )}

                {/* ── Tab: Logs ── */}
                {activeTab === 'logs' && (
                  <div className="h-full flex flex-col" style={{ minHeight: '480px' }}>
                    {podList.length > 0 ? (
                      <OpsLogViewer
                        namespace={namespace}
                        name={name}
                        pods={podList}
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-text-dim text-xs font-mono">
                        No running pods — no logs available
                      </div>
                    )}
                  </div>
                )}

                {/* ── Tab: Events ── */}
                {activeTab === 'events' && (
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text-bright">
                        Events for {name}
                      </h3>
                      <span className="text-[11px] font-mono text-text-dim">
                        {data?.events.length ?? 0} events
                      </span>
                    </div>
                    <EventsTimeline
                      events={data?.events || []}
                      maxHeight="calc(100vh - 280px)"
                    />
                  </div>
                )}

                {/* ── Tab: YAML ── */}
                {activeTab === 'yaml' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text-bright">
                        HelmRelease YAML
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn text-[11px] !px-2.5 !py-1 !min-h-0 flex items-center gap-1"
                          onClick={handleCopyYaml}
                          disabled={!data?.helmReleaseYaml}
                        >
                          {yamlCopied ? (
                            <CheckCircle2 className="w-3 h-3 text-green" />
                          ) : (
                            <Code2 className="w-3 h-3" />
                          )}
                          {yamlCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <pre
                      className="flex-1 overflow-auto bg-[#060911] border border-border rounded-[var(--radius)] p-4 text-[11px] font-mono text-text-dim whitespace-pre leading-relaxed"
                      style={{ minHeight: '400px', maxHeight: 'calc(100vh - 300px)' }}
                    >
                      {data?.helmReleaseYaml || '# No YAML available'}
                    </pre>
                    <p className="text-[10px] text-text-muted font-mono">
                      This is the live HelmRelease manifest as seen by Flux CD.
                      Use the Configuration tab to make changes.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation dialog ──────────────────────────────────── */}
        {confirmAction && (
          <div
            className="absolute inset-0 z-[400] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setConfirmAction(null)}
          >
            <div
              className="bg-[#0d1117] border border-border rounded-lg p-5 max-w-sm w-full mx-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ animation: 'confirmIn 0.15s ease-out' }}
            >
              <h3 className="text-sm font-semibold text-text-bright mb-2">
                {confirmAction === 'delete' && 'Delete Application'}
                {confirmAction === 'redeploy' && 'Redeploy Application'}
                {confirmAction === 'suspend' && 'Suspend Reconciliation'}
                {confirmAction === 'resume' && 'Resume Reconciliation'}
              </h3>
              <p className="text-xs text-text-dim mb-4 leading-relaxed">
                {confirmAction === 'delete' &&
                  'This will permanently remove the application. This cannot be undone.'}
                {confirmAction === 'redeploy' &&
                  'This will delete and recreate the HelmRelease. Continue?'}
                {confirmAction === 'suspend' &&
                  'This will suspend Flux reconciliation. The app will keep running but changes will not be applied.'}
                {confirmAction === 'resume' &&
                  'This will resume Flux reconciliation for this application.'}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  className="btn text-[11px] !px-3 !py-1.5 !min-h-0"
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
                <button
                  className={`btn text-[11px] !px-3 !py-1.5 !min-h-0 font-semibold ${
                    confirmAction === 'delete'
                      ? 'bg-red/15 text-red border-red/30 hover:bg-red/25'
                      : confirmAction === 'redeploy'
                      ? 'bg-yellow/15 text-yellow border-yellow/30 hover:bg-yellow/25'
                      : 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
                  }`}
                  onClick={() => {
                    if (confirmAction === 'delete') handleDelete();
                    else if (confirmAction === 'redeploy') handleRedeploy();
                    else if (confirmAction === 'suspend') handleSuspend();
                    else if (confirmAction === 'resume') handleResume();
                  }}
                >
                  {confirmAction === 'delete' && 'Delete'}
                  {confirmAction === 'redeploy' && 'Redeploy'}
                  {confirmAction === 'suspend' && 'Suspend'}
                  {confirmAction === 'resume' && 'Resume'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
