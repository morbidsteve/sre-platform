import { apiFetch } from './client';

export interface SsoClient {
  clientId: string;
  exists: boolean;
  enabled: boolean;
  redirectUris: string[];
  error?: string;
}

export interface SsoStatusResponse {
  clients: SsoClient[];
  keycloakReachable: boolean;
  realm: string;
}

export function fetchSsoStatus(): Promise<SsoStatusResponse> {
  return apiFetch('/api/admin/sso/status');
}

export function createSsoClient(clientId: string): Promise<{ success: boolean; clientId: string; secret: string; redirectUris: string[] }> {
  return apiFetch('/api/admin/sso/clients', {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  });
}
