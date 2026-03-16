import { useEffect, useState } from 'react';
import type { HealthStatus } from '../types';
import { checkHealth } from '../api';

export function useHealthCheck(healthUrl: string | undefined): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('checking');

  useEffect(() => {
    if (!healthUrl) {
      setStatus('online');
      return;
    }

    let cancelled = false;

    const check = async () => {
      const healthy = await checkHealth(healthUrl);
      if (!cancelled) {
        setStatus(healthy ? 'online' : 'offline');
      }
    };

    void check();

    const interval = setInterval(() => {
      void check();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [healthUrl]);

  return status;
}
