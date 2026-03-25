interface SREConfig {
  domain: string;
  registryUrl: string;
}

declare global {
  interface Window {
    __SRE_CONFIG__?: SREConfig;
  }
}

export function getConfig(): SREConfig {
  return window.__SRE_CONFIG__ || {
    domain: 'apps.sre.example.com',
    registryUrl: 'harbor.apps.sre.example.com',
  };
}

export function svcUrl(name: string): string {
  return `https://${name}.${getConfig().domain}`;
}
