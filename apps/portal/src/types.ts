export interface AppInfo {
  name: string;
  description: string;
  url: string;
  icon: string;
  category?: string;
  healthUrl?: string;
  status?: 'online' | 'offline' | 'checking';
}

export interface UserInfo {
  preferredUsername: string;
  email: string;
  groups: string[];
}

export interface PortalAppsResponse {
  apps: AppInfo[];
  isAdmin: boolean;
  userGroups: string[];
}

export type HealthStatus = 'online' | 'offline' | 'checking';
