import type { AppInfo } from '../types';
import { AppCard } from './AppCard';

interface AppGridProps {
  title: string;
  apps: AppInfo[];
  icon?: React.ReactNode;
}

export function AppGrid({ title, apps, icon }: AppGridProps) {
  if (apps.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        {icon && <span className="text-slate-500">{icon}</span>}
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
          {title}
        </h2>
        <div className="h-px flex-1 bg-slate-800" />
        <span className="font-mono text-[11px] text-slate-600">
          {apps.length} {apps.length === 1 ? 'service' : 'services'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <AppCard key={app.name} app={app} />
        ))}
      </div>
    </section>
  );
}
