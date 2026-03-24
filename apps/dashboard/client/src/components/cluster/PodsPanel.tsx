import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { StatusDot } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { PodDetailPanel } from './PodDetailPanel';
import { fetchPods, fetchNamespaces } from '../../api/cluster';
import { useUser } from '../../hooks/useUser';
import type { ClusterPod, Namespace } from '../../types/api';

const POLL_INTERVAL = 5000;

interface PodsPanelProps {
  active: boolean;
  refreshKey: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Running', label: 'Running' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Failed', label: 'Failed' },
  { value: 'Succeeded', label: 'Succeeded' },
  { value: 'CrashLoopBackOff', label: 'CrashLoop' },
];

function statusDotColor(status: string): 'green' | 'red' | 'yellow' | 'unknown' {
  if (status === 'Running') return 'green';
  if (status === 'Pending') return 'yellow';
  if (status === 'Succeeded') return 'unknown';
  return 'red';
}

export function PodsPanel({ active, refreshKey }: PodsPanelProps) {
  const { isAdmin } = useUser();
  const [pods, setPods] = useState<ClusterPod[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [nsFilter, setNsFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedPod, setExpandedPod] = useState<{ ns: string; name: string } | null>(null);

  const loadPods = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchPods(nsFilter || undefined, search || undefined, statusFilter || undefined);
      setPods(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active, nsFilter, search, statusFilter]);

  useEffect(() => {
    if (!active) return;
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadPods();
  }, [loadPods, refreshKey]);

  // Poll every 5s
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(loadPods, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [active, loadPods]);

  const togglePod = (ns: string, name: string) => {
    if (expandedPod?.ns === ns && expandedPod?.name === name) {
      setExpandedPod(null);
    } else {
      setExpandedPod({ ns, name });
    }
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select
          className="form-input !mb-0 min-w-[160px]"
          value={nsFilter}
          onChange={(e) => { setNsFilter(e.target.value); setExpandedPod(null); }}
        >
          <option value="">All Namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.name} ({ns.pods ?? 0} pods)
            </option>
          ))}
        </select>

        <select
          className="form-input !mb-0 min-w-[130px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <input
          type="text"
          className="form-input !mb-0 flex-1 min-w-[160px]"
          placeholder="Search pods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span className="text-xs text-text-dim">{pods.length} pods</span>

        <Button size="sm" onClick={loadPods}>Refresh</Button>
      </div>

      {loading && pods.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : pods.length === 0 ? (
        <EmptyState title="No pods found" description="No pods match the current filters." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Status</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Name</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Ready</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Restarts</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Age</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Node</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <React.Fragment key={p.namespace + '/' + p.name}>
                  <tr
                    className="border-b border-border hover:bg-surface/50 cursor-pointer transition-colors"
                    onClick={() => togglePod(p.namespace, p.name)}
                  >
                    <td className="py-2 px-3">
                      <span className="flex items-center gap-1.5">
                        <StatusDot color={statusDotColor(p.status)} />
                        <span className="text-xs">{p.status}</span>
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium text-text-primary">{p.name}</td>
                    <td className="py-2 px-3 text-text-dim">{p.namespace}</td>
                    <td className="py-2 px-3 text-text-dim">{p.ready}</td>
                    <td className="py-2 px-3">
                      {p.restarts > 0 ? (
                        <span className="text-yellow font-medium">{p.restarts}</span>
                      ) : '0'}
                    </td>
                    <td className="py-2 px-3 text-text-dim">{p.age}</td>
                    <td className="py-2 px-3 text-text-dim text-xs">{p.node || '-'}</td>
                  </tr>
                  {expandedPod?.ns === p.namespace && expandedPod?.name === p.name && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <PodDetailPanel
                          namespace={p.namespace}
                          name={p.name}
                          isAdmin={isAdmin}
                          onClose={() => setExpandedPod(null)}
                          onDeleted={() => { setExpandedPod(null); loadPods(); }}
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
  );
}
