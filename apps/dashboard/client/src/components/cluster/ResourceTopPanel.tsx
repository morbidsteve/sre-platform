import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { PodDetailPanel } from './PodDetailPanel';
import { fetchTopPods } from '../../api/cluster';
import { useUser } from '../../hooks/useUser';
import type { TopPod } from '../../types/api';

const POLL_INTERVAL = 5000;

interface ResourceTopPanelProps {
  active: boolean;
  refreshKey: number;
}

export function ResourceTopPanel({ active, refreshKey }: ResourceTopPanelProps) {
  const { isAdmin } = useUser();
  const [collapsed, setCollapsed] = useState(true);
  const [pods, setPods] = useState<TopPod[]>([]);
  const [sortBy, setSortBy] = useState<'cpu' | 'memory'>('cpu');
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [expandedPod, setExpandedPod] = useState<{ ns: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchTopPods(sortBy, limit);
      setPods(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active, sortBy, limit]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshKey]);

  // Poll every 5s
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [active, load]);

  const togglePod = (ns: string, name: string) => {
    if (expandedPod?.ns === ns && expandedPod?.name === name) {
      setExpandedPod(null);
    } else {
      setExpandedPod({ ns, name });
    }
  };

  // Compute per-node resource summary
  const nodeStats = React.useMemo(() => {
    const stats: Record<string, { cpu: number; mem: number; count: number }> = {};
    for (const p of pods) {
      const node = p.node || 'unknown';
      if (!stats[node]) stats[node] = { cpu: 0, mem: 0, count: 0 };
      stats[node].cpu += p.cpuRaw;
      stats[node].mem += p.memRaw;
      stats[node].count += 1;
    }
    return stats;
  }, [pods]);

  return (
    <div>
      <button
        className="w-full flex items-center justify-between py-3 px-1 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
          <h3 className="text-sm font-semibold text-text-primary">Resource Top</h3>
          <span className="text-xs text-text-dim">{pods.length} pods</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center" onClick={(e) => e.stopPropagation()}>
          <select
            className="form-input !mb-0 min-w-[130px]"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'cpu' | 'memory')}
          >
            <option value="cpu">Sort by CPU</option>
            <option value="memory">Sort by Memory</option>
          </select>

          <select
            className="form-input !mb-0 min-w-[100px]"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-2">
          {/* Per-node resource summary */}
          {Object.keys(nodeStats).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {Object.entries(nodeStats).map(([node, stat]) => (
                <div key={node} className="card-base p-3">
                  <div className="text-xs font-semibold text-text-primary mb-1">{node}</div>
                  <div className="flex gap-4 text-[11px] text-text-dim">
                    <span>{stat.count} pods</span>
                    <span className="font-mono">CPU: {stat.cpu < 1000 ? stat.cpu + 'm' : (stat.cpu / 1000).toFixed(1) + ' cores'}</span>
                    <span className="font-mono">Mem: {stat.mem < 1073741824 ? Math.round(stat.mem / 1048576) + 'Mi' : (stat.mem / 1073741824).toFixed(1) + 'Gi'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && pods.length === 0 ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : pods.length === 0 ? (
            <EmptyState title="No data" description="No resource metrics available." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-3 text-text-dim font-medium text-xs w-10">#</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Pod</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Node</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">CPU</th>
                    <th className="py-2 px-3 text-text-dim font-medium text-xs">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {pods.map((p, i) => (
                    <React.Fragment key={p.namespace + '/' + p.name}>
                      <tr
                        className="border-b border-border hover:bg-surface/50 cursor-pointer transition-colors"
                        onClick={() => togglePod(p.namespace, p.name)}
                      >
                        <td className="py-2 px-3 text-text-dim">{i + 1}</td>
                        <td className="py-2 px-3 font-medium text-text-primary">{p.name}</td>
                        <td className="py-2 px-3 text-text-dim">{p.namespace}</td>
                        <td className="py-2 px-3 text-text-dim text-xs">{p.node || '-'}</td>
                        <td className="py-2 px-3 font-mono text-xs">{p.cpu}</td>
                        <td className="py-2 px-3 font-mono text-xs">{p.memory}</td>
                      </tr>
                      {expandedPod?.ns === p.namespace && expandedPod?.name === p.name && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <PodDetailPanel
                              namespace={p.namespace}
                              name={p.name}
                              isAdmin={isAdmin}
                              onClose={() => setExpandedPod(null)}
                              onDeleted={() => { setExpandedPod(null); load(); }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
