import React, { useState, useCallback, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, ArrowUpCircle } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { SkeletonCard } from '../ui/Skeleton';
import { useConfig } from '../../context/ConfigContext';
import { deepLink } from '../../utils/deepLinks';
import { ServiceHealthGrid } from '../platform/ServiceHealthGrid';
import { DNSSetup } from '../platform/DNSSetup';
import { NodesPanel } from '../cluster/NodesPanel';
import { PodsPanel } from '../cluster/PodsPanel';
import { EventsPanel } from '../cluster/EventsPanel';
import { ResourceTopPanel } from '../cluster/ResourceTopPanel';
import { DeploymentsPanel } from '../cluster/DeploymentsPanel';
import { DependencyMap } from '../platform/DependencyMap';
import { HealthCheckPanel } from './HealthCheckPanel';

interface ServiceInfo {
  name: string;
  namespace: string;
  healthy: boolean;
  url: string;
  icon: string;
  description: string;
}

interface IngressRoute {
  hosts: string[];
  name?: string;
  namespace?: string;
}

interface IngressData {
  routes: IngressRoute[];
  nodeIp: string;
  httpsPort: number;
}

interface DrCheck {
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

interface DrTestResponse {
  timestamp: string;
  checks: DrCheck[];
  summary: { pass: number; warn: number; fail: number; total: number };
}

interface UpgradeComponent {
  component: string;
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface UpgradeCheckResponse {
  timestamp: string;
  components: UpgradeComponent[];
}

const DR_STATUS_ICON = {
  PASS: CheckCircle2,
  WARN: AlertTriangle,
  FAIL: XCircle,
};
const DR_STATUS_COLOR = {
  PASS: 'text-green-400',
  WARN: 'text-yellow-400',
  FAIL: 'text-red-400',
};
const DR_STATUS_BG = {
  PASS: 'bg-green-500/10 border-green-500/20',
  WARN: 'bg-yellow-500/10 border-yellow-500/20',
  FAIL: 'bg-red-500/10 border-red-500/20',
};

const OPS_TABS = [
  { id: 'services', label: 'Services' },
  { id: 'health', label: 'Health Checks' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'dr', label: 'DR & Upgrades' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'pods', label: 'Pods' },
  { id: 'events', label: 'Events' },
  { id: 'resources', label: 'Resource Top' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'dns', label: 'DNS' },
];

const POLL_INTERVAL = 5000;

interface OperationsTabProps {
  active: boolean;
  onOpenApp: (url: string, title: string) => void;
}

export function OperationsTab({ active, onOpenApp }: OperationsTabProps) {
  const config = useConfig();
  const [subTab, setSubTab] = useState('services');
  const [refreshKey, setRefreshKey] = useState(0);

  // Platform services state
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [ingressData, setIngressData] = useState<IngressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState('');
  const [error, setError] = useState<string | null>(null);

  // DR & Upgrades state
  const [drResults, setDrResults] = useState<DrTestResponse | null>(null);
  const [drLoading, setDrLoading] = useState(false);
  const [drError, setDrError] = useState<string | null>(null);
  const [upgradeData, setUpgradeData] = useState<UpgradeCheckResponse | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const runDrTest = useCallback(async () => {
    setDrLoading(true);
    setDrError(null);
    try {
      const resp = await fetch('/api/ops/dr-test', { method: 'POST', credentials: 'include' });
      if (!resp.ok) throw new Error(`DR test failed (${resp.status})`);
      const data: DrTestResponse = await resp.json();
      setDrResults(data);
    } catch (err) {
      setDrError(err instanceof Error ? err.message : 'Failed to run DR validation');
    } finally {
      setDrLoading(false);
    }
  }, []);

  const checkUpgrades = useCallback(async () => {
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const resp = await fetch('/api/ops/upgrade-check', { credentials: 'include' });
      if (!resp.ok) throw new Error(`Upgrade check failed (${resp.status})`);
      const data: UpgradeCheckResponse = await resp.json();
      setUpgradeData(data);
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Failed to check component versions');
    } finally {
      setUpgradeLoading(false);
    }
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Load platform data
  const loadPlatformData = useCallback(async () => {
    try {
      setError(null);
      const [statusResp, ingressResp] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/ingress'),
      ]);
      const statusData: ServiceInfo[] = await statusResp.json();
      const ingress: IngressData = await ingressResp.json();

      setServices(statusData);
      setIngressData(ingress);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      setError('Failed to load platform data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 5 seconds when active
  useEffect(() => {
    if (!active) return;
    loadPlatformData();
    const timer = setInterval(() => {
      loadPlatformData();
      triggerRefresh();
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [active, loadPlatformData, triggerRefresh]);

  const handleOpenService = (url: string, name: string) => {
    const lname = name.toLowerCase();

    // Grafana — deep-link to cluster overview dashboard
    if (lname.includes('grafana')) {
      window.open(deepLink(config, 'grafana:cluster-overview'), '_blank', 'noopener');
      return;
    }

    // Prometheus — open targets page
    if (lname.includes('prometheus')) {
      window.open(url + '/targets', '_blank', 'noopener');
      return;
    }

    // AlertManager — open alerts page
    if (lname.includes('alertmanager')) {
      window.open(url + '/#/alerts', '_blank', 'noopener');
      return;
    }

    // Harbor — open projects page
    if (lname.includes('harbor')) {
      window.open(deepLink(config, 'harbor:projects'), '_blank', 'noopener');
      return;
    }

    // Keycloak admin console uses separate master realm credentials
    if (lname.includes('keycloak')) {
      if (window.confirm('Keycloak Admin Console uses separate credentials.\n\nSee Admin > Credentials for details.\n\nOpen Keycloak?')) {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }

    // NeuVector — auto-redirect to OIDC login
    if (lname.includes('neuvector')) {
      window.open(url + '#/login', '_blank', 'noopener');
      return;
    }

    // OpenBao — open directly to OIDC auth method
    if (lname.includes('openbao') || lname.includes('vault')) {
      window.open(url + '/ui/vault/auth?with=oidc', '_blank', 'noopener');
      return;
    }

    // DSOP wizard — open in app frame modal
    if (url && url.includes(`dsop.${config.domain}`)) {
      onOpenApp(url, 'DSOP Security Pipeline');
      return;
    }
    if (url && url.includes(`portal.${config.domain}`)) {
      onOpenApp(url, 'App Portal');
      return;
    }

    // Everything else — SSO cookie handles auth transparently
    window.open(url, '_blank', 'noopener');
  };

  // Build DNS hosts entries from ingress data (includes ALL deployed apps)
  const hostsEntry = ingressData
    ? ingressData.routes
        .flatMap((r) => {
          // Support both shapes: routes with hosts array and routes with single host
          const hosts = (r as IngressRoute).hosts || [];
          return hosts;
        })
        .filter(Boolean)
        .filter((h, i, arr) => arr.indexOf(h) === i) // deduplicate
        .map((h) => `${ingressData.nodeIp}  ${h}`)
        .join('\n')
    : '';

  return (
    <div>
      {/* Error Banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded border text-sm"
             style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--red)' }}>
          {error} — <button className="underline" onClick={loadPlatformData}>Retry</button>
        </div>
      )}

      <Tabs tabs={OPS_TABS} active={subTab} onChange={setSubTab} />

      {subTab === 'services' && (
        <div>
          {loading && services.length === 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-4">
              {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : (
            <ServiceHealthGrid
              services={services}
              lastChecked={lastChecked}
              loading={loading}
              onOpenService={handleOpenService}
            />
          )}
        </div>
      )}

      {subTab === 'health' && <HealthCheckPanel />}

      {subTab === 'dr' && (
        <div className="space-y-6">
          {/* DR Validation Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Disaster Recovery Validation
              </h3>
              <button
                className="btn btn-primary text-sm inline-flex items-center gap-2"
                onClick={runDrTest}
                disabled={drLoading}
              >
                <RefreshCw className={`w-4 h-4 ${drLoading ? 'animate-spin' : ''}`} />
                {drLoading ? 'Running...' : drResults ? 'Re-run DR Validation' : 'Run DR Validation'}
              </button>
            </div>

            {drError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
                {drError}
              </div>
            )}

            {drResults && (
              <>
                <div className="flex items-center gap-4 bg-surface border border-border rounded-lg p-4">
                  <span className="text-sm text-text-dim">
                    {new Date(drResults.timestamp).toLocaleString()}
                  </span>
                  <span className="text-sm font-medium text-green-400">{drResults.summary.pass} Pass</span>
                  {drResults.summary.warn > 0 && <span className="text-sm font-medium text-yellow-400">{drResults.summary.warn} Warn</span>}
                  {drResults.summary.fail > 0 && <span className="text-sm font-medium text-red-400">{drResults.summary.fail} Fail</span>}
                  <span className="text-sm text-text-dim ml-auto">{drResults.summary.total} checks</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {drResults.checks.map((check) => {
                    const Icon = DR_STATUS_ICON[check.status];
                    return (
                      <div key={check.check} className={`border rounded-lg p-3 ${DR_STATUS_BG[check.status]}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-4 h-4 flex-shrink-0 ${DR_STATUS_COLOR[check.status]}`} />
                          <span className="text-sm font-medium text-text-bright truncate">{check.check}</span>
                        </div>
                        <p className="text-xs text-text-dim ml-6">{check.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {!drResults && !drLoading && !drError && (
              <div className="bg-surface border border-border rounded-lg p-8 text-center">
                <p className="text-sm text-text-dim">Click "Run DR Validation" to check backup health, restore readiness, and recovery objectives.</p>
              </div>
            )}
          </div>

          {/* Upgrade Check Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <ArrowUpCircle className="w-4 h-4" />
                Component Versions
              </h3>
              <button
                className="btn btn-primary text-sm inline-flex items-center gap-2"
                onClick={checkUpgrades}
                disabled={upgradeLoading}
              >
                <RefreshCw className={`w-4 h-4 ${upgradeLoading ? 'animate-spin' : ''}`} />
                {upgradeLoading ? 'Checking...' : upgradeData ? 'Re-check Versions' : 'Check Component Versions'}
              </button>
            </div>

            {upgradeError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
                {upgradeError}
              </div>
            )}

            {upgradeData && (
              <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border text-xs text-text-dim">
                  Last checked: {new Date(upgradeData.timestamp).toLocaleString()}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 px-4 text-text-dim font-medium">Component</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Current</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Latest</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upgradeData.components.map((comp) => (
                        <tr key={comp.component} className="border-b border-border/50 hover:bg-surface/50">
                          <td className="py-2.5 px-4 font-medium text-text-bright">{comp.component}</td>
                          <td className="py-2.5 px-4 font-mono text-text-primary">{comp.current}</td>
                          <td className="py-2.5 px-4 font-mono text-text-primary">{comp.latest}</td>
                          <td className="py-2.5 px-4">
                            {comp.updateAvailable ? (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                                Update Available
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                                Up to Date
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!upgradeData && !upgradeLoading && !upgradeError && (
              <div className="bg-surface border border-border rounded-lg p-8 text-center">
                <p className="text-sm text-text-dim">Click "Check Component Versions" to see current vs latest versions for all platform components.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'dependencies' && <DependencyMap active={active} />}

      {subTab === 'nodes' && <NodesPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'pods' && <PodsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'events' && <EventsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'resources' && <ResourceTopPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'deployments' && <DeploymentsPanel active={active} refreshKey={refreshKey} />}

      {subTab === 'dns' && (
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">DNS Setup</h2>
          <DNSSetup hostsEntry={hostsEntry} loading={loading && !ingressData} />
        </div>
      )}
    </div>
  );
}
