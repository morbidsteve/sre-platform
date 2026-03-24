import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchBuildStatus } from '../api/apps';
import type { BuildStatus } from '../types/api';

export function useBuildStatus() {
  const [status, setStatus] = useState<BuildStatus['status']>('pending');
  const [message, setMessage] = useState('');
  const [imageTag, setImageTag] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const buildIdRef = useRef<string>('');

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsBuilding(false);
  }, []);

  const pollStatus = useCallback(async () => {
    if (!buildIdRef.current) return;
    try {
      const data = await fetchBuildStatus(buildIdRef.current);
      setStatus(data.status);
      setMessage(data.message);
      if (data.imageTag) setImageTag(data.imageTag);
      if (data.status === 'succeeded' || data.status === 'failed') {
        stopPolling();
      }
    } catch {
      // continue polling
    }
  }, [stopPolling]);

  const startPolling = useCallback((buildId: string) => {
    stopPolling();
    buildIdRef.current = buildId;
    setStatus('building');
    setMessage('');
    setImageTag('');
    setLogs([]);
    setIsBuilding(true);

    pollStatus();
    intervalRef.current = setInterval(pollStatus, 2000);

    const es = new EventSource('/api/build/' + buildId + '/logs');
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log' && data.line) {
          setLogs((prev) => [...prev, data.line]);
        } else if (data.type === 'phase') {
          setMessage(data.message || '');
        } else if (data.type === 'complete') {
          setStatus(data.status === 'succeeded' ? 'succeeded' : 'failed');
          stopPolling();
        } else if (data.type === 'error') {
          setMessage(data.message || 'Build error');
        } else if (data.type === 'done') {
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      es.close();
    };
  }, [pollStatus, stopPolling]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  return { status, message, logs, imageTag, isBuilding, startPolling, stopPolling };
}
