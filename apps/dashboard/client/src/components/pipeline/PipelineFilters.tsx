import React from 'react';
import { Tabs } from '../ui/Tabs';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'scanning', label: 'Scanning' },
  { value: 'review_pending', label: 'Review Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'failed', label: 'Failed' },
];

const QUICK_FILTERS = [
  { id: '', label: 'All Runs' },
  { id: 'review_pending', label: 'Pending Review (ISSM)' },
  { id: 'approved', label: 'Approved' },
  { id: 'failed', label: 'Failed' },
];

interface PipelineFiltersProps {
  statusFilter: string;
  searchFilter: string;
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
}

export function PipelineFilters({
  statusFilter,
  searchFilter,
  onStatusChange,
  onSearchChange,
}: PipelineFiltersProps) {
  return (
    <div>
      {/* Quick filter buttons */}
      <Tabs
        tabs={QUICK_FILTERS}
        active={statusFilter}
        onChange={onStatusChange}
      />

      {/* Detailed filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select
          className="form-input !mb-0 min-w-[150px]"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <input
          type="text"
          className="form-input !mb-0 flex-1 min-w-[180px]"
          placeholder="Search app name..."
          value={searchFilter}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
