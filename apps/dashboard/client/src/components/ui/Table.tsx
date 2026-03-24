import React from 'react';
import { Spinner } from './Spinner';

interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  title?: string;
  actions?: React.ReactNode;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data available',
  loading = false,
  title,
  actions,
}: TableProps<T>) {
  return (
    <div className="table-card">
      {title && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-mono text-[12px] font-medium uppercase tracking-[2px] text-text-dim">
            {title}
          </h2>
          {actions}
        </div>
      )}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-10 text-text-dim text-sm">
            {emptyMessage}
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[1.5px] text-text-dim border-b border-border"
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-border/50 last:border-b-0 hover:bg-accent-dim/30 ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-2.5 text-[13px]">
                      {col.render
                        ? col.render(row)
                        : (row[col.key] as React.ReactNode) ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
