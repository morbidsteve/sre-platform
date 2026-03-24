import { useState, useCallback } from 'react';
import { useInterval } from './useInterval';
import { fetchPipelineRuns, fetchPipelineStats } from '../api/pipeline';
import type { PipelineRun, PipelineStats } from '../types/api';

export function usePipeline(active = true) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [stats, setStats] = useState<PipelineStats>({
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    running: 0,
    review_pending: 0,
    approved: 0,
    deployed: 0,
  });
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [runsData, statsData] = await Promise.all([
        fetchPipelineRuns({
          status: statusFilter || undefined,
          search: searchQuery || undefined,
          offset,
          limit: 20,
        }),
        fetchPipelineStats(),
      ]);
      setRuns(runsData.runs);
      setTotal(runsData.total);
      setStats(statsData);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, offset]);

  useInterval(refresh, 10000, active);

  return {
    runs,
    stats,
    statusFilter,
    setStatusFilter,
    searchQuery,
    setSearchQuery,
    offset,
    setOffset,
    total,
    loading,
    refresh,
  };
}
