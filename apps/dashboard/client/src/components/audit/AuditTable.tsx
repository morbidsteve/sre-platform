import React from 'react';
import { EmptyState } from '../ui/EmptyState';
import type { AuditEvent } from '../../types/api';

interface AuditTableProps {
  events: AuditEvent[];
  onRowClick?: (event: AuditEvent) => void;
}

export function AuditTable({ events, onRowClick }: AuditTableProps) {
  if (events.length === 0) {
    return <EmptyState title="No events found" description="No audit events match the current filters." />;
  }

  return (
    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b border-border text-left">
            <th className="py-2 px-3 text-text-dim font-medium text-xs" style={{ width: '150px' }}>Time</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs" style={{ width: '110px' }}>Namespace</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs" style={{ width: '170px' }}>Resource</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs" style={{ width: '110px' }}>Reason</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs">Message</th>
            <th className="py-2 px-3 text-text-dim font-medium text-xs" style={{ width: '80px' }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : 'N/A';
            const isWarning = e.type === 'Warning';
            const isError = e.type === 'Error';
            const rowBg = isError
              ? 'bg-red/5'
              : isWarning
                ? 'bg-yellow/5'
                : '';
            const borderAccent = isError
              ? 'border-l-2 border-l-red'
              : isWarning
                ? 'border-l-2 border-l-yellow'
                : 'border-l-2 border-l-green';

            return (
              <tr
                key={i}
                className={`border-b border-border hover:bg-surface/50 transition-colors ${rowBg} ${borderAccent} ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(e)}
              >
                <td className="py-2 px-3 text-xs text-text-dim truncate" style={{ maxWidth: '150px' }}>{ts}</td>
                <td className="py-2 px-3 text-xs text-text-dim truncate" style={{ maxWidth: '110px' }}>{e.namespace}</td>
                <td className="py-2 px-3 text-xs text-text-primary truncate" style={{ maxWidth: '170px' }} title={e.kind + '/' + e.name}>
                  {e.kind}/{e.name}
                </td>
                <td className="py-2 px-3 truncate" style={{ maxWidth: '110px' }}>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-block max-w-full truncate ${
                    isError
                      ? 'bg-red/15 text-red'
                      : isWarning
                        ? 'bg-yellow/15 text-yellow'
                        : 'bg-green/15 text-green'
                  }`}>
                    {e.reason}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs text-text-primary truncate" title={e.message}>
                  {e.message}
                </td>
                <td className="py-2 px-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                    isError
                      ? 'bg-red/15 text-red'
                      : isWarning
                        ? 'bg-yellow/15 text-yellow'
                        : 'bg-green/15 text-green'
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
