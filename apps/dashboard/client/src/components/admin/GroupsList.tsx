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
    <div className="flex flex-wrap gap-2">
      {groups.map((g) => {
        const memberCount = users.filter((u) => (u.groups || []).includes(g.name)).length;

        return (
          <div
            key={g.id}
            className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center gap-2"
          >
            <strong className="text-sm text-text-primary">{g.name}</strong>
            <span className="text-[11px] text-text-dim">
              {memberCount} user{memberCount !== 1 ? 's' : ''}
            </span>
            <Button
              size="sm"
              variant="danger"
              className="!p-0 !px-1.5 !text-[10px]"
              onClick={() => handleDelete(g.id, g.name)}
            >
              x
            </Button>
          </div>
        );
      })}
    </div>
  );
}
