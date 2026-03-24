import { useState, useCallback } from 'react';
import { useInterval } from './useInterval';
import { fetchHealth } from '../api/health';
import type { HelmRelease, ClusterNode, ProblemPod, HealthSummary } from '../types/api';

export function useHealth(active = true) {
  const [helmReleases, setHelmReleases] = useState<HelmRelease[]>([]);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [problemPods, setProblemPods] = useState<ProblemPod[]>([]);
  const [summary, setSummary] = useState<HealthSummary>({
    helmReleasesReady: 0,
    helmReleasesTotal: 0,
    nodesReady: 0,
    nodesTotal: 0,
    problemPodCount: 0,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHelmReleases(data.helmReleases);
      setNodes(data.nodes);
      setProblemPods(data.problemPods);
      setSummary(data.summary);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useInterval(refresh, 15000, active);

  return { helmReleases, nodes, problemPods, summary, loading, refresh };
}
