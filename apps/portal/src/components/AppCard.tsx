import {
  Activity,
  BarChart3,
  Bell,
  Box,
  ExternalLink,
  LayoutDashboard,
  Lock,
  Shield,
  Users,
} from 'lucide-react';
import type { AppInfo } from '../types';
import { useHealthCheck } from '../hooks/useHealthCheck';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  BarChart3,
  Activity,
  Bell,
  Shield,
  Container: Box,
  Lock,
  Users,
  LayoutDashboard,
};

interface AppCardProps {
  app: AppInfo;
}

export function AppCard({ app }: AppCardProps) {
  const health = useHealthCheck(app.healthUrl);

  const Icon = iconMap[app.icon] ?? Box;

  const statusColor =
    health === 'online'
      ? 'bg-emerald-400'
      : health === 'offline'
        ? 'bg-red-400'
        : 'bg-amber-400 animate-pulse';

  const statusLabel =
    health === 'online'
      ? 'Online'
      : health === 'offline'
        ? 'Offline'
        : 'Checking';

  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col rounded-xl border border-slate-700/50 bg-slate-800/40 p-5 transition-all duration-200 hover:border-cyan-500/30 hover:bg-slate-800/70 hover:shadow-lg hover:shadow-cyan-500/5"
    >
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700/50 transition-colors duration-200 group-hover:bg-cyan-500/10">
          <Icon className="h-5 w-5 text-slate-400 transition-colors duration-200 group-hover:text-cyan-400" />
        </div>
        <ExternalLink className="h-4 w-4 text-slate-600 opacity-0 transition-all duration-200 group-hover:text-slate-400 group-hover:opacity-100" />
      </div>

      <div className="mt-4 flex-1">
        <h3 className="text-sm font-semibold text-slate-200 group-hover:text-white">
          {app.name}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {app.description}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="font-mono text-[11px] text-slate-500">{statusLabel}</span>
        </div>
        {app.category && (
          <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400">
            {app.category}
          </span>
        )}
      </div>
    </a>
  );
}
