import type { PortalAppsResponse, UserInfo } from './types';
import { svcUrl } from './config';

export interface DeployResponse {
  success: boolean;
  prUrl?: string;
  message?: string;
  error?: string;
}

export interface DeployRequest {
  appName: string;
  appType: string;
  image: string;
  port: number;
  team: string;
  resources: string;
  ingress?: string;
  database?: { enabled: boolean; size: string };
  redis?: { enabled: boolean; size: string };
  sso?: boolean;
  storage?: boolean;
  env?: Array<{ name: string; value?: string; secret?: string }>;
}

export async function createDeploymentPR(request: DeployRequest): Promise<DeployResponse> {
  try {
    const response = await fetch('/api/portal/deploy', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return {
        success: false,
        error: (body.error as string) || `HTTP ${response.status}`,
      };
    }
    return await response.json() as DeployResponse;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

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

export function getPlatformServices() {
  return [
    {
      name: 'Grafana',
      description: 'Dashboards & metrics visualization',
      url: svcUrl('grafana'),
      icon: 'BarChart3',
      category: 'Observability',
      healthUrl: `${svcUrl('grafana')}/api/health`,
    },
    {
      name: 'Prometheus',
      description: 'Metrics collection & PromQL queries',
      url: svcUrl('prometheus'),
      icon: 'Activity',
      category: 'Observability',
      healthUrl: `${svcUrl('prometheus')}/-/healthy`,
    },
    {
      name: 'Alertmanager',
      description: 'Alert routing & notification',
      url: svcUrl('alertmanager'),
      icon: 'Bell',
      category: 'Observability',
      healthUrl: `${svcUrl('alertmanager')}/-/healthy`,
    },
    {
      name: 'NeuVector',
      description: 'Runtime container security',
      url: svcUrl('neuvector'),
      icon: 'Shield',
      category: 'Security',
      healthUrl: `${svcUrl('neuvector')}/`,
    },
    {
      name: 'Harbor',
      description: 'Container registry & vulnerability scanning',
      url: svcUrl('harbor'),
      icon: 'Container',
      category: 'Security',
      healthUrl: `${svcUrl('harbor')}/api/v2.0/health`,
    },
    {
      name: 'OpenBao',
      description: 'Secrets vault & certificate management',
      url: svcUrl('openbao'),
      icon: 'Lock',
      category: 'Security',
      healthUrl: `${svcUrl('openbao')}/v1/sys/health`,
    },
  ];
}

export function getAdminServices() {
  return [
    {
      name: 'Keycloak',
      description: 'Identity & SSO management',
      url: svcUrl('keycloak'),
      icon: 'Users',
      category: 'Identity & Admin',
      healthUrl: `${svcUrl('keycloak')}/realms/sre`,
    },
    {
      name: 'SRE Dashboard',
      description: 'Platform admin & deployment',
      url: svcUrl('dashboard'),
      icon: 'LayoutDashboard',
      category: 'Identity & Admin',
      healthUrl: `${svcUrl('dashboard')}/api/health`,
    },
  ];
}

export async function fetchTeams(): Promise<string[]> {
  try {
    const response = await fetch('/api/portal/teams', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { teams: string[] };
    return data.teams;
  } catch {
    return ['team-alpha', 'team-beta'];
  }
}

// Keep backward-compatible exports
export const platformServices = getPlatformServices();
export const adminServices = getAdminServices();
