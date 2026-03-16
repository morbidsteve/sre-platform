import { Rocket, BarChart3, Users } from 'lucide-react';

interface QuickActionsProps {
  isAdmin: boolean;
}

const actions = [
  {
    label: 'Deploy App',
    icon: Rocket,
    href: 'https://dashboard.apps.sre.example.com/deploy',
    color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    hoverColor: 'hover:bg-cyan-500/20 hover:border-cyan-500/30',
  },
  {
    label: 'View Metrics',
    icon: BarChart3,
    href: 'https://grafana.apps.sre.example.com',
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    hoverColor: 'hover:bg-indigo-500/20 hover:border-indigo-500/30',
  },
  {
    label: 'Manage Users',
    icon: Users,
    href: 'https://keycloak.apps.sre.example.com',
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    hoverColor: 'hover:bg-amber-500/20 hover:border-amber-500/30',
    adminOnly: true,
  },
];

export function QuickActions({ isAdmin }: QuickActionsProps) {
  const visibleActions = actions.filter((a) => !a.adminOnly || isAdmin);

  return (
    <div className="flex flex-wrap gap-3">
      {visibleActions.map((action) => (
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
      ))}
    </div>
  );
}
