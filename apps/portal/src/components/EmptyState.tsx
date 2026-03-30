import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  onDeployClick?: () => void;
}

export function EmptyState({ onDeployClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/50 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800">
        <Inbox className="h-7 w-7 text-slate-600" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-slate-400">
        No applications found
      </h3>
      <p className="mt-1 max-w-xs text-center text-xs text-slate-600">
        Applications you deploy will appear here. Click below to deploy your first app.
      </p>
      <button
        onClick={onDeployClick}
        className="mt-5 rounded-lg bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20"
      >
        Deploy an Application
      </button>
    </div>
  );
}
