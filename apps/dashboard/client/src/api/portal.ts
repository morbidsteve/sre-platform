import { apiFetch } from './client';
import type { PortalAppsResponse, PortalApp, PortalGroupsResponse, AppAccess } from '../types/api';

export function fetchPortalApps(): Promise<PortalAppsResponse> {
  return apiFetch<PortalAppsResponse>('/api/portal/apps');
}

export function registerPortalApp(data: {
  name: string;
  displayName?: string;
  description?: string;
  url: string;
  icon?: string;
  namespace?: string;
  access?: AppAccess;
}): Promise<PortalApp> {
  return apiFetch<PortalApp>('/api/portal/apps', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updatePortalApp(
  name: string,
  data: { displayName?: string; description?: string; icon?: string; access?: AppAccess },
): Promise<PortalApp> {
  return apiFetch<PortalApp>('/api/portal/apps/' + name, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deletePortalApp(name: string): Promise<{ deleted: string }> {
  return apiFetch('/api/portal/apps/' + name, { method: 'DELETE' });
}

export function fetchPortalGroups(): Promise<PortalGroupsResponse> {
  return apiFetch<PortalGroupsResponse>('/api/portal/groups');
}
