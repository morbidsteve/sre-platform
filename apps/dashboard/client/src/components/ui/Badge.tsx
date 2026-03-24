import React from 'react';

interface BadgeProps {
  variant: 'green' | 'red' | 'yellow' | 'accent' | 'dim';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  );
}
