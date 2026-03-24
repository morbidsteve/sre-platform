import React from 'react';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import type { AuditEvent } from '../../types/api';

interface AuditTableProps {
  events: AuditEvent[];
}

export function AuditTable({ events }: AuditTableProps) {
  if (events.length === 0) {
    return <EmptyState title="No events found" description="No audit events match the current filters." />;
  }

  return (
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b border-border text-left">
            <th className="py-2 px-3 text-text-dim font-medium text-xs w-[160px]">Time</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs w-[120px]">Namespace</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs w-[180px]">Resource</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs w-[100px]">Reason</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs">Message</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs w-[80px]">Type</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : 'N/A';
            const isWarning = e.type === 'Warning';

            return (
              <tr
                key={i}
                className={`border-b border-border hover:bg-surface/50 transition-colors ${
                  isWarning ? 'bg-yellow/5' : ''
                }`}
              >
                <td className="py-2 px-3 text-xs text-text-dim truncate">{ts}</td>
                <td className="py-2 px-3 text-xs text-text-dim truncate">{e.namespace}</td>
                <td className="py-2 px-3 text-xs text-text-primary truncate" title={e.kind + '/' + e.name}>
                  {e.kind}/{e.name}
                </td>
                <td className="py-2 px-3">
                  <Badge variant={isWarning ? 'yellow' : 'green'}>
                    {e.reason}
                  </Badge>
                </td>
                <td className="py-2 px-3 text-xs text-text-primary truncate" title={e.message}>
                  {e.message}
                </td>
                <td className="py-2 px-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                    isWarning ? 'bg-yellow/15 text-yellow' : 'bg-green/15 text-green'
                  }`}>
                    {e.type}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
