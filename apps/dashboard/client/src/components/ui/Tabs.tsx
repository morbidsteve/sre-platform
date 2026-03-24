import React from 'react';

interface TabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1.5 mb-5 flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`font-mono py-[7px] px-4 rounded border text-[10px] font-medium uppercase tracking-[1px] cursor-pointer transition-all duration-150 ${
            active === tab.id
              ? 'bg-accent text-white border-accent'
              : 'bg-card text-text-dim border-border hover:border-accent hover:text-text-primary'
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
