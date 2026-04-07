import React from 'react';
import { Tabs } from '../ui/Tabs';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'scanning', label: 'Scanning' },
  { value: 'review_pending', label: 'Review Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'deploying', label: 'Deploying' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'deployed_unhealthy', label: 'Deployed (Unhealthy)' },
  { value: 'deployed_partial', label: 'Deployed (Partial)' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'undeployed', label: 'Undeployed' },
];

const QUICK_FILTERS = [
  { id: '', label: 'All Runs' },
  { id: 'needs_action', label: 'Needs Action' },
  { id: 'deployed', label: 'Deployed' },
  { id: 'failed', label: 'Failed' },
];

interface PipelineFiltersProps {
  statusFilter: string;
  searchFilter: string;
  teamFilter: string;
  teams: string[];
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
  onTeamChange: (team: string) => void;
}

export function PipelineFilters({
  statusFilter,
  searchFilter,
  teamFilter,
  teams,
  onStatusChange,
  onSearchChange,
  onTeamChange,
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

        <select
          className="form-input !mb-0 min-w-[130px]"
          value={teamFilter}
          onChange={(e) => onTeamChange(e.target.value)}
        >
          <option value="">All Teams</option>
          {teams.map((team) => (
            <option key={team} value={team}>{team}</option>
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
