import React, { useState, useCallback, useEffect } from 'react';
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

const OPS_TABS = [
  { id: 'services', label: 'Services' },
  { id: 'health', label: 'Health Checks' },
  { id: 'dependencies', label: 'Dependencies' },
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

      {subTab === 'dependencies' && <DependencyMap active={active} />}

      {subTab === 'nodes' && <NodesPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'pods' && <PodsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'events' && <EventsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'resources' && <ResourceTopPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'deployments' && <DeploymentsPanel active={active} refreshKey={refreshKey} />}

      {subTab === 'dns' && (
        <div>
          <h2 className="text-base font-semibold text-text-bright mb-3">DNS Setup</h2>
          <DNSSetup hostsEntry={hostsEntry} loading={loading && !ingressData} />
        </div>
      )}
    </div>
  );
}
