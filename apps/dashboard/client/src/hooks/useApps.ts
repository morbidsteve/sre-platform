import { useState, useCallback, useMemo } from 'react';
import { useInterval } from './useInterval';
import { fetchApps } from '../api/apps';
import type { App } from '../types/api';

export function useApps(active = true) {
  const [apps, setApps] = useState<App[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshApps = useCallback(async () => {
    try {
      const data = await fetchApps();
      setApps(data.apps);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useInterval(refreshApps, 8000, active);

  const filteredApps = useMemo(() => {
    if (!searchQuery) return apps;
    const q = searchQuery.toLowerCase();
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.team.toLowerCase().includes(q) ||
        a.image.toLowerCase().includes(q),
    );
  }, [apps, searchQuery]);

  return { apps, searchQuery, setSearchQuery, filteredApps, loading, refreshApps };
}
