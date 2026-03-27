import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Server,
  Box,
  Layers,
  GitBranch,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
  Clock,
} from 'lucide-react';
import { PlatformNodeCard } from './NodeCard';
import { FluxStatusPanel } from './FluxStatus';
import { ServiceHealthPanel } from './ServiceHealth';
import { PodTable } from './PodTable';
import {
  fetchPlatformOverview,
  fetchPlatformFlux,
  fetchPlatformEvents,
  fetchPlatformCertificates,
  triggerFluxReconcileAll,
} from '../../api/platform';
import { fetchNamespaces } from '../../api/cluster';
import type { PlatformOverview, FluxStatus, PlatformEvent, PlatformCertificate } from '../../api/platform';
import type { Namespace } from '../../types/api';
import { useToast } from '../../context/ToastContext';
import { useConfig } from '../../context/ConfigContext';

const AUTO_REFRESH_MS = 15_000;

// ── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        accent ? 'bg-accent/10 border-accent/25' : 'bg-[#111827] border-border'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${accent ? 'text-accent' : 'text-text-dim'}`} />
      <div>
        <div
          className={`text-sm font-bold font-mono leading-tight ${
            accent ? 'text-accent' : 'text-text-bright'
          }`}
        >
          {value}
        </div>
        <div className="text-[9px] text-text-dim uppercase tracking-wider font-mono">{label}</div>
      </div>
    </div>
  );
}

// ── Events panel ─────────────────────────────────────────────────────────────

