import { useState, useCallback } from 'react';
import { useInterval } from './useInterval';
import { fetchServiceStatus } from '../api/health';
import type { ServiceStatus } from '../types/api';

export function useServiceStatus(active = true) {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchServiceStatus();
      setServices(data);
      setLastChecked(new Date());
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useInterval(refresh, 30000, active);

  return { services, lastChecked, loading, refresh };
}
