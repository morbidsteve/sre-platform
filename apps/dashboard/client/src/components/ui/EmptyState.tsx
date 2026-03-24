import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-5">
      {icon && (
        <div className="text-[28px] mb-3 block">{icon}</div>
      )}
      <h3 className="text-lg text-text-bright mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-text-dim mb-4">{description}</p>
      )}
      {action}
    </div>
  );
}
