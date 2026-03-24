import { useState, useCallback } from 'react';
import {
  fetchUsers,
  createUser as apiCreateUser,
  updateUser as apiUpdateUser,
  deleteUser as apiDeleteUser,
  updateUserGroups as apiUpdateGroups,
  fetchGroups,
  fetchCredentials,
} from '../api/admin';
import type { AdminUser, AdminGroup, Credential, CreateUserRequest, UpdateUserRequest } from '../types/api';

export function useAdmin(active = true) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [usersData, groupsData] = await Promise.all([
        fetchUsers(),
        fetchGroups(),
      ]);
      setUsers(usersData);
      setGroups(groupsData);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [active]);

  const loadCredentials = useCallback(async () => {
    try {
      setCredentials(await fetchCredentials());
    } catch {
      // keep existing
    }
  }, []);

  const createUser = useCallback(async (data: CreateUserRequest) => {
    const result = await apiCreateUser(data);
    await loadAll();
    return result;
  }, [loadAll]);

  const updateUser = useCallback(async (id: string, data: UpdateUserRequest) => {
    const result = await apiUpdateUser(id, data);
    await loadAll();
    return result;
  }, [loadAll]);

  const deleteUser = useCallback(async (id: string) => {
    const result = await apiDeleteUser(id);
    await loadAll();
    return result;
  }, [loadAll]);

  const updateGroups = useCallback(async (id: string, groupNames: string[]) => {
    const result = await apiUpdateGroups(id, groupNames);
    await loadAll();
    return result;
  }, [loadAll]);

  return {
    users,
    groups,
    credentials,
    loading,
    loadAll,
    loadCredentials,
    createUser,
    updateUser,
    deleteUser,
    updateGroups,
  };
}
