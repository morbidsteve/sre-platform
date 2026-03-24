import { createContext, useContext } from 'react';
import { useHealth } from '../hooks/useHealth';
import { useAlerts } from '../hooks/useAlerts';
import { useApps } from '../hooks/useApps';

interface DataContextValue {
  health: ReturnType<typeof useHealth>;
  alerts: ReturnType<typeof useAlerts>;
  apps: ReturnType<typeof useApps>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const health = useHealth(true);
  const alerts = useAlerts(true);
  const apps = useApps(true);
  return <DataContext.Provider value={{ health, alerts, apps }}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
