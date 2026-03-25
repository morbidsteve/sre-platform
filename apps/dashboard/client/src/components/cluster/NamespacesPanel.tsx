import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { StatusDot } from '../ui/StatusDot';
import { EmptyState } from '../ui/EmptyState';
import { fetchNamespaces } from '../../api/cluster';
import { fetchNamespaceQuota } from '../../api/apps';
import type { Namespace, NamespaceQuota } from '../../types/api';

interface NamespacesPanelProps {
  active: boolean;
  refreshKey: number;
}

function QuotaBar({ label, used, hard, percentage }: { label: string; used: string; hard: string; percentage: number }) {
  const colorClass = percentage >= 90 ? 'bg-red' : percentage >= 70 ? 'bg-yellow' : 'bg-green';
  const textColor = percentage >= 90 ? 'text-red' : percentage >= 70 ? 'text-yellow' : 'text-green';

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-text-dim font-mono">{label}</span>
        <span className={`font-mono font-semibold ${textColor}`}>
          {used} / {hard} ({percentage}%)
        </span>
      </div>
      <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function NamespacesPanel({ active, refreshKey }: NamespacesPanelProps) {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [quotaData, setQuotaData] = useState<NamespaceQuota[]>([]);
  const [quotaLoading, setQuotaLoading] = useState(false);

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

  const handleNsClick = useCallback(async (nsName: string) => {
    if (selectedNs === nsName) {
      setSelectedNs(null);
      return;
    }
    setSelectedNs(nsName);
    setQuotaLoading(true);
    try {
      const data = await fetchNamespaceQuota(nsName);
      setQuotaData(data.quotas || []);
    } catch {
      setQuotaData([]);
    } finally {
      setQuotaLoading(false);
    }
  }, [selectedNs]);

  if (loading && namespaces.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  if (namespaces.length === 0) {
    return <EmptyState title="No namespaces found" />;
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {namespaces.map((ns) => (
          <div
            key={ns.name}
            className={`card-base p-3 hover:border-accent transition-colors cursor-pointer ${
              selectedNs === ns.name ? 'border-accent bg-surface-hover' : ''
            }`}
            onClick={() => handleNsClick(ns.name)}
          >
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

      {/* Resource Quota Detail Panel */}
      {selectedNs && (
        <div className="mt-4 card-base p-4" style={{ animation: 'confirmIn 0.15s ease-out' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-bright">
              Resource Quota: {selectedNs}
            </h3>
            <button
              onClick={() => setSelectedNs(null)}
              className="text-text-dim hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
          {quotaLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : quotaData.length === 0 ? (
            <p className="text-xs text-text-dim">No resource quotas configured for this namespace.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {quotaData.map((quota) => (
                <div key={quota.name} className="bg-surface rounded-[var(--radius)] p-3 border border-border">
                  <h4 className="text-xs font-mono text-text-dim mb-2">{quota.name}</h4>
                  {Object.entries(quota.metrics).map(([key, metric]) => (
                    <QuotaBar
                      key={key}
                      label={key}
                      used={metric.used}
                      hard={metric.hard}
                      percentage={metric.percentage}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
