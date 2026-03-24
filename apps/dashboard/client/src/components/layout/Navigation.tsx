import React from 'react';
import {
  LayoutDashboard,
  Grid3X3,
  Layers,
  Server,
  ShieldCheck,
  FileText,
  Users,
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
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { id: 'applications', label: 'Applications', icon: <Grid3X3 size={14} /> },
  { id: 'platform', label: 'Platform', icon: <Layers size={14} /> },
  { id: 'cluster', label: 'Cluster', icon: <Server size={14} /> },
  { id: 'pipeline', label: 'Pipeline', icon: <ShieldCheck size={14} /> },
  { id: 'audit', label: 'Audit', icon: <FileText size={14} /> },
  { id: 'admin', label: 'Admin', icon: <Users size={14} />, adminOnly: true },
];

export function Navigation({ activeTab, onTabChange, isAdmin, mobileOpen = false }: NavigationProps) {
  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <nav
      className={`bg-bg-secondary border-b border-border px-6 gap-0 overflow-x-auto
        ${mobileOpen
          ? 'flex flex-col absolute top-full left-0 right-0 z-[99] p-0 border-b border-border'
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
  );
}
