import { createContext, useContext, useState, useEffect } from 'react';

interface PlatformConfig {
  domain: string;
  registryUrl: string;
  keycloakUrl: string;
  clusterName: string;
  services: Record<string, string>; // name -> URL
}

const DEFAULT_CONFIG: PlatformConfig = {
  domain: 'apps.sre.example.com',
  registryUrl: 'harbor.apps.sre.example.com',
  keycloakUrl: 'https://keycloak.apps.sre.example.com',
  clusterName: 'sre-lab',
  services: {},
};

const ConfigContext = createContext<PlatformConfig>(DEFAULT_CONFIG);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PlatformConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    fetch('/api/config', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const services: Record<string, string> = {};
        if (Array.isArray(data.services)) {
          for (const s of data.services) services[s.name] = s.url;
        }
        setConfig({
          domain: data.domain || DEFAULT_CONFIG.domain,
          registryUrl: data.registryUrl || DEFAULT_CONFIG.registryUrl,
          keycloakUrl: data.keycloakUrl || DEFAULT_CONFIG.keycloakUrl,
          clusterName: data.clusterName || DEFAULT_CONFIG.clusterName,
          services,
        });
      })
      .catch(() => {}); // Use defaults on failure
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig() { return useContext(ConfigContext); }

// Helper to build a service URL from the domain
export function serviceUrl(config: PlatformConfig, name: string): string {
  return config.services[name] || `https://${name}.${config.domain}`;
}
