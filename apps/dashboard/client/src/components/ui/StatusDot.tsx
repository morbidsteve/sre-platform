import React from 'react';

interface StatusDotProps {
  color: 'green' | 'red' | 'yellow' | 'unknown';
}

const colorMap: Record<StatusDotProps['color'], string> = {
  green: 'var(--green)',
  red: 'var(--red)',
  yellow: 'var(--yellow)',
  unknown: 'var(--text-dim)',
};

export function StatusDot({ color }: StatusDotProps) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: colorMap[color] }}
    />
  );
}
