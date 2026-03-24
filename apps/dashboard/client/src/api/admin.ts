import { apiFetch } from './client';
import type {
  AdminUser,
  AdminGroup,
  CreateUserRequest,
  UpdateUserRequest,
  Credential,
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