interface EventsPanelProps {
  events: PlatformEvent[];
  namespaces: Namespace[];
  loading: boolean;
  nsFilter: string;
  onNsFilter: (ns: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function EventsCollapsible({
  events,
  namespaces,
  loading,
  nsFilter,
  onNsFilter,
  collapsed,
  onToggle,
}: EventsPanelProps) {
  const isCriticalReason = (reason: string) =>
    ['Failed', 'FailedScheduling', 'BackOff', 'OOMKilling', 'CrashLoopBackOff',
     'ErrImagePull', 'ImagePullBackOff', 'NodeNotReady', 'FailedCreate'].includes(reason);

  return (
    <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow" />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim">
            Warning Events
          </span>
          {!loading && events.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow/10 text-yellow">
              {events.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <select
              className="bg-[#111827] border border-border rounded px-2 py-0.5 text-[10px] font-mono text-text-primary focus:outline-none focus:border-accent"
              value={nsFilter}
              onChange={(e) => {
                e.stopPropagation();
                onNsFilter(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">All Namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns.name} value={ns.name}>
                  {ns.name}
                </option>
              ))}
            </select>
          )}
          {collapsed ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-text-dim" />
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
          {loading ? (
            <div className="flex justify-center py-6">
              <RefreshCw className="w-4 h-4 animate-spin text-accent" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-[11px] text-text-muted font-mono text-center py-6">
              No warning events
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {events.slice(0, 80).map((e, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-4 py-2 text-[10px] font-mono hover:bg-white/[0.02] transition-colors"
                >
                  <span
                    className={`flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
                      isCriticalReason(e.reason) ? 'bg-red' : 'bg-yellow'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary truncate">{e.message}</div>
                    <div className="text-text-dim mt-0.5">
                      <span
                        className={`font-semibold ${
                          isCriticalReason(e.reason) ? 'text-red' : 'text-yellow'
                        }`}
                      >
                        {e.reason}
                      </span>
                      {' · '}
                      {e.namespace}/{e.object || ''}
                      {' · '}
                      {e.age}
                      {e.count > 1 && <span> · x{e.count}</span>}
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

// ── Quick Actions Sidebar ────────────────────────────────────────────────────

interface QuickActionsProps {
  certs: PlatformCertificate[];
  onReconcileAll: () => void;
  reconciling: boolean;
}

function QuickActionsSidebar({ certs, onReconcileAll, reconciling }: QuickActionsProps) {
  const config = useConfig();
  const expiringSoon = certs.filter(
    (c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30
  );

  const serviceLinks = [
    { label: 'Grafana', url: `https://grafana.${config.domain}`, icon: '📊' },
    { label: 'Harbor', url: `https://harbor.${config.domain}`, icon: '⚓' },
    { label: 'Keycloak', url: `https://keycloak.${config.domain}`, icon: '🔑' },
    { label: 'Kiali', url: `https://kiali.${config.domain}`, icon: '🕸' },
    { label: 'Prometheus', url: `https://prometheus.${config.domain}`, icon: '📈' },
    { label: 'NeuVector', url: `https://neuvector.${config.domain}`, icon: '🦺' },
  ];

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Flux actions */}
      <div className="bg-[#0d1117] border border-border rounded-lg p-3">
        <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-dim mb-2.5">
          Flux Actions
        </div>
        <button
          className={`w-full flex items-center justify-center gap-1.5 text-[10px] font-mono px-3 py-2 rounded border border-accent/30 text-accent hover:bg-accent/10 transition-colors ${
            reconciling ? 'opacity-60 cursor-not-allowed' : ''
          }`}
          onClick={onReconcileAll}
          disabled={reconciling}
        >
          <RefreshCw className={`w-3 h-3 ${reconciling ? 'animate-spin' : ''}`} />
          {reconciling ? 'Reconciling...' : 'Reconcile All'}
        </button>
      </div>

      {/* Service links */}
      <div className="bg-[#0d1117] border border-border rounded-lg p-3">
        <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-dim mb-2.5">
          Quick Links
        </div>
        <div className="space-y-0.5">
          {serviceLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono text-text-dim hover:text-text-primary hover:bg-white/[0.04] transition-colors group"
            >
              <span className="text-xs">{link.icon}</span>
              <span className="flex-1">{link.label}</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          ))}
        </div>
      </div>

      {/* Certificate warnings */}
      {expiringSoon.length > 0 && (
        <div className="bg-[#0d1117] border border-yellow/25 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Shield className="w-3 h-3 text-yellow" />
            <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-yellow">
              Cert Expiry
            </div>
          </div>
          <div className="space-y-1.5">
            {expiringSoon.map((cert) => (
              <div key={cert.name + cert.namespace} className="text-[10px] font-mono">
                <div className="text-text-primary truncate" title={cert.name}>
                  {cert.name}
                </div>
                <div
                  className={cert.daysUntilExpiry <= 7 ? 'text-red' : 'text-yellow'}
                >
                  {cert.daysUntilExpiry <= 0
                    ? 'EXPIRED'
                    : `${cert.daysUntilExpiry}d remaining`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-refresh hint */}
      <div className="flex items-center gap-1.5 px-1 text-[9px] font-mono text-text-muted">
        <Clock className="w-2.5 h-2.5" />
        Auto-refresh every 15s
      </div>
    </div>
  );
}

// ── Main PlatformCockpit ─────────────────────────────────────────────────────

interface PlatformCockpitProps {
  active: boolean;
}

export function PlatformCockpit({ active }: PlatformCockpitProps) {
  const { showToast } = useToast();

  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [flux, setFlux] = useState<FluxStatus | null>(null);
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [certs, setCerts] = useState<PlatformCertificate[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [fluxLoading, setFluxLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);

  const [eventsNsFilter, setEventsNsFilter] = useState('');
  const [eventsCollapsed, setEventsCollapsed] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState('');

  // ── Data fetchers ─────────────────────────────────────────────────────────

  const loadOverview = useCallback(async () => {
    try {
      const data = await fetchPlatformOverview();
      setOverview(data);
    } catch {
      // silent
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadFlux = useCallback(async () => {
    try {
      const data = await fetchPlatformFlux();
      setFlux(data);
    } catch {
      // silent
    } finally {
      setFluxLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await fetchPlatformEvents(eventsNsFilter || undefined);
      setEvents(data);
    } catch {
      // silent
    } finally {
      setEventsLoading(false);
    }
  }, [eventsNsFilter]);

  const loadCerts = useCallback(async () => {
    try {
      const data = await fetchPlatformCertificates();
      setCerts(data);
    } catch {
      // silent
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadOverview();
    loadFlux();
    loadEvents();
    loadCerts();
    setRefreshTick((t) => t + 1);
    setLastRefreshed(new Date().toLocaleTimeString());
  }, [loadOverview, loadFlux, loadEvents, loadCerts]);

  // Initial load + namespaces
  useEffect(() => {
    if (!active) return;
    refreshAll();
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active, refreshAll]);

  // Auto-refresh
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refreshAll, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refreshAll]);

  // Re-fetch events when filter changes
  useEffect(() => {
    if (!active) return;
    setEventsLoading(true);
    loadEvents();
  }, [active, eventsNsFilter, loadEvents]);

  const handleReconcileAll = async () => {
    if (reconciling) return;
    setReconciling(true);
    try {
      await triggerFluxReconcileAll();
      showToast('Flux reconcile-all triggered', 'success');
      setTimeout(() => {
        loadFlux();
        setRefreshTick((t) => t + 1);
      }, 3000);
    } catch {
      showToast('Failed to trigger reconcile-all', 'error');
    } finally {
      setTimeout(() => setReconciling(false), 5000);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const nodeCount = overview?.nodeCount ?? (overview?.nodes?.length ?? 0);
  const readyNodes = overview?.nodes?.filter((n) => n.status === 'Ready').length ?? 0;
  const fluxSynced = overview?.fluxSynced ?? false;
  const totalPods = overview?.podCount ?? 0;
  const totalNamespaces = overview?.namespaceCount ?? 0;

  return (
    <div className="flex gap-4">
      {/* ── Main content column ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-text-bright font-mono">
              {overview?.clusterName ?? 'SRE Platform'}
            </h2>
            <div className="text-[10px] text-text-dim font-mono mt-0.5">
              Platform Cockpit
              {lastRefreshed && <span> · refreshed {lastRefreshed}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatPill
              icon={Server}
              label="Nodes"
              value={overviewLoading ? '…' : `${readyNodes}/${nodeCount}`}
            />
            <StatPill
              icon={Box}
              label="Pods"
              value={overviewLoading ? '…' : totalPods}
            />
            <StatPill
              icon={Layers}
              label="Namespaces"
              value={overviewLoading ? '…' : totalNamespaces}
            />
            <StatPill
              icon={GitBranch}
              label="Flux"
              value={fluxLoading ? '…' : fluxSynced ? 'SYNCED' : 'DRIFTED'}
              accent={!fluxLoading && fluxSynced}
            />
            <button
              className="flex items-center gap-1.5 text-[10px] font-mono px-3 py-2 rounded-lg border border-border text-text-dim hover:text-text-primary hover:border-border-hover transition-colors"
              onClick={refreshAll}
              title="Refresh all data"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Row 1: Nodes */}
        <div>
          <div className="text-[9px] font-mono font-semibold uppercase tracking-widest text-text-dim mb-2">
            Nodes{!overviewLoading && overview ? ` (${overview.nodes.length})` : ''}
          </div>
          {overviewLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-36 bg-[#0d1117] border border-border rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : (overview?.nodes?.length ?? 0) > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {overview!.nodes.map((node) => (
                <PlatformNodeCard key={node.name} node={node} />
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-text-muted font-mono py-4 text-center">
              No nodes available
            </div>
          )}
        </div>

        {/* Row 2: Flux + Services */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: '380px' }}>
          <FluxStatusPanel data={flux} loading={fluxLoading} onRefresh={loadFlux} />
          <ServiceHealthPanel
            services={overview?.services ?? []}
            loading={overviewLoading}
            onOpenService={(url) => window.open(url, '_blank', 'noopener')}
          />
        </div>

        {/* Row 3: Pod Table */}
        <PodTable active={active} refreshTick={refreshTick} />

        {/* Row 4: Events */}
        <EventsCollapsible
          events={events}
          namespaces={namespaces}
          loading={eventsLoading}
          nsFilter={eventsNsFilter}
          onNsFilter={setEventsNsFilter}
          collapsed={eventsCollapsed}
          onToggle={() => setEventsCollapsed((v) => !v)}
        />
      </div>

      {/* ── Right sidebar ────────────────────────────────────────────── */}
      <div className="w-44 flex-shrink-0 hidden xl:block">
        <QuickActionsSidebar
          certs={certs}
          onReconcileAll={handleReconcileAll}
          reconciling={reconciling}
        />
      </div>
    </div>
  );
}
