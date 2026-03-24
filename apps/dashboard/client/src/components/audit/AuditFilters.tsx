import React from 'react';
import { Search } from 'lucide-react';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Warning', label: 'Warnings' },
  { id: 'Normal', label: 'Normal' },
];

interface AuditFiltersProps {
  typeFilter: string;
  nsFilter: string;
  namespaces: string[];
  onTypeChange: (type: string) => void;
  onNsChange: (ns: string) => void;
  /** Optional free-text search */
  searchText?: string;
  onSearchChange?: (text: string) => void;
}

export function AuditFilters({
  typeFilter,
  nsFilter,
  namespaces,
  onTypeChange,
  onNsChange,
  searchText,
  onSearchChange,
}: AuditFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <div className="flex gap-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`font-mono py-[6px] px-3 rounded border text-[10px] font-medium uppercase tracking-[1px] cursor-pointer transition-all duration-150 ${
              typeFilter === f.id
                ? 'bg-accent text-white border-accent'
                : 'bg-card text-text-dim border-border hover:border-accent hover:text-text-primary'
            }`}
            onClick={() => onTypeChange(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <select
        className="form-input !mb-0 min-w-[150px] text-xs"
        value={nsFilter}
        onChange={(e) => onNsChange(e.target.value)}
      >
        <option value="">All Namespaces</option>
        {namespaces.map((ns) => (
          <option key={ns} value={ns}>{ns}</option>
        ))}
      </select>

      {onSearchChange !== undefined && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim pointer-events-none" />
          <input
            type="text"
            placeholder="Search events..."
            className="form-input !mb-0 text-xs pl-7 min-w-[160px]"
            value={searchText ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
