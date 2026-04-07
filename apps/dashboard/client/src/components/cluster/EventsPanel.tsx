import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { fetchEvents, fetchNamespaces } from '../../api/cluster';
import type { ClusterEvent, Namespace } from '../../types/api';

const POLL_INTERVAL = 5000;

function eventBorderColor(type: string, reason: string): string {
  // Error/Failed events: red
  if (
    type === 'Warning' &&
    (reason === 'Failed' || reason === 'FailedScheduling' || reason === 'FailedMount' ||
     reason === 'BackOff' || reason === 'Unhealthy' || reason === 'OOMKilling' ||
     reason === 'FailedCreate' || reason === 'FailedValidation' || reason === 'CrashLoopBackOff' ||
     reason === 'ErrImagePull' || reason === 'ImagePullBackOff' || reason === 'NodeNotReady')
  ) {
    return 'border-l-4 border-l-red';
  }
  // Warning events: yellow/amber
  if (type === 'Warning') {
    return 'border-l-4 border-l-yellow';
  }
  // Normal events: green
  return 'border-l-4 border-l-green';
}

function eventBadgeVariant(type: string, reason: string): 'green' | 'yellow' | 'red' {
  if (
    type === 'Warning' &&
    (reason === 'Failed' || reason === 'FailedScheduling' || reason === 'FailedMount' ||
     reason === 'BackOff' || reason === 'Unhealthy' || reason === 'OOMKilling' ||
     reason === 'FailedCreate' || reason === 'FailedValidation' || reason === 'CrashLoopBackOff' ||
     reason === 'ErrImagePull' || reason === 'ImagePullBackOff' || reason === 'NodeNotReady')
  ) {
    return 'red';
  }
  if (type === 'Warning') {
    return 'yellow';
  }
  return 'green';
}

interface EventsPanelProps {
  active: boolean;
  refreshKey: number;
}

export function EventsPanel({ active, refreshKey }: EventsPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [nsFilter, setNsFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchEvents(nsFilter || undefined, typeFilter || undefined);
      setEvents(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active, nsFilter, typeFilter]);

  useEffect(() => {
    if (!active) return;
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadEvents();
  }, [loadEvents, refreshKey]);

  // Poll every 5s
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(loadEvents, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [active, loadEvents]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }, [events]);

  const typeSummary = Object.entries(typeCounts)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  return (
    <div>
      <button
        className="w-full flex items-center justify-between py-3 px-1 text-left"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
          <h3 className="text-sm font-semibold text-text-primary">Cluster Events</h3>
          <span className="text-xs text-text-dim">{events.length} events{typeSummary ? ` (${typeSummary})` : ''}</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center" onClick={(e) => e.stopPropagation()}>
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

          <select
            className="form-input !mb-0 min-w-[120px]"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All Types</option>
            <option value="Warning">Warning</option>
            <option value="Normal">Normal</option>
          </select>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-2">
          {loading && events.length === 0 ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : events.length === 0 ? (
            <EmptyState title="No events found" description="No Kubernetes events match the current filters." />
          ) : (
            <div className="space-y-1">
              {events.slice(0, 100).map((e, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 py-2 px-3 rounded hover:bg-surface/50 transition-colors ${eventBorderColor(e.type, e.reason)}`}
                >
                  <Badge variant={eventBadgeVariant(e.type, e.reason)}>
                    {e.type}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary">{e.message}</div>
                    <div className="text-[11px] text-text-dim mt-0.5">
                      <span className={`font-medium ${
                        eventBadgeVariant(e.type, e.reason) === 'red'
                          ? 'text-red'
                          : eventBadgeVariant(e.type, e.reason) === 'yellow'
                          ? 'text-yellow'
                          : 'text-text-dim'
                      }`}>{e.reason}</span>
                      {' '}&middot; {e.namespace}/{e.object || ''} &middot; {e.age}
                      {e.count > 1 && <span> &middot; x{e.count}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
