import { Rocket, BarChart3, Users, ShieldCheck } from 'lucide-react';
import { svcUrl } from '../config';

type UserRole = 'admin' | 'issm' | 'developer' | 'viewer';

interface QuickActionsProps {
  isAdmin: boolean;
  userGroups: string[];
  onDeployClick?: () => void;
}

function resolveRole(isAdmin: boolean, groups: string[]): UserRole {
  if (isAdmin) return 'admin';
  const normalized = groups.map((g) => g.replace(/^\//, ''));
  if (normalized.includes('issm')) return 'issm';
  if (normalized.includes('developers')) return 'developer';
  return 'viewer';
}

interface ActionItem {
  label: string;
  icon: typeof Rocket;
  href?: string;
  onClick?: boolean;
  color: string;
  hoverColor: string;
  roles: UserRole[];
}

function getActions(): ActionItem[] {
  return [
    {
      label: 'Deploy App',
      icon: Rocket,
      onClick: true,
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
      hoverColor: 'hover:bg-cyan-500/20 hover:border-cyan-500/30',
      roles: ['admin', 'developer'] as UserRole[],
    },
    {
      label: 'Review Queue',
      icon: ShieldCheck,
      href: svcUrl('dashboard'),
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      hoverColor: 'hover:bg-emerald-500/20 hover:border-emerald-500/30',
      roles: ['issm'] as UserRole[],
    },
    {
      label: 'View Metrics',
      icon: BarChart3,
      href: svcUrl('grafana'),
      color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
      hoverColor: 'hover:bg-indigo-500/20 hover:border-indigo-500/30',
      roles: ['admin', 'issm', 'developer', 'viewer'] as UserRole[],
    },
    {
      label: 'Manage Users',
      icon: Users,
      href: svcUrl('keycloak'),
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      hoverColor: 'hover:bg-amber-500/20 hover:border-amber-500/30',
      roles: ['admin'] as UserRole[],
    },
  ];
}

export function QuickActions({ isAdmin, userGroups, onDeployClick }: QuickActionsProps) {
  const role = resolveRole(isAdmin, userGroups);
  const visibleActions = getActions().filter((a) => a.roles.includes(role));

  return (
    <div className="flex flex-wrap gap-3">
      {visibleActions.map((action) =>
        action.onClick ? (
          <button
            key={action.label}
            onClick={onDeployClick}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200 ${action.color} ${action.hoverColor}`}
          >
            <action.icon className="h-4 w-4" />
            {action.label}
          </button>
        ) : (
          <a
            key={action.label}
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200 ${action.color} ${action.hoverColor}`}
          >
            <action.icon className="h-4 w-4" />
            {action.label}
          </a>
        )
      )}
    </div>
  );
}
