import React, { useEffect, useState, useCallback } from 'react';
import { ServiceHealthGrid } from './ServiceHealthGrid';
import { DNSSetup } from './DNSSetup';

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

interface PlatformTabProps {
  onOpenApp: (url: string, title: string) => void;
}

export function PlatformTab({ onOpenApp }: PlatformTabProps) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [ingressData, setIngressData] = useState<IngressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState('');

  const loadData = useCallback(async () => {
    try {
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
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  const handleOpenService = (url: string, name: string) => {
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
      <h2 className="text-lg font-semibold text-text-bright mb-4">Platform Services</h2>

      <ServiceHealthGrid
        services={services}
        lastChecked={lastChecked}
        loading={loading}
        onOpenService={handleOpenService}
      />

      <div className="mt-6">
        <h2 className="text-lg font-semibold text-text-bright mb-3">DNS Setup</h2>
        <DNSSetup hostsEntry={hostsEntry} />
      </div>
    </div>
  );
}
