import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchDeployStatus } from '../api/apps';
import type { DeployStatus, DeployStatusPod, DeployStatusEvent } from '../types/api';

export function useDeployStatus() {
  const [phase, setPhase] = useState<DeployStatus['phase']>('pending');
  const [pods, setPods] = useState<DeployStatusPod[]>([]);
  const [events, setEvents] = useState<DeployStatusEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [isDeploying, setIsDeploying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetRef = useRef<{ ns: string; name: string } | null>(null);

  const poll = useCallback(async () => {
    if (!targetRef.current) return;
    try {
      const data = await fetchDeployStatus(targetRef.current.ns, targetRef.current.name);
      setPhase(data.phase);
      setPods(data.pods);
      setEvents(data.events);
      setProgress(data.progress);
      if (data.phase === 'running' || data.phase === 'failed') {
        stopPolling();
      }
    } catch {
      // continue polling
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsDeploying(false);
  }, []);

  const startPolling = useCallback((namespace: string, name: string) => {
    stopPolling();
    targetRef.current = { ns: namespace, name };
    setPhase('pending');
    setPods([]);
    setEvents([]);
    setProgress(0);
    setIsDeploying(true);
    poll();
    intervalRef.current = setInterval(poll, 2000);
  }, [poll, stopPolling]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { phase, pods, events, progress, isDeploying, startPolling, stopPolling };
}
