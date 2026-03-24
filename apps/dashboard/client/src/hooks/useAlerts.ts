import { useState, useCallback, useMemo } from 'react';
import { useInterval } from './useInterval';
import { fetchAlerts } from '../api/health';
import type { Alert } from '../types/api';

export function useAlerts(active = true) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAlerts();
      setAlerts(data);
      if (data.length > 0) setDismissed(false);
    } catch {
      // keep existing alerts on error
    } finally {
      setLoading(false);
    }
  }, []);

  useInterval(refresh, 30000, active);

  const criticalCount = useMemo(
    () => alerts.filter((a) => a.severity === 'critical').length,
    [alerts],
  );
  const warningCount = useMemo(
    () => alerts.filter((a) => a.severity === 'warning').length,
    [alerts],
  );

  const dismissAll = useCallback(() => setDismissed(true), []);

  return { alerts, criticalCount, warningCount, dismissed, dismissAll, loading };
}
