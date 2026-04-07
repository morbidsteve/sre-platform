import React from 'react';
import { Button } from '../ui/Button';
import { deleteGroup } from '../../api/admin';
import type { AdminGroup, AdminUser } from '../../types/api';

interface GroupsListProps {
  groups: AdminGroup[];
  users: AdminUser[];
  onRefresh: () => void;
}

export function GroupsList({ groups, users, onRefresh }: GroupsListProps) {
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete group "${name}"? Users will be removed from this group.`)) return;
    try {
      await deleteGroup(id);
      onRefresh();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (groups.length === 0) {
    return <span className="text-text-dim text-sm">No groups found</span>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {groups.map((g) => {
        const memberCount = users.filter((u) => (u.groups || []).includes(g.name)).length;
        const members = users.filter((u) => (u.groups || []).includes(g.name));

        return (
          <div
            key={g.id}
            className="bg-surface border border-border rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-text-primary">{g.name}</h4>
              <Button
                size="sm"
                variant="danger"
                className="!p-0 !px-2 !text-[10px]"
                onClick={() => handleDelete(g.id, g.name)}
              >
                Delete
              </Button>
            </div>
            <p className="text-xs text-text-dim mb-2">
              {memberCount} member{memberCount !== 1 ? 's' : ''}
            </p>
            {members.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {members.slice(0, 5).map((u) => (
                  <span
                    key={u.id}
                    className="text-[10px] bg-accent/10 text-accent border border-accent/20 rounded px-1.5 py-0.5"
                  >
                    {u.username}
                  </span>
                ))}
                {members.length > 5 && (
                  <span className="text-[10px] text-text-dim">+{members.length - 5} more</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
