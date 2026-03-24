import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { fetchTopPods } from '../../api/cluster';
import type { TopPod } from '../../types/api';

interface ResourceTopPanelProps {
  active: boolean;
  refreshKey: number;
}

export function ResourceTopPanel({ active, refreshKey }: ResourceTopPanelProps) {
  const [pods, setPods] = useState<TopPod[]>([]);
  const [sortBy, setSortBy] = useState<'cpu' | 'memory'>('cpu');
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshKey]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-sm font-semibold text-text-primary">Top Resource Consumers</span>

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
                <th className="py-2 px-3 text-text-dim font-medium text-xs">CPU</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Memory</th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p, i) => (
                <tr key={p.namespace + '/' + p.name} className="border-b border-border hover:bg-surface/50 transition-colors">
                  <td className="py-2 px-3 text-text-dim">{i + 1}</td>
                  <td className="py-2 px-3 font-medium text-text-primary">{p.name}</td>
                  <td className="py-2 px-3 text-text-dim">{p.namespace}</td>
                  <td className="py-2 px-3 font-mono text-xs">{p.cpu}</td>
                  <td className="py-2 px-3 font-mono text-xs">{p.memory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
