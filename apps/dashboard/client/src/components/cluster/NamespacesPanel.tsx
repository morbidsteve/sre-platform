import React, { useState, useEffect } from 'react';
import { Spinner } from '../ui/Spinner';
import { StatusDot } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { fetchNamespaces } from '../../api/cluster';
import type { Namespace } from '../../types/api';

interface NamespacesPanelProps {
  active: boolean;
  refreshKey: number;
}

export function NamespacesPanel({ active, refreshKey }: NamespacesPanelProps) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    fetchNamespaces()
      .then((data) => { if (!cancelled) setNamespaces(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, refreshKey]);

  if (loading && namespaces.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  if (namespaces.length === 0) {
    return <EmptyState title="No namespaces found" />;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {namespaces.map((ns) => (
        <div key={ns.name} className="card-base p-3 hover:border-accent transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <StatusDot color={ns.status === 'Active' ? 'green' : 'red'} />
            <h4 className="text-sm font-semibold text-text-primary truncate">{ns.name}</h4>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
            <span>Pods: {ns.pods ?? 0}</span>
            {ns.cpuRequests && <span>CPU: {ns.cpuRequests}</span>}
            {ns.memRequests && <span>Mem: {ns.memRequests}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
