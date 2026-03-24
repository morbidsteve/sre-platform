import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { fetchDeployments, fetchNamespaces, restartDeployment, scaleDeployment } from '../../api/cluster';
import { useUser } from '../../hooks/useUser';
import type { Deployment, Namespace } from '../../types/api';

const POLL_INTERVAL = 5000;

interface DeploymentsPanelProps {
  active: boolean;
  refreshKey: number;
}

export function DeploymentsPanel({ active, refreshKey }: DeploymentsPanelProps) {
  const { isAdmin } = useUser();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [nsFilter, setNsFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [scaleValues, setScaleValues] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchDeployments(nsFilter || undefined);
      setDeployments(data);
      const initial: Record<string, number> = {};
      data.forEach((d) => { initial[d.namespace + '/' + d.name] = d.replicas; });
      setScaleValues(initial);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active, nsFilter]);

  useEffect(() => {
    if (!active) return;
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active]);

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

  const handleRestart = async (ns: string, name: string) => {
    if (!confirm(`Restart deployment ${name} in ${ns}?`)) return;
    try {
      await restartDeployment(ns, name);
      load();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleScale = async (ns: string, name: string) => {
    const key = ns + '/' + name;
    const count = scaleValues[key];
    if (count === undefined) return;
    if (!confirm(`Scale ${name} to ${count} replicas?`)) return;
    try {
      await scaleDeployment(ns, name, count);
      load();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div>
      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select
          className="form-input !mb-0 min-w-[160px]"
          value={nsFilter}
          onChange={(e) => setNsFilter(e.target.value)}
        >
          <option value="">All Namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns.name} value={ns.name}>{ns.name}</option>
          ))}
        </select>
        <span className="text-xs text-text-dim">{deployments.length} deployments</span>
      </div>

      {loading && deployments.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : deployments.length === 0 ? (
        <EmptyState title="No deployments found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Name</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Replicas</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Age</th>
                {isAdmin && <th className="py-2 px-3 text-text-dim font-medium text-xs">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => {
                const key = d.namespace + '/' + d.name;
                return (
                  <tr key={key} className="border-b border-border hover:bg-surface/50 transition-colors">
                    <td className="py-2 px-3 font-medium text-text-primary">{d.name}</td>
                    <td className="py-2 px-3 text-text-dim">{d.namespace}</td>
                    <td className="py-2 px-3">
                      <span className={d.ready < d.replicas ? 'text-yellow' : 'text-green'}>
                        {d.ready}/{d.replicas}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-text-dim text-xs">{d.age}</td>
                    {isAdmin && (
                      <td className="py-2 px-3">
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            className="form-input !mb-0 w-16 text-xs"
                            min={0}
                            max={20}
                            value={scaleValues[key] ?? d.replicas}
                            onChange={(e) => setScaleValues({ ...scaleValues, [key]: Number(e.target.value) })}
                          />
                          <Button size="sm" onClick={() => handleScale(d.namespace, d.name)}>Scale</Button>
                          <Button size="sm" variant="warn" onClick={() => handleRestart(d.namespace, d.name)}>Restart</Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
