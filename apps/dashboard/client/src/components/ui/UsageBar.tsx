import React from 'react';

interface UsageBarProps {
  label: string;
  used: number;
  total: number;
  unit?: string;
}

function getUsageColor(pct: number): string {
  if (pct > 85) return 'var(--red)';
  if (pct > 60) return 'var(--yellow)';
  return 'var(--green)';
}

export function UsageBar({ label, used, total, unit = '' }: UsageBarProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = getUsageColor(pct);

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-text-dim">{label}</span>
        <span className="font-mono text-xs text-text-dim">
          {used}{unit} / {total}{unit} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
