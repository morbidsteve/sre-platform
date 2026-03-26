import React from 'react';
import { History, Plus, AlertTriangle, Clock } from 'lucide-react';
import type { ResumePromptData } from '../hooks/useWizardState';

interface ResumePromptProps {
  prompt: ResumePromptData;
  onResume: () => void;
  onStartNew: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  scanning: 'Security scan in progress',
  review_pending: 'Awaiting ISSM review',
  approved: 'Approved — ready to deploy',
  returned: 'Returned for changes',
  failed: 'Scan failed (may be retryable)',
  deploying: 'Deployment in progress',
  deployed: 'Deployed',
  undeployed: 'Undeployed',
  rejected: 'Rejected by ISSM',
};

function formatRelativeTime(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return 'recently';
  }
}

export function ResumePrompt({ prompt, onResume, onStartNew }: ResumePromptProps) {
  const statusLabel = STATUS_LABELS[prompt.status] ?? prompt.status;
  const isActionable = !['failed'].includes(prompt.status);

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-navy-800 border border-navy-600 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-navy-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <History className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-100">
              Previous run detected
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              A pipeline run was found in your session. What would you like to do?
            </p>
          </div>
        </div>

        {/* Run summary card */}
        <div className="px-6 py-4">
          <div className="bg-navy-900/60 border border-navy-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-200 truncate max-w-xs">
                {prompt.appName}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5" />
                {formatRelativeTime(prompt.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {prompt.status === 'failed' ? (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              )}
              <span className={`text-xs font-mono ${
                prompt.status === 'failed' ? 'text-red-400' :
                prompt.status === 'approved' ? 'text-emerald-400' :
                'text-amber-400'
              }`}>
                {statusLabel}
              </span>
            </div>

            {prompt.status === 'failed' && (
              <p className="text-xs text-gray-400 leading-relaxed">
                This run has failed gates. You can resume to view the results and retry,
                or start a new pipeline from scratch.
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-navy-700 flex flex-col sm:flex-row gap-3">
          {isActionable && (
            <button
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
            >
              <History className="w-4 h-4" />
              Resume previous run
            </button>
          )}
          {/* For failed runs, show resume as a secondary option */}
          {!isActionable && (
            <button
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-navy-700 hover:bg-navy-600 border border-navy-500 text-gray-200 text-sm font-medium transition-colors"
            >
              <History className="w-4 h-4" />
              View and retry
            </button>
          )}
          <button
            onClick={onStartNew}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActionable
                ? 'bg-navy-700 hover:bg-navy-600 border border-navy-500 text-gray-200'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            Start new pipeline
          </button>
        </div>
      </div>
    </div>
  );
}
