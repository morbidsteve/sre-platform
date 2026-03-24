import React from 'react';
import {
  LayoutDashboard,
  Rocket,
  AppWindow,
  Shield,
  Activity,
  ClipboardCheck,
  Settings,
} from 'lucide-react';

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
  mobileOpen?: boolean;
}

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const tabs: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { id: 'deploy', label: 'Deploy', icon: <Rocket size={14} /> },
  { id: 'applications', label: 'Applications', icon: <AppWindow size={14} /> },
  { id: 'security', label: 'Security', icon: <Shield size={14} /> },
  { id: 'operations', label: 'Operations', icon: <Activity size={14} /> },
  { id: 'compliance', label: 'Compliance', icon: <ClipboardCheck size={14} /> },
  { id: 'admin', label: 'Admin', icon: <Settings size={14} />, adminOnly: true },
];

export function Navigation({ activeTab, onTabChange, isAdmin, mobileOpen = false }: NavigationProps) {
  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <>
    {mobileOpen && (
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[98] md:hidden"
        onClick={() => onTabChange(activeTab)}
      />
    )}
    <nav
      className={`bg-bg-secondary border-b border-border px-6 gap-0 overflow-x-auto
        ${mobileOpen
          ? 'flex flex-col absolute top-full left-0 right-0 z-[99] p-0 border-b border-border animate-slide-in'
          : 'hidden md:flex'
        }`}
    >
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          className={`font-mono text-[11px] font-medium uppercase tracking-[1.5px] bg-transparent border-none cursor-pointer whitespace-nowrap min-h-[44px] relative transition-colors duration-150 flex items-center gap-1.5
            ${mobileOpen
              ? `text-left border-l-[3px] border-l-transparent px-5 py-3.5 ${
                  activeTab === tab.id
                    ? 'text-accent !border-l-accent'
                    : 'text-text-dim hover:text-text-primary'
                }`
              : `px-4 py-3 border-b-2 border-b-transparent ${
                  activeTab === tab.id
                    ? 'text-accent !border-b-accent'
                    : 'text-text-dim hover:text-text-primary'
                }`
            }`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
    </>
  );
}
