import React, { useState, useCallback, useEffect } from 'react';
import { Tabs } from '../ui/Tabs';
import { ServiceTilesGrid } from '../platform/ServiceTilesGrid';
import { ServiceHealthGrid } from '../platform/ServiceHealthGrid';
import { DNSSetup } from '../platform/DNSSetup';
import { NodesPanel } from '../cluster/NodesPanel';
import { PodsPanel } from '../cluster/PodsPanel';
import { EventsPanel } from '../cluster/EventsPanel';
import { ResourceTopPanel } from '../cluster/ResourceTopPanel';
import { DeploymentsPanel } from '../cluster/DeploymentsPanel';

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
}

interface IngressData {
  routes: IngressRoute[];
  nodeIp: string;
  httpsPort: number;
}

const OPS_TABS = [
  { id: 'services', label: 'Services' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'pods', label: 'Pods' },
  { id: 'events', label: 'Events' },
  { id: 'resources', label: 'Resource Top' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'dns', label: 'DNS' },
];

interface OperationsTabProps {
  active: boolean;
  onOpenApp: (url: string, title: string) => void;
}

export function OperationsTab({ active, onOpenApp }: OperationsTabProps) {
  const [subTab, setSubTab] = useState('services');
  const [refreshKey, setRefreshKey] = useState(0);

  // Platform services state
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [ingressData, setIngressData] = useState<IngressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState('');

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Load platform data
  const loadPlatformData = useCallback(async () => {
    try {
      const [statusResp, ingressResp, favResp] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/ingress'),
        fetch('/api/favorites'),
      ]);
      const statusData: ServiceInfo[] = await statusResp.json();
      const ingress: IngressData = await ingressResp.json();
      const favData = await favResp.json();

      setServices(statusData);
      setIngressData(ingress);
      setFavorites(favData.favorites || []);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    loadPlatformData();
    const timer = setInterval(() => {
      loadPlatformData();
      triggerRefresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [active, loadPlatformData, triggerRefresh]);

  const handleToggleFavorite = async (name: string) => {
    const newFavs = favorites.includes(name)
      ? favorites.filter((f) => f !== name)
      : [...favorites, name];
    setFavorites(newFavs);
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites: newFavs }),
      });
    } catch {
      // non-critical
    }
  };

  const handleOpenService = (url: string) => {
    if (url && url.includes('dsop.apps.sre.example.com')) {
      onOpenApp(url, 'DSOP Security Pipeline');
      return;
    }
    if (url && url.includes('portal.apps.sre.example.com')) {
      onOpenApp(url, 'App Portal');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const hostsEntry = ingressData
    ? ingressData.routes
        .map((r) => r.hosts[0])
        .filter(Boolean)
        .map((h) => `${ingressData.nodeIp}  ${h}`)
        .join('\n')
    : '';

  return (
    <div>
      <Tabs tabs={OPS_TABS} active={subTab} onChange={setSubTab} />

      {subTab === 'services' && (
        <div>
          <ServiceTilesGrid
            services={services}
            favorites={favorites}
            loading={loading}
            onToggleFavorite={handleToggleFavorite}
            onOpenService={handleOpenService}
          />
          <div className="mt-6">
            <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
              Service Health Status
            </h2>
            <ServiceHealthGrid
              services={services}
              lastChecked={lastChecked}
              loading={loading}
            />
          </div>
        </div>
      )}

      {subTab === 'nodes' && <NodesPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'pods' && <PodsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'events' && <EventsPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'resources' && <ResourceTopPanel active={active} refreshKey={refreshKey} />}
      {subTab === 'deployments' && <DeploymentsPanel active={active} refreshKey={refreshKey} />}

      {subTab === 'dns' && (
        <div>
          <h2 className="text-base font-semibold text-text-bright mb-3">DNS Setup</h2>
          <DNSSetup hostsEntry={hostsEntry} />
        </div>
      )}
    </div>
  );
}
