import { apiFetch } from './client';
import type {
  AdminUser,
  AdminGroup,
  CreateUserRequest,
  UpdateUserRequest,
  Credential,
  Tenant,
  TenantOverview,
  AdminAuditResponse,
  ComponentDependency,
  SetupStatus,
} from '../types/api';

export function fetchUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>('/api/admin/users');
}

export function createUser(data: CreateUserRequest): Promise<{ success: boolean; id: string }> {
  return apiFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateUser(id: string, data: UpdateUserRequest): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/users/' + id, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function resetPassword(id: string, password: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/users/' + id + '/password', {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

export function deleteUser(id: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/users/' + id, { method: 'DELETE' });
}

export function updateUserGroups(id: string, groups: string[]): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/users/' + id + '/groups', {
    method: 'PUT',
    body: JSON.stringify({ groups }),
  });
}

export function fetchGroups(): Promise<AdminGroup[]> {
  return apiFetch<AdminGroup[]>('/api/admin/groups');
}

export function createGroup(name: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteGroup(id: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/groups/' + id, { method: 'DELETE' });
}

export function fetchCredentials(): Promise<Credential[]> {
  return apiFetch<Credential[]>('/api/credentials');
}

// ── Tenant Management ─────────────────────────────────────────────────────

export function fetchTenants(): Promise<Tenant[]> {
  return apiFetch<Tenant[]>('/api/admin/tenants');
}

export function fetchTenantOverview(): Promise<TenantOverview> {
  return apiFetch<TenantOverview>('/api/admin/tenants/overview');
}

export function createTenant(name: string, tier: string): Promise<{ success: boolean; name: string }> {
  return apiFetch('/api/admin/tenants', {
    method: 'POST',
    body: JSON.stringify({ name, tier }),
  });
}

export function updateTenantQuota(name: string, tier: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/tenants/' + encodeURIComponent(name) + '/quota', {
    method: 'PATCH',
    body: JSON.stringify({ tier }),
  });
}

export function deleteTenant(name: string): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/tenants/' + encodeURIComponent(name), {
    method: 'DELETE',
    body: JSON.stringify({ confirm: name }),
  });
}

// ── Admin Audit Log ───────────────────────────────────────────────────────

export function fetchAdminAuditLog(params?: {
  action?: string;
  actor?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminAuditResponse> {
  const query = new URLSearchParams();
  if (params?.action) query.set('action', params.action);
  if (params?.actor) query.set('actor', params.actor);
  if (params?.targetType) query.set('targetType', params.targetType);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiFetch<AdminAuditResponse>('/api/admin/audit-log' + (qs ? '?' + qs : ''));
}

// ── Component Dependencies ────────────────────────────────────────────────

export function fetchComponentDependencies(): Promise<ComponentDependency[]> {
  return apiFetch<ComponentDependency[]>('/api/platform/dependencies');
}

// ── Setup Wizard ──────────────────────────────────────────────────────────

export function fetchSetupStatus(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>('/api/admin/setup-status');
}

export function completeSetup(): Promise<{ success: boolean }> {
  return apiFetch('/api/admin/setup-complete', { method: 'POST' });
}
