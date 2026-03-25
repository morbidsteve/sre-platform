import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { fetchAdminAuditLog } from '../../api/admin';
import type { AdminAuditEntry } from '../../types/api';

interface AuditLogPanelProps {
  active: boolean;
}

export function AuditLogPanel({ active }: AuditLogPanelProps) {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const PAGE_SIZE = 25;

  const loadData = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const result = await fetchAdminAuditLog({
        action: actionFilter || undefined,
        actor: actorFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active, page, actionFilter, actorFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const actionVariant = (action: string): 'green' | 'red' | 'yellow' | 'accent' | 'dim' => {
    if (action.includes('created')) return 'green';
    if (action.includes('deleted')) return 'red';
    if (action.includes('updated') || action.includes('completed')) return 'accent';
    return 'dim';
  };

  const formatAction = (action: string): string => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && entries.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[15px] font-semibold text-text-primary">Admin Audit Log</h3>
        <Button onClick={loadData}>Refresh</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select
          className="form-input !mb-0 min-w-[160px]"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
        >
          <option value="">All Actions</option>
          <option value="user_created">User Created</option>
          <option value="user_updated">User Updated</option>
          <option value="user_deleted">User Deleted</option>
          <option value="tenant_created">Tenant Created</option>
          <option value="tenant_deleted">Tenant Deleted</option>
          <option value="tenant_quota_updated">Quota Updated</option>
          <option value="setup_wizard_completed">Setup Completed</option>
        </select>
        <input
          type="text"
          className="form-input !mb-0 flex-1 min-w-[150px]"
          placeholder="Filter by actor..."
          value={actorFilter}
          onChange={(e) => { setActorFilter(e.target.value); setPage(0); }}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description={actionFilter || actorFilter ? "No entries match the current filters." : "Admin actions will appear here once recorded."}
        />
      ) : (
        <>
          <div className="card-base overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-3 text-text-dim font-medium text-xs">Time</th>
                  <th className="py-2 px-3 text-text-dim font-medium text-xs">Action</th>
                  <th className="py-2 px-3 text-text-dim font-medium text-xs">Actor</th>
                  <th className="py-2 px-3 text-text-dim font-medium text-xs">Target</th>
                  <th className="py-2 px-3 text-text-dim font-medium text-xs">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border hover:bg-surface/50 transition-colors">
                    <td className="py-2 px-3 text-xs text-text-dim whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant={actionVariant(e.action)}>
                        {formatAction(e.action)}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-text-primary text-xs">{e.actor}</td>
                    <td className="py-2 px-3 text-text-dim text-xs">
                      {e.target_type && e.target_name
                        ? `${e.target_type}: ${e.target_name}`
                        : e.target_name || '-'}
                    </td>
                    <td className="py-2 px-3 text-text-dim text-xs max-w-[300px] truncate">
                      {e.detail || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-3">
              <span className="text-xs text-text-dim">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <Button size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
