import React, { useState, useEffect } from 'react';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { fetchPodDetail, deletePod } from '../../api/cluster';
import { LogViewer } from './LogViewer';
import type { PodDetail } from '../../types/api';

interface PodDetailPanelProps {
  namespace: string;
  name: string;
  isAdmin: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

export function PodDetailPanel({ namespace, name, isAdmin, onClose, onDeleted }: PodDetailPanelProps) {
  const [pod, setPod] = useState<PodDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPodDetail(namespace, name)
      .then((data) => {
        if (!cancelled) {
          setPod(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [namespace, name]);

  const handleDelete = async () => {
    if (!confirm(`Delete pod ${name} in ${namespace}? If owned by a controller, it will be recreated.`)) return;
    try {
      await deletePod(namespace, name);
      onDeleted?.();
    } catch (err) {
      alert('Failed to delete pod: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (showLogs) {
    return (
      <div className="mt-3 card-base p-4 animate-[slideDown_0.2s_ease]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Logs: {name}</h3>
          <Button size="sm" onClick={() => setShowLogs(false)}>Close Logs</Button>
        </div>
        <LogViewer namespace={namespace} podName={name} containers={pod?.containers.map((c) => c.name) ?? []} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 card-base p-4 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !pod) {
    return (
      <div className="mt-3 card-base p-4 text-red text-sm">
        Failed to load pod details: {error}
      </div>
    );
  }

  return (
    <div className="mt-3 card-base p-4 animate-[slideDown_0.2s_ease]">
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[15px] font-semibold text-text-primary">{name}</h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowLogs(true)}>View Logs</Button>
          {isAdmin && (
            <Button size="sm" variant="danger" onClick={handleDelete}>Delete Pod</Button>
          )}
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Pod Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 mb-4">
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">Namespace</span>
          <div className="text-sm text-text-primary">{pod.namespace}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">Node</span>
          <div className="text-sm text-text-primary">{pod.node || '-'}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">IP</span>
          <div className="text-sm text-text-primary font-mono">{pod.ip || '-'}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">Status</span>
          <div className="text-sm text-text-primary">{pod.status}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">Service Account</span>
          <div className="text-sm text-text-primary">{pod.serviceAccount || '-'}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase text-text-dim tracking-[1px]">Age</span>
          <div className="text-sm text-text-primary">{pod.age || '-'}</div>
        </div>
      </div>

      {/* Labels */}
      {pod.labels && Object.keys(pod.labels).length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-text-primary mb-2">Labels</h4>
          <div className="flex flex-wrap gap-1">
            {Object.entries(pod.labels).map(([k, v]) => (
              <span key={k} className="text-[10px] px-2 py-0.5 rounded bg-surface border border-border text-text-dim font-mono">
                {k}={v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Containers */}
      <h4 className="text-xs font-semibold text-text-primary mb-2">Containers</h4>
      {pod.containers.map((c) => (
        <div key={c.name} className="py-2 border-b border-border last:border-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary">{c.name}</span>
            <Badge variant={c.ready ? 'green' : 'yellow'}>
              {c.ready ? 'Ready' : 'Not Ready'}
            </Badge>
          </div>
          <div className="text-[11px] text-text-dim mt-0.5">Image: {c.image}</div>
          {c.restarts > 0 && (
            <span className="text-[11px] text-yellow">Restarts: {c.restarts}</span>
          )}
        </div>
      ))}

      {/* Events */}
      <h4 className="text-xs font-semibold text-text-primary mt-4 mb-2">Recent Events</h4>
      {pod.events.length === 0 ? (
        <div className="text-text-dim text-xs">No recent events</div>
      ) : (
        pod.events.slice(0, 10).map((e, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5">
            <Badge variant={e.type === 'Warning' ? 'yellow' : 'green'}>
              {e.type}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-primary">{e.message}</div>
              <div className="text-[11px] text-text-dim">{e.reason} &middot; {e.age}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
