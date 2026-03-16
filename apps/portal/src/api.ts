import type { PortalAppsResponse, UserInfo } from './types';

export async function fetchApps(): Promise<PortalAppsResponse> {
  try {
    const response = await fetch('/api/portal/apps', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as PortalAppsResponse;
  } catch {
    return { apps: [], isAdmin: false, userGroups: [] };
  }
}

export async function fetchUserInfo(): Promise<UserInfo> {
  try {
    const response = await fetch('/oauth2/userinfo', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as UserInfo;
  } catch {
    return {
      preferredUsername: 'Unknown',
      email: '',
      groups: [],
    };
  }
}

export async function checkHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      mode: 'no-cors',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    // no-cors returns opaque response — if fetch didn't throw, server responded
    return true;
  } catch {
    return false;
  }
}

export const platformServices = [
  {
    name: 'Grafana',
    description: 'Dashboards & metrics visualization',
    url: 'https://grafana.apps.sre.example.com',
    icon: 'BarChart3',
    category: 'Observability',
    healthUrl: 'https://grafana.apps.sre.example.com/api/health',
  },
  {
    name: 'Prometheus',
    description: 'Metrics collection & PromQL queries',
    url: 'https://prometheus.apps.sre.example.com',
    icon: 'Activity',
    category: 'Observability',
    healthUrl: 'https://prometheus.apps.sre.example.com/-/healthy',
  },
  {
    name: 'Alertmanager',
    description: 'Alert routing & notification',
    url: 'https://alertmanager.apps.sre.example.com',
    icon: 'Bell',
    category: 'Observability',
    healthUrl: 'https://alertmanager.apps.sre.example.com/-/healthy',
  },
  {
    name: 'NeuVector',
    description: 'Runtime container security',
    url: 'https://neuvector.apps.sre.example.com',
    icon: 'Shield',
    category: 'Security',
    healthUrl: 'https://neuvector.apps.sre.example.com/',
  },
  {
    name: 'Harbor',
    description: 'Container registry & vulnerability scanning',
    url: 'https://harbor.apps.sre.example.com',
    icon: 'Container',
    category: 'Security',
    healthUrl: 'https://harbor.apps.sre.example.com/api/v2.0/health',
  },
  {
    name: 'OpenBao',
    description: 'Secrets vault & certificate management',
    url: 'https://openbao.apps.sre.example.com',
    icon: 'Lock',
    category: 'Security',
    healthUrl: 'https://openbao.apps.sre.example.com/v1/sys/health',
  },
];

export const adminServices = [
  {
    name: 'Keycloak',
    description: 'Identity & SSO management',
    url: 'https://keycloak.apps.sre.example.com',
    icon: 'Users',
    category: 'Identity & Admin',
    healthUrl: 'https://keycloak.apps.sre.example.com/realms/sre',
  },
  {
    name: 'SRE Dashboard',
    description: 'Platform admin & deployment',
    url: 'https://dashboard.apps.sre.example.com',
    icon: 'LayoutDashboard',
    category: 'Identity & Admin',
    healthUrl: 'https://dashboard.apps.sre.example.com/api/health',
  },
];
