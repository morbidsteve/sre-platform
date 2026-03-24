import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-4 h-4 border',
  md: 'w-5 h-5 border-2',
  lg: 'w-7 h-7 border-[3px]',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <span
      className={`inline-block rounded-full animate-spin ${sizeMap[size]} ${className}`}
      style={{
        borderColor: 'var(--border)',
        borderTopColor: 'var(--accent)',
      }}
      role="status"
      aria-label="Loading"
    />
  );
}
