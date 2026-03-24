import React from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  variant?: 'accent' | 'green' | 'red';
  animated?: boolean;
}

const variantColorMap: Record<string, string> = {
  accent: 'var(--accent)',
  green: 'var(--green)',
  red: 'var(--red)',
};

export function ProgressBar({
  value,
  max = 100,
  variant = 'accent',
  animated = false,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      className="w-full h-1.5 rounded-full overflow-hidden"
      style={{ background: 'var(--border)' }}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${
          animated ? 'animate-pipe-pulse' : ''
        }`}
        style={{
          width: `${pct}%`,
          background: variantColorMap[variant],
        }}
      />
    </div>
  );
}
