import React from 'react';
import { Shield, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import type { SecurityGate } from '../../types';

interface PipelineProgressProps {
  gates: SecurityGate[];
}

export function PipelineProgress({ gates }: PipelineProgressProps) {
  const passed = gates.filter((g) => g.status === 'passed').length;
  const failed = gates.filter((g) => g.status === 'failed').length;
  const warnings = gates.filter((g) => g.status === 'warning').length;
  const pending = gates.filter(
    (g) => g.status === 'pending' || g.status === 'skipped'
  ).length;
  const running = gates.filter((g) => g.status === 'running').length;
  const total = gates.length;

  const completedPct = ((passed + warnings + failed) / total) * 100;

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="w-6 h-6 text-cyan-400" />
        <h2 className="text-lg font-semibold text-gray-100">
          RAISE Security Pipeline
        </h2>
      </div>

      {/* Overall Progress */}
      <div className="progress-bar mb-4 h-3">
        <div
          className="progress-bar-fill"
          style={{ width: `${completedPct}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-emerald-400 font-mono">{passed}</span>
          <span className="text-gray-400">passed</span>
        </div>
        {warnings > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-amber-400 font-mono">{warnings}</span>
            <span className="text-gray-400">warnings</span>
          </div>
        )}
        {failed > 0 && (
          <div className="flex items-center gap-1.5">
            <XCircle className="w-4 h-4 text-red-400" />
            <span className="text-red-400 font-mono">{failed}</span>
            <span className="text-gray-400">failed</span>
          </div>
        )}
        {running > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            <span className="text-cyan-400 font-mono">{running}</span>
            <span className="text-gray-400">running</span>
          </div>
        )}
        {pending > 0 && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400 font-mono">{pending}</span>
            <span className="text-gray-400">pending</span>
          </div>
        )}
        <div className="ml-auto text-gray-500 font-mono text-xs">
          {passed + warnings}/{total} gates cleared
        </div>
      </div>
    </div>
  );
}
