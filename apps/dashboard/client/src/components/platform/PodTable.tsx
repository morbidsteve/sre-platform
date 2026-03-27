import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchPlatformPods } from '../../api/platform';
import { fetchPodDetail, deletePod } from '../../api/cluster';
import { fetchNamespaces } from '../../api/cluster';
import { useUser } from '../../hooks/useUser';
import type { PlatformPod } from '../../api/platform';
import type { Namespace, PodDetail } from '../../types/api';
import { LogViewer } from '../cluster/LogViewer';

const HUD_ACCENT = '#34d399';
const HUD_AMBER = '#fbbf24';
const HUD_RED = '#f87171';
const HUD_BORDER = '#374151';
const HUD_LABEL = '#9ca3af';
const HUD_TEXT = '#e5e7eb';
const HUD_BG = '#111827';
const HUD_SURFACE = '#1f2937';

// ── Status helpers ──────────────────────────────────────────────────────────

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return HUD_ACCENT;
  if (s === 'pending' || s === 'containercreating' || s === 'init') return HUD_AMBER;
  if (s === 'succeeded' || s === 'completed') return '#60a5fa';
  return HUD_RED;
}

function rowBgStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === 'running') return {};
  if (s === 'pending' || s === 'containercreating') return { background: 'rgba(251,191,36,0.04)' };
  if (s === 'succeeded' || s === 'completed') return { background: 'rgba(96,165,250,0.04)' };
  return { background: 'rgba(248,113,113,0.06)' };
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
  const [activeDetailTab, setActiveDetailTab] = useState<'info' | 'events' | 'logs'>('info');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
    if (!confirm(`Delete pod ${name}? If managed by a controller, it will be recreated.`)) return;
    try {
      await deletePod(namespace, name);
      onDeleted();
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[290]"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div
        className="fixed inset-y-0 right-0 w-[520px] z-[300] flex flex-col hud-slide-in"
        style={{ background: HUD_BG, borderLeft: `1px solid ${HUD_BORDER}` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${HUD_BORDER}`, background: HUD_SURFACE }}
        >
          <div className="min-w-0">
            <div className="font-mono text-sm font-bold truncate" style={{ color: HUD_ACCENT }}>{name}</div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: HUD_LABEL }}>{namespace}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {isAdmin && pod && (
              <button
                className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
                style={{ color: HUD_RED, border: `1px solid rgba(248,113,113,0.3)`, background: 'rgba(248,113,113,0.08)' }}
                onClick={handleDelete}
              >
                Delete
              </button>
            )}
            <button
              className="transition-opacity hover:opacity-60"
              style={{ color: HUD_ACCENT }}
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div
          className="flex items-center gap-0 px-4 pt-0 flex-shrink-0"
          style={{ borderBottom: `1px solid ${HUD_BORDER}`, background: HUD_SURFACE }}
        >
          {(['info', 'events', 'logs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveDetailTab(t)}
              className="text-[9px] font-mono uppercase tracking-[2px] px-4 py-2.5 border-b-2 -mb-px transition-all"
              style={{
                borderBottomColor: activeDetailTab === t ? HUD_ACCENT : 'transparent',
                color: activeDetailTab === t ? HUD_ACCENT : HUD_LABEL,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-5 h-5 animate-spin" style={{ color: HUD_ACCENT }} />
            </div>
          )}
          {error && (
            <div className="text-sm font-mono py-6 text-center" style={{ color: HUD_RED }}>{error}</div>
          )}
          {pod && activeDetailTab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Status', pod.status],
                  ['Node', pod.node || '—'],
                  ['IP', pod.ip || '—'],
                  ['Age', pod.age || '—'],
                  ['Namespace', pod.namespace],
                  ['Service Account', pod.serviceAccount || '—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div className="text-[9px] uppercase tracking-[2px] font-mono mb-0.5" style={{ color: HUD_LABEL }}>{label}</div>
                    <div className="text-[11px] font-mono font-semibold" style={{ color: HUD_TEXT }}>{val}</div>
                  </div>
                ))}
              </div>

              {pod.conditions && pod.conditions.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-[2px] font-mono mb-2 pb-1" style={{ color: HUD_ACCENT, borderBottom: `1px solid ${HUD_BORDER}` }}>
                    Conditions
                  </div>
                  <div className="space-y-1">
                    {pod.conditions.map((c) => (
                      <div key={c.type} className="flex items-center gap-2 text-[10px] font-mono">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: c.status === 'True' ? HUD_ACCENT : HUD_RED }}
                        />
                        <span className="w-28 flex-shrink-0" style={{ color: HUD_TEXT }}>{c.type}</span>
                        <span style={{ color: c.status === 'True' ? HUD_ACCENT : HUD_RED }}>{c.status}</span>
                        {c.message && (
                          <span className="truncate" style={{ color: HUD_LABEL }} title={c.message}>{c.message}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[9px] uppercase tracking-[2px] font-mono mb-2 pb-1" style={{ color: HUD_ACCENT, borderBottom: `1px solid ${HUD_BORDER}` }}>
                  Containers
                </div>
                <div className="space-y-2">
                  {pod.containers.map((c) => (
                    <div
                      key={c.name}
                      className="text-[10px] font-mono p-2.5 rounded"
                      style={{ background: HUD_SURFACE, border: `1px solid ${HUD_BORDER}` }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: c.ready ? HUD_ACCENT : HUD_RED }}
                        />
                        <span className="font-semibold" style={{ color: HUD_TEXT }}>{c.name}</span>
                        <span style={{ color: c.ready ? HUD_ACCENT : HUD_RED }}>
                          {c.ready ? 'Ready' : 'Not Ready'}
                        </span>
                        {c.restarts > 0 && (
                          <span style={{ color: HUD_AMBER }}>{c.restarts} restarts</span>
                        )}
                      </div>
                      <div className="truncate" style={{ color: HUD_LABEL }}>{c.image}</div>
                      {c.stateDetail && (
                        <div className="mt-0.5" style={{ color: HUD_LABEL }}>{c.stateDetail}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {pod.labels && Object.keys(pod.labels).length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-[2px] font-mono mb-2 pb-1" style={{ color: HUD_ACCENT, borderBottom: `1px solid ${HUD_BORDER}` }}>
                    Labels
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(pod.labels).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ color: HUD_LABEL, background: HUD_SURFACE, border: `1px solid ${HUD_BORDER}` }}
                      >
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
                <div className="text-[10px] font-mono text-center py-8" style={{ color: HUD_LABEL }}>
                  No recent events
                </div>
              ) : (
                pod.events.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-3 py-2 rounded text-[10px] font-mono border-l-2"
                    style={{
                      borderLeftColor: e.type === 'Warning' ? HUD_AMBER : HUD_ACCENT,
                      background: e.type === 'Warning' ? 'rgba(251,191,36,0.06)' : 'rgba(52,211,153,0.04)',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div style={{ color: HUD_TEXT }}>{e.message}</div>
                      <div className="mt-0.5" style={{ color: HUD_LABEL }}>{e.reason} · {e.age}</div>
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
    </>
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

  const selectStyle: React.CSSProperties = {
    background: HUD_SURFACE,
    border: `1px solid ${HUD_BORDER}`,
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '10px',
    fontFamily: 'monospace',
    color: HUD_TEXT,
    outline: 'none',
  };

  return (
    <>
      <div
        className="flex flex-col overflow-hidden rounded"
        style={{ background: HUD_BG, border: `1px solid ${HUD_BORDER}` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: `1px solid ${HUD_BORDER}` }}
        >
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-[3px] transition-opacity hover:opacity-70"
              style={{ color: HUD_LABEL }}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              Pods
            </button>
            {!loading && (
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span style={{ color: HUD_ACCENT }}>{runningCount} running</span>
                {pendingCount > 0 && <span style={{ color: HUD_AMBER }}>{pendingCount} pending</span>}
                {failedCount > 0 && <span style={{ color: HUD_RED }}>{failedCount} failed</span>}
                <span style={{ color: HUD_LABEL }}>{pods.length} total</span>
              </div>
            )}
          </div>

          {!collapsed && (
            <div className="flex items-center gap-2">
              <select style={selectStyle} value={nsFilter} onChange={(e) => { setNsFilter(e.target.value); setSelectedPod(null); }}>
                <option value="">All Namespaces</option>
                {namespaces.map((ns) => <option key={ns.name} value={ns.name}>{ns.name}</option>)}
              </select>
              <select style={selectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                ref={searchRef}
                type="text"
                style={{ ...selectStyle, width: '140px' }}
                placeholder="Search pods…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className={`transition-opacity hover:opacity-60 ${loading ? 'animate-spin' : ''}`}
                style={{ color: HUD_ACCENT }}
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
                <RefreshCw className="w-4 h-4 animate-spin" style={{ color: HUD_ACCENT }} />
              </div>
            ) : pods.length === 0 ? (
              <div className="text-[10px] font-mono text-center py-8 uppercase tracking-widest" style={{ color: HUD_LABEL }}>
                No pods found
              </div>
            ) : (
              <table className="w-full text-[10px] font-mono">
                <thead className="sticky top-0 z-10" style={{ background: HUD_BG }}>
                  <tr style={{ borderBottom: `1px solid ${HUD_BORDER}` }}>
                    {['Status', 'Name', 'Namespace', 'Ready', 'Restarts', 'Age', 'Node', 'IP'].map((h) => (
                      <th
                        key={h}
                        className="py-2 px-3 text-left text-[8px] font-bold uppercase tracking-[2px]"
                        style={{ color: HUD_LABEL }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pods.map((p) => {
                    const isSelected = selectedPod?.ns === p.namespace && selectedPod?.name === p.name;
                    const sc = statusColor(p.status);
                    return (
                      <tr
                        key={p.namespace + '/' + p.name}
                        className="cursor-pointer transition-all"
                        style={{
                          ...rowBgStyle(p.status),
                          borderBottom: `1px solid ${HUD_BORDER}`,
                          background: isSelected ? '#273344' : undefined,
                          outline: isSelected ? `1px solid #38bdf8` : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = HUD_SURFACE;
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = '';
                        }}
                        onClick={() => setSelectedPod(isSelected ? null : { ns: p.namespace, name: p.name })}
                      >
                        <td className="py-1.5 px-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: sc }}
                            />
                            <span className="truncate" style={{ color: HUD_LABEL }}>{p.status}</span>
                          </span>
                        </td>
                        <td
                          className="py-1.5 px-3 max-w-[200px] truncate font-semibold"
                          style={{ color: HUD_TEXT }}
                          title={p.name}
                        >
                          {p.name}
                        </td>
                        <td className="py-1.5 px-3 truncate max-w-[128px]" style={{ color: HUD_LABEL }} title={p.namespace}>
                          {p.namespace}
                        </td>
                        <td className="py-1.5 px-3" style={{ color: HUD_LABEL }}>{p.ready}</td>
                        <td className="py-1.5 px-3">
                          {p.restarts > 0 ? (
                            <span className="font-bold" style={{ color: HUD_AMBER }}>{p.restarts}</span>
                          ) : (
                            <span style={{ color: HUD_LABEL }}>0</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3" style={{ color: HUD_LABEL }}>{p.age}</td>
                        <td className="py-1.5 px-3 truncate max-w-[128px]" style={{ color: HUD_LABEL }} title={p.node}>
                          {p.node || '—'}
                        </td>
                        <td className="py-1.5 px-3" style={{ color: HUD_LABEL }}>{p.ip || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

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
