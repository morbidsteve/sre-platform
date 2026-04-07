import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PipelineStatsCards } from './PipelineStatsCards';
import { PipelineFilters } from './PipelineFilters';
import { PipelineTable } from './PipelineTable';
import { PipelinePagination } from './PipelinePagination';
import { RunDetailOverlay } from './RunDetailOverlay';
import { fetchPipelineStats, fetchPipelineRuns } from '../../api/pipeline';
import type { PipelineStats, PipelineRun } from '../../types/api';

const PAGE_LIMIT = 20;

interface PipelineTabProps {
  active: boolean;
  onOpenApp?: (url: string, title: string) => void;
}

export function PipelineTab({ active, onOpenApp }: PipelineTabProps) {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchPipelineStats();
      setStats(data);
    } catch {
      // silently fail
    }
  }, []);

  const needsActionStatuses = ['pending', 'scanning', 'review_pending', 'deploying'];

  const loadRuns = useCallback(async () => {
    try {
      const apiStatus = statusFilter === 'needs_action' ? undefined : (statusFilter || undefined);
      const data = await fetchPipelineRuns({
        status: apiStatus,
        search: searchFilter || undefined,
        offset,
        limit: PAGE_LIMIT,
      });
      let filtered = data.runs || [];
      if (statusFilter === 'needs_action') {
        filtered = filtered.filter((r) => needsActionStatuses.includes(r.status));
      }
      if (teamFilter) {
        filtered = filtered.filter((r) => r.team === teamFilter);
      }
      setRuns(filtered);
      setTotal(statusFilter === 'needs_action' || teamFilter ? filtered.length : (data.total || 0));
    } catch {
      // silently fail
    }
  }, [statusFilter, searchFilter, teamFilter, offset]);

  const refreshAll = useCallback(() => {
    loadStats();
    loadRuns();
  }, [loadStats, loadRuns]);

  useEffect(() => {
    if (!active) return;
    refreshAll();
    const id = setInterval(refreshAll, 10000);
    return () => clearInterval(id);
  }, [active, refreshAll]);

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setOffset(0);
  };

  const handleTeamChange = (team: string) => {
    setTeamFilter(team);
    setOffset(0);
  };

  const handleSearchChange = (search: string) => {
    setSearchFilter(search);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
    }, 300);
  };

  // Extract unique team names for the team filter dropdown
  const teamList = [...new Set(runs.map((r) => r.team).filter(Boolean))].sort();

  const handleSelectRun = (id: string) => {
    setSelectedRunId(id);
    setIsReviewMode(false);
  };

  return (
    <div>
      <PipelineStatsCards stats={stats} />
      <PipelineFilters
        statusFilter={statusFilter}
        searchFilter={searchFilter}
        teamFilter={teamFilter}
        teams={teamList}
        onStatusChange={handleStatusChange}
        onSearchChange={handleSearchChange}
        onTeamChange={handleTeamChange}
      />
      <PipelineTable
        runs={runs}
        onSelectRun={handleSelectRun}
        totalCount={total}
      />
      <PipelinePagination
        offset={offset}
        limit={PAGE_LIMIT}
        total={total}
        onPrev={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
        onNext={() => setOffset(offset + PAGE_LIMIT)}
      />

      {selectedRunId && (
        <RunDetailOverlay
          runId={selectedRunId}
          isReview={isReviewMode}
          onClose={() => setSelectedRunId(null)}
          onActionComplete={refreshAll}
          onOpenApp={onOpenApp}
        />
      )}
    </div>
  );
}
