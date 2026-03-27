import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchPlatformPods } from '../../api/platform';
import { fetchPodDetail, deletePod } from '../../api/cluster';
import { fetchNamespaces } from '../../api/cluster';
import { useUser } from '../../hooks/useUser';
import type { PlatformPod } from '../../api/platform';
import type { Namespace, PodDetail } from '../../types/api';
import { LogViewer } from '../cluster/LogViewer';

// ── Status helpers ──────────────────────────────────────────────────────────

function statusDotColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return 'bg-green';
  if (s === 'pending' || s === 'containercreating' || s === 'init') return 'bg-yellow';
  if (s === 'succeeded' || s === 'completed') return 'bg-[#60a5fa]';
  return 'bg-red';
}

function rowBg(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return '';
  if (s === 'pending' || s === 'containercreating') return 'bg-yellow/[0.03]';
  if (s === 'succeeded' || s === 'completed') return 'bg-[#60a5fa]/[0.03]';
  return 'bg-red/[0.04]';
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Running', label: 'Running' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Failed', label: 'Failed' },
  { value: 'CrashLoopBackOff', label: 'CrashLoop' },
];

// ── Pod Detail Slide-Out ─────────────────────────────────────────────────────

interface PodSlideOutProps {
  namespace: string;
  name: string;
  isAdmin: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

function PodSlideOut({ namespace, name, isAdmin, onClose, onDeleted }: PodSlideOutProps) {
  const [pod, setPod] = useState<PodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'info' | 'events' | 'logs'>('info');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPodDetail(namespace, name)
      .then((data) => { if (!cancelled) { setPod(data); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [namespace, name]);

  const handleDelete = async () => {
    if (!confirm(`Delete pod ${name}? If it's managed by a controller, it will be recreated.`)) return;
    try {
      await deletePod(namespace, name);
      onDeleted();
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[520px] z-[300] flex flex-col bg-[#0a0e1a] border-l border-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0 bg-[#0d1117]">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-text-bright truncate">{name}</div>
          <div className="text-[10px] text-text-dim font-mono">{namespace}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {isAdmin && pod && (
            <button
              className="text-[10px] font-mono px-2 py-1 rounded border border-red/30 text-red hover:bg-red/10 transition-colors"
              onClick={handleDelete}
            >
              Delete
            </button>
          )}
          <button className="text-text-dim hover:text-text-primary transition-colors" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-border flex-shrink-0 bg-[#0d1117]">
        {(['info', 'events', 'logs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveDetailTab(t)}
            className={`text-[10px] font-mono uppercase tracking-wider px-3 py-2 border-b-2 -mb-px transition-all capitalize ${
              activeDetailTab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-text-dim hover:text-text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-accent" />
          </div>
        )}
        {error && (
          <div className="text-red text-sm font-mono py-6 text-center">{error}</div>
        )}
        {pod && activeDetailTab === 'info' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Status', pod.status],
                ['Node', pod.node || '-'],
                ['IP', pod.ip || '-'],
                ['Age', pod.age || '-'],
                ['Namespace', pod.namespace],
                ['Service Account', pod.serviceAccount || '-'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="text-[9px] uppercase tracking-wider text-text-dim font-mono mb-0.5">{label}</div>
                  <div className="text-[11px] font-mono text-text-primary">{val}</div>
                </div>
              ))}
            </div>

            {/* Conditions */}
            {pod.conditions && pod.conditions.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-text-dim font-mono mb-2">Conditions</div>
                <div className="space-y-1">
                  {pod.conditions.map((c) => (
                    <div key={c.type} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'True' ? 'bg-green' : 'bg-red'}`} />
                      <span className="text-text-dim">{c.type}</span>
                      <span className={c.status === 'True' ? 'text-green' : 'text-red'}>{c.status}</span>
                      {c.message && <span className="text-text-muted truncate">{c.message}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Containers */}
            <div>
              <div className="text-[9px] uppercase tracking-wider text-text-dim font-mono mb-2">Containers</div>
              <div className="space-y-2">
                {pod.containers.map((c) => (
                  <div key={c.name} className="bg-[#111827] border border-border rounded p-2.5 text-[10px] font-mono">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.ready ? 'bg-green' : 'bg-red'}`}
                        style={c.ready ? { boxShadow: '0 0 3px var(--green)' } : undefined}
                      />
                      <span className="font-semibold text-text-primary">{c.name}</span>
                      <span className={c.ready ? 'text-green' : 'text-red'}>{c.ready ? 'Ready' : 'Not Ready'}</span>
                      {c.restarts > 0 && <span className="text-yellow">{c.restarts} restarts</span>}
                    </div>
                    <div className="text-text-dim truncate">{c.image}</div>
                    {c.stateDetail && <div className="text-text-muted mt-0.5">{c.stateDetail}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Labels */}
            {pod.labels && Object.keys(pod.labels).length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-text-dim font-mono mb-2">Labels</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(pod.labels).map(([k, v]) => (
                    <span key={k} className="text-[9px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-dim font-mono">
                      {k}={v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {pod && activeDetailTab === 'events' && (
          <div className="space-y-1.5">
            {pod.events.length === 0 ? (
              <div className="text-[11px] text-text-muted font-mono text-center py-8">No recent events</div>
            ) : (
              pod.events.map((e, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 px-3 py-2 rounded text-[10px] font-mono border-l-2 ${
                    e.type === 'Warning' ? 'border-l-yellow' : 'border-l-green'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary">{e.message}</div>
                    <div className="text-text-dim mt-0.5">{e.reason} · {e.age}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {pod && activeDetailTab === 'logs' && (
          <div className="h-full" style={{ minHeight: '400px' }}>
            <LogViewer
              namespace={namespace}
              podName={name}
              containers={pod.containers.map((c) => c.name)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main PodTable ────────────────────────────────────────────────────────────

interface PodTableProps {
  active: boolean;
  refreshTick: number;
}

export function PodTable({ active, refreshTick }: PodTableProps) {
  const { isAdmin } = useUser();
  const [pods, setPods] = useState<PlatformPod[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [nsFilter, setNsFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedPod, setSelectedPod] = useState<{ ns: string; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadPods = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchPlatformPods(nsFilter || undefined, statusFilter || undefined, search || undefined);
      setPods(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [active, nsFilter, statusFilter, search]);

  useEffect(() => {
    if (!active) return;
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active]);

  useEffect(() => {
    setLoading(true);
    loadPods();
  }, [loadPods, refreshTick]);

  const runningCount = pods.filter((p) => p.status.toLowerCase() === 'running').length;
  const pendingCount = pods.filter((p) => ['pending', 'containercreating', 'init'].includes(p.status.toLowerCase())).length;
  const failedCount = pods.filter((p) => {
    const s = p.status.toLowerCase();
    return s !== 'running' && s !== 'pending' && s !== 'succeeded' && s !== 'completed' && s !== 'containercreating';
  }).length;

  return (
    <>
      <div className="bg-[#0d1117] border border-border rounded-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim hover:text-text-primary transition-colors"
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              Pods
            </button>
            {!loading && (
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className="text-green">{runningCount} running</span>
                {pendingCount > 0 && <span className="text-yellow">{pendingCount} pending</span>}
                {failedCount > 0 && <span className="text-red">{failedCount} failed</span>}
                <span className="text-text-muted">{pods.length} total</span>
              </div>
            )}
          </div>

          {/* Filters */}
          {!collapsed && (
            <div className="flex items-center gap-2">
              <select
                className="bg-[#111827] border border-border rounded px-2 py-1 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent"
                value={nsFilter}
                onChange={(e) => { setNsFilter(e.target.value); setSelectedPod(null); }}
              >
                <option value="">All Namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns.name} value={ns.name}>{ns.name}</option>
                ))}
              </select>
              <select
                className="bg-[#111827] border border-border rounded px-2 py-1 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                ref={searchRef}
                type="text"
                className="bg-[#111827] border border-border rounded px-2 py-1 text-[10px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent w-36"
                placeholder="Search pods..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className={`text-text-dim hover:text-accent transition-colors ${loading ? 'animate-spin' : ''}`}
                onClick={loadPods}
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        {!collapsed && (
          <div className="overflow-x-auto" style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {loading && pods.length === 0 ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-4 h-4 animate-spin text-accent" />
              </div>
            ) : pods.length === 0 ? (
              <div className="text-[11px] text-text-muted font-mono text-center py-8">No pods found</div>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <thead className="sticky top-0 bg-[#0d1117] z-10">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-24">Status</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider">Name</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-32">Namespace</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-16">Ready</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-16">Restarts</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-16">Age</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-32">Node</th>
                    <th className="py-2 px-3 text-text-dim font-semibold text-[9px] uppercase tracking-wider w-28">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pods.map((p) => {
                    const isSelected = selectedPod?.ns === p.namespace && selectedPod?.name === p.name;
                    return (
                      <tr
                        key={p.namespace + '/' + p.name}
                        className={`border-b border-border/50 cursor-pointer transition-colors ${rowBg(p.status)} ${
                          isSelected ? 'bg-accent/10 border-accent/20' : 'hover:bg-white/[0.03]'
                        }`}
                        onClick={() => setSelectedPod(isSelected ? null : { ns: p.namespace, name: p.name })}
                      >
                        <td className="py-1.5 px-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor(p.status)}`}
                            />
                            <span className="truncate text-text-dim">{p.status}</span>
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-text-primary max-w-[200px] truncate" title={p.name}>
                          {p.name}
                        </td>
                        <td className="py-1.5 px-3 text-text-dim truncate max-w-[128px]" title={p.namespace}>
                          {p.namespace}
                        </td>
                        <td className="py-1.5 px-3 text-text-dim">{p.ready}</td>
                        <td className="py-1.5 px-3">
                          {p.restarts > 0 ? (
                            <span className="text-yellow font-semibold">{p.restarts}</span>
                          ) : (
                            <span className="text-text-dim">0</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-text-dim">{p.age}</td>
                        <td className="py-1.5 px-3 text-text-muted truncate max-w-[128px]" title={p.node}>
                          {p.node || '-'}
                        </td>
                        <td className="py-1.5 px-3 text-text-muted">{p.ip || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Slide-out detail panel */}
      {selectedPod && (
        <PodSlideOut
          namespace={selectedPod.ns}
          name={selectedPod.name}
          isAdmin={isAdmin}
          onClose={() => setSelectedPod(null)}
          onDeleted={() => { setSelectedPod(null); loadPods(); }}
        />
      )}
    </>
  );
}
