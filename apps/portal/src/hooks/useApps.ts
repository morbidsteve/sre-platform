import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '../types';
import { fetchApps, platformServices, adminServices } from '../api';

interface UseAppsResult {
  userApps: AppInfo[];
  platformApps: AppInfo[];
  adminApps: AppInfo[];
  isAdmin: boolean;
  loading: boolean;
}

export function useApps(): UseAppsResult {
  const [userApps, setUserApps] = useState<AppInfo[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchApps();
    const apps = data.apps.map((a) => ({
      ...a,
      status: 'checking' as const,
    }));
    setUserApps(apps);
    setIsAdmin(data.isAdmin);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const platformApps: AppInfo[] = platformServices.map((s) => ({
    ...s,
    status: 'checking' as const,
  }));

  const adminApps: AppInfo[] = adminServices.map((s) => ({
    ...s,
    status: 'checking' as const,
  }));

  return { userApps, platformApps, adminApps, isAdmin, loading };
}
