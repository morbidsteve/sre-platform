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
}

export function PipelineTab({ active }: PipelineTabProps) {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
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

  const loadRuns = useCallback(async () => {
    try {
      const data = await fetchPipelineRuns({
        status: statusFilter || undefined,
        search: searchFilter || undefined,
        offset,
        limit: PAGE_LIMIT,
      });
      setRuns(data.runs || []);
      setTotal(data.total || 0);
    } catch {
      // silently fail
    }
  }, [statusFilter, searchFilter, offset]);

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

  const handleSearchChange = (search: string) => {
    setSearchFilter(search);
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
    }, 300);
  };

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
        onStatusChange={handleStatusChange}
        onSearchChange={handleSearchChange}
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
        />
      )}
    </div>
  );
}
