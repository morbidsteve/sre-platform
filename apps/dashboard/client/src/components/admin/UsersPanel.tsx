import React, { useState, useMemo } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { deleteUser, resetPassword, updateUserGroups, updateUser } from '../../api/admin';
import type { AdminUser, AdminGroup } from '../../types/api';

interface UsersPanelProps {
  users: AdminUser[];
  groups: AdminGroup[];
  loading: boolean;
  onRefresh: () => void;
  onShowCreateUser: () => void;
  onShowCreateGroup: () => void;
}

export function UsersPanel({ users, groups, loading, onRefresh, onShowCreateUser, onShowCreateGroup }: UsersPanelProps) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (search) {
        const q = search.toLowerCase();
        const match = (u.username + ' ' + (u.firstName || '') + ' ' + (u.lastName || '') + ' ' + (u.email || '')).toLowerCase();
        if (!match.includes(q)) return false;
      }
      if (groupFilter && (!u.groups || !u.groups.includes(groupFilter))) return false;
      return true;
    });
  }, [users, search, groupFilter]);

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(id);
      onRefresh();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleResetPassword = async (id: string, username: string) => {
    const pw = prompt(`Enter new password for "${username}":`);
    if (!pw) return;
    try {
      await resetPassword(id, pw);
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleToggleEnabled = async (user: AdminUser) => {
    try {
      await updateUser(user.id, { enabled: !user.enabled });
      onRefresh();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (loading && users.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[15px] font-semibold text-text-primary">User Management</h3>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onShowCreateUser}>Create User</Button>
          <Button onClick={onShowCreateGroup}>Create Group</Button>
        </div>
      </div>

      {/* Search/Filter */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          className="form-input !mb-0 flex-1"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-input !mb-0 min-w-[140px]"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        >
          <option value="">All Groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.name}>{g.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState title="No users found" description="No users match the current filters." />
      ) : (
        <div className="card-base overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Status</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Username</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Name</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Email</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Groups</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Created</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-border hover:bg-surface/50 transition-colors">
                  <td className="py-2 px-3">
                    <Badge variant={u.enabled ? 'green' : 'red'}>
                      {u.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 font-medium text-text-primary">{u.username}</td>
                  <td className="py-2 px-3 text-text-dim">
                    {(u.firstName || '') + ' ' + (u.lastName || '').trim() || '-'}
                  </td>
                  <td className="py-2 px-3 text-text-dim">{u.email || '-'}</td>
                  <td className="py-2 px-3">
                    {(u.groups || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {u.groups.map((g) => (
                          <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-dim">
                            {g}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-dim text-xs">None</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-text-dim">
                    {u.createdTimestamp ? new Date(u.createdTimestamp).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => handleToggleEnabled(u)}>
                        {u.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button size="sm" onClick={() => handleResetPassword(u.id, u.username)}>
                        Reset PW
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleDelete(u.id, u.username)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
