import React from 'react';

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
}

export function AuditFilters({ typeFilter, nsFilter, namespaces, onTypeChange, onNsChange }: AuditFiltersProps) {
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
    </div>
  );
}
