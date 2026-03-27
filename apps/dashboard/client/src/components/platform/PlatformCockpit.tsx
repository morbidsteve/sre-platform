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
import type { PlatformOverview, FluxStatus, PlatformEvent, PlatformCertificate, PlatformService } from '../../api/platform';
import type { Namespace } from '../../types/api';
import { useToast } from '../../context/ToastContext';
import { useConfig } from '../../context/ConfigContext';

const AUTO_REFRESH_MS = 15_000;

// ── Platform Cockpit palette ──────────────────────────────────────────────────
const HUD_ACCENT = '#38bdf8';
const HUD_AMBER = '#fbbf24';
const HUD_RED = '#f87171';
const HUD_BORDER = '#374151';
const HUD_LABEL = '#9ca3af';
const HUD_TEXT = '#e5e7eb';
const HUD_BG = '#111827';
const HUD_SURFACE = '#1f2937';

// ── Platform namespace → service name mapping ─────────────────────────────────
const NS_TO_SERVICES: Record<string, { name: string; icon: string; description: string }[]> = {
  'istio-system': [{ name: 'istio', icon: '◈', description: 'Service mesh with mTLS encryption' }],
  'kyverno': [{ name: 'kyverno', icon: '⬡', description: 'Policy engine for admission control' }],
  'monitoring': [
    { name: 'prometheus', icon: '◉', description: 'Metrics collection and alerting' },
    { name: 'grafana', icon: '▣', description: 'Observability dashboards' },
  ],
  'logging': [
    { name: 'loki', icon: '≡', description: 'Log aggregation' },
    { name: 'alloy', icon: '⋈', description: 'Log collection agent' },
  ],
  'harbor': [{ name: 'harbor', icon: '⚓', description: 'Container registry with Trivy scanning' }],
  'keycloak': [{ name: 'keycloak', icon: '◎', description: 'Identity and SSO provider' }],
  'openbao': [{ name: 'openbao', icon: '⬢', description: 'Secrets management' }],
  'runtime-security': [{ name: 'neuvector', icon: '◆', description: 'Runtime security and network DLP' }],
  'neuvector': [{ name: 'neuvector', icon: '◆', description: 'Runtime security and network DLP' }],
  'cert-manager': [{ name: 'cert-manager', icon: '✦', description: 'TLS certificate management' }],
  'backup': [{ name: 'velero', icon: '▤', description: 'Cluster backup and restore' }],
  'velero': [{ name: 'velero', icon: '▤', description: 'Cluster backup and restore' }],
  'tempo': [{ name: 'tempo', icon: '◈', description: 'Distributed tracing' }],
};

/** Derive platform services from Flux HelmRelease data */
function deriveServicesFromFlux(flux: FluxStatus, config: { domain: string }): PlatformService[] {
  const services: PlatformService[] = [];
  const seen = new Set<string>();

  const serviceUrls: Record<string, string> = {
    grafana: `https://grafana.${config.domain}`,
    prometheus: `https://prometheus.${config.domain}`,
    harbor: `https://harbor.${config.domain}`,
    keycloak: `https://keycloak.${config.domain}`,
    istio: `https://kiali.${config.domain}`,
    neuvector: `https://neuvector.${config.domain}`,
  };

  // Check HelmReleases and Kustomizations for known platform namespaces
  const allItems = [
    ...flux.helmReleases.map((h) => ({ namespace: h.namespace, name: h.name, ready: h.ready, suspended: h.suspended })),
    ...flux.kustomizations.map((k) => ({ namespace: k.namespace, name: k.name, ready: k.ready, suspended: k.suspended })),
  ];

  for (const item of allItems) {
    const ns = item.namespace;
    const defs = NS_TO_SERVICES[ns];
    if (!defs) continue;

    for (const def of defs) {
      const key = def.name;
      if (seen.has(key)) continue;
      seen.add(key);

      const nsReady = allItems
        .filter((x) => x.namespace === ns && !x.suspended)
        .every((x) => x.ready);

      services.push({
        name: def.name,
        namespace: ns,
        healthy: nsReady,
        podCount: 0,
        icon: def.icon,
        description: def.description,
        url: serviceUrls[def.name] ?? '',
      });
    }
  }

  return services;
}

// ── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  label,
  value,
  ok,
  warn,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  ok?: boolean;
  warn?: boolean;
}) {
  const color = ok === true ? HUD_ACCENT : ok === false ? HUD_RED : warn ? HUD_AMBER : HUD_LABEL;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded"
      style={{
        background: HUD_SURFACE,
        border: `1px solid ${HUD_BORDER}`,
      }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
      <div>
        <div className="text-sm font-bold font-mono leading-tight" style={{ color: HUD_TEXT }}>
          {value}
        </div>
        <div className="text-[8px] uppercase tracking-[2px] font-mono" style={{ color: HUD_LABEL }}>
          {label}
        </div>
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
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const isCritical = (reason: string) =>
    ['Failed', 'FailedScheduling', 'BackOff', 'OOMKilling', 'CrashLoopBackOff',
     'ErrImagePull', 'ImagePullBackOff', 'NodeNotReady', 'FailedCreate'].includes(reason);

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
    <div className="rounded overflow-hidden" style={{ background: HUD_BG, border: `1px solid ${HUD_BORDER}` }}>
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 transition-opacity hover:opacity-80"
        style={{ borderBottom: collapsed ? 'none' : `1px solid ${HUD_BORDER}` }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: HUD_AMBER }} />
          <span className="text-[9px] font-mono font-bold uppercase tracking-[3px]" style={{ color: HUD_LABEL }}>
            Warning Events
          </span>
          {!loading && events.length > 0 && (
            <span
              className="text-[8px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: HUD_AMBER, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}
            >
              {events.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <select
              style={selectStyle}
              value={nsFilter}
              onChange={(e) => { e.stopPropagation(); onNsFilter(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">All Namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns.name} value={ns.name}>{ns.name}</option>
              ))}
            </select>
          )}
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5" style={{ color: HUD_LABEL }} />
            : <ChevronUp className="w-3.5 h-3.5" style={{ color: HUD_LABEL }} />}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
          {loading ? (
            <div className="flex justify-center py-6">
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: HUD_ACCENT }} />
            </div>
          ) : events.length === 0 ? (
            <div className="text-[10px] font-mono text-center py-6 uppercase tracking-widest" style={{ color: HUD_LABEL }}>
              No warning events
            </div>
          ) : (
            <div>
              {events.slice(0, 80).map((e, i) => {
                const critical = isCritical(e.reason);
                const dotColor = critical ? HUD_RED : HUD_AMBER;
                const isExpanded = expandedIdx === i;
                return (
                  <div key={i} style={{ borderBottom: `1px solid ${HUD_BORDER}` }}>
                    <div
                      className="flex items-start gap-3 px-4 py-2 text-[10px] font-mono cursor-pointer transition-all"
                      onMouseEnter={(el) => { (el.currentTarget as HTMLDivElement).style.background = HUD_SURFACE; }}
                      onMouseLeave={(el) => { (el.currentTarget as HTMLDivElement).style.background = ''; }}
                      onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    >
                      <span
                        className="flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: dotColor }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate" style={{ color: HUD_TEXT }}>
                          {e.message}
                        </div>
                        <div className="mt-0.5" style={{ color: HUD_LABEL }}>
                          <span className="font-semibold" style={{ color: dotColor }}>{e.reason}</span>
                          {' · '}
                          {e.namespace}/{e.object || ''}
                          {' · '}
                          {e.age}
                          {e.count > 1 && <span> · x{e.count}</span>}
                        </div>
                      </div>
                      <span className="text-[8px] flex-shrink-0 self-start mt-0.5 opacity-50" style={{ color: HUD_LABEL }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                    {isExpanded && (
                      <div
                        className="px-8 pb-3 text-[10px] font-mono leading-relaxed"
                        style={{ color: HUD_LABEL, borderTop: `1px solid ${HUD_BORDER}` }}
                      >
                        <div className="mt-2"><span style={{ color: HUD_LABEL }}>Message: </span><span style={{ color: HUD_TEXT }}>{e.message}</span></div>
                        <div><span style={{ color: HUD_LABEL }}>Object: </span><span style={{ color: HUD_TEXT }}>{e.namespace}/{e.object}</span></div>
                        {e.firstSeen && <div><span style={{ color: HUD_LABEL }}>First seen: </span><span style={{ color: HUD_TEXT }}>{e.firstSeen}</span></div>}
                        <div><span style={{ color: HUD_LABEL }}>Count: </span><span style={{ color: HUD_TEXT }}>{e.count}</span></div>
                      </div>
                    )}
                  </div>
                );
              })}
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
  const expiringSoon = certs.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30);

  const serviceLinks = [
    { label: 'Grafana', url: `https://grafana.${config.domain}` },
    { label: 'Harbor', url: `https://harbor.${config.domain}` },
    { label: 'Keycloak', url: `https://keycloak.${config.domain}` },
    { label: 'Kiali', url: `https://kiali.${config.domain}` },
    { label: 'Prometheus', url: `https://prometheus.${config.domain}` },
    { label: 'NeuVector', url: `https://neuvector.${config.domain}` },
  ];

  const sectionStyle: React.CSSProperties = {
    background: HUD_BG,
    border: `1px solid ${HUD_BORDER}`,
    borderRadius: '4px',
    padding: '10px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '8px',
    fontFamily: 'monospace',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: HUD_LABEL,
    marginBottom: '8px',
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Flux actions */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Flux Actions</div>
        <button
          className="w-full flex items-center justify-center gap-1.5 text-[10px] font-mono px-3 py-2 rounded transition-opacity hover:opacity-70"
          style={{
            color: HUD_ACCENT,
            border: `1px solid ${HUD_BORDER}`,
            background: HUD_SURFACE,
            opacity: reconciling ? 0.5 : 1,
            cursor: reconciling ? 'not-allowed' : 'pointer',
          }}
          onClick={onReconcileAll}
          disabled={reconciling}
        >
          <RefreshCw className={`w-3 h-3 ${reconciling ? 'animate-spin' : ''}`} />
          {reconciling ? 'Reconciling…' : 'Reconcile All'}
        </button>
      </div>

      {/* Service links */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Quick Links</div>
        <div className="space-y-0.5">
          {serviceLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono transition-all group"
              style={{ color: HUD_LABEL }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = HUD_TEXT; (e.currentTarget as HTMLAnchorElement).style.background = HUD_SURFACE; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = HUD_LABEL; (e.currentTarget as HTMLAnchorElement).style.background = ''; }}
            >
              <span className="flex-1">{link.label}</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          ))}
        </div>
      </div>

      {/* Certificate warnings */}
      {expiringSoon.length > 0 && (
        <div style={{ ...sectionStyle, border: `1px solid rgba(255,170,0,0.2)` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="w-3 h-3" style={{ color: HUD_AMBER }} />
            <div style={{ ...labelStyle, color: HUD_AMBER, marginBottom: 0 }}>Cert Expiry</div>
          </div>
          <div className="space-y-1.5">
            {expiringSoon.map((cert) => (
              <div key={cert.name + cert.namespace} className="text-[10px] font-mono">
                <div className="truncate" style={{ color: HUD_TEXT }} title={cert.name}>{cert.name}</div>
                <div style={{ color: cert.daysUntilExpiry <= 7 ? HUD_RED : HUD_AMBER }}>
                  {cert.daysUntilExpiry <= 0 ? 'EXPIRED' : `${cert.daysUntilExpiry}d remaining`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-refresh hint */}
      <div className="flex items-center gap-1.5 px-1 text-[8px] font-mono" style={{ color: '#6b7280' }}>
        <Clock className="w-2.5 h-2.5" />
        Auto-refresh 15s
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
  const config = useConfig();

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

  useEffect(() => {
    if (!active) return;
    refreshAll();
    fetchNamespaces().then(setNamespaces).catch(() => {});
  }, [active, refreshAll]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refreshAll, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refreshAll]);

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

  // Derive services from flux HelmRelease data (fix for "No services found")
  const derivedServices: PlatformService[] = flux
    ? deriveServicesFromFlux(flux, config)
    : [];

  // Section header style
  const sectionLabel: React.CSSProperties = {
    fontSize: '8px',
    fontFamily: 'monospace',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '3px',
    color: HUD_LABEL,
    marginBottom: '8px',
    borderBottom: `1px solid ${HUD_BORDER}`,
    paddingBottom: '4px',
  };

  return (
    <div className="flex gap-4 min-h-0" style={{ background: HUD_BG }}>
      {/* ── Main content column ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2
              className="text-base font-bold font-mono"
              style={{ color: HUD_TEXT }}
            >
              {overview?.clusterName ?? 'SRE Platform'}
            </h2>
            <div className="text-[9px] font-mono uppercase tracking-[3px] mt-0.5" style={{ color: HUD_LABEL }}>
              Platform Cockpit
              {lastRefreshed && <span style={{ color: '#6b7280' }}> · {lastRefreshed}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatPill
              icon={Server}
              label="Nodes"
              value={overviewLoading ? '…' : `${readyNodes}/${nodeCount}`}
              ok={!overviewLoading && readyNodes === nodeCount && nodeCount > 0}
            />
            <StatPill
              icon={Box}
              label="Pods"
              value={overviewLoading ? '…' : totalPods}
            />
            <StatPill
              icon={Layers}
              label="NS"
              value={overviewLoading ? '…' : totalNamespaces}
            />
            <StatPill
              icon={GitBranch}
              label="Flux"
              value={fluxLoading ? '…' : fluxSynced ? 'SYNCED' : 'DRIFTED'}
              ok={!fluxLoading && fluxSynced}
              warn={!fluxLoading && !fluxSynced}
            />
            <button
              className="flex items-center gap-1.5 text-[9px] font-mono px-3 py-2 rounded transition-opacity hover:opacity-70"
              style={{
                color: HUD_ACCENT,
                border: `1px solid ${HUD_BORDER}`,
                background: HUD_SURFACE,
              }}
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
          <div style={sectionLabel}>
            Nodes{!overviewLoading && overview ? ` (${overview.nodes.length})` : ''}
          </div>
          {overviewLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-36 rounded animate-pulse"
                  style={{ background: HUD_SURFACE, border: `1px solid ${HUD_BORDER}` }}
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
            <div className="text-[10px] font-mono py-4 text-center uppercase tracking-widest" style={{ color: HUD_LABEL }}>
              No nodes available
            </div>
          )}
        </div>

        {/* Row 2: Flux + Services */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: '380px' }}>
          <FluxStatusPanel data={flux} loading={fluxLoading} onRefresh={loadFlux} />
          <ServiceHealthPanel
            services={derivedServices}
            loading={fluxLoading}
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
