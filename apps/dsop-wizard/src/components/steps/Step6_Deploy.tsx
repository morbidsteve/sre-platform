import React from 'react';
import {
  CheckCircle2,
  Loader2,
  Clock,
  XCircle,
  Rocket,
} from 'lucide-react';
import type { DeployStep } from '../../types';

interface Step6Props {
  deploySteps: DeployStep[];
  isDeploying: boolean;
  error: string | null;
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: 'text-gray-500',
    bg: 'bg-navy-700',
    animate: false,
  },
  running: {
    icon: Loader2,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    animate: false,
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    animate: false,
  },
};

export function Step6_Deploy({ deploySteps, isDeploying, error }: Step6Props) {
  const completed = deploySteps.filter((s) => s.status === 'completed').length;
  const total = deploySteps.length;
  const progressPct = (completed / total) * 100;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Rocket className="w-8 h-8 text-cyan-400" />
          <h2 className="text-2xl font-bold text-gray-100">
            {isDeploying ? 'Deploying...' : error ? 'Deployment Failed' : 'Deploying...'}
          </h2>
        </div>
        <p className="text-gray-400">
          Provisioning resources on the SRE Platform
        </p>
      </div>

      {/* Progress Bar */}
      <div className="max-w-xl mx-auto">
        <div className="progress-bar h-4 rounded-xl">
          <div
            className="progress-bar-fill rounded-xl"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-center text-sm text-gray-400 mt-2 font-mono">
          {Math.round(progressPct)}%
        </p>
      </div>

      {/* Deploy Steps */}
      <div className="max-w-xl mx-auto space-y-3">
        {deploySteps.map((step) => {
          const config = statusConfig[step.status];
          const Icon = config.icon;

          return (
            <div
              key={step.id}
              className={`flex items-center gap-3 p-4 rounded-lg border border-navy-600 ${config.bg} transition-all duration-300`}
            >
              <Icon
                className={`w-5 h-5 flex-shrink-0 ${config.color} ${
                  config.animate ? 'animate-spin' : ''
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  step.status === 'completed'
                    ? 'text-gray-200'
                    : step.status === 'running'
                    ? 'text-cyan-300'
                    : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
              {step.status === 'running' && (
                <span className="ml-auto text-xs text-cyan-400 font-mono animate-pulse">
                  in progress
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Error State */}
      {error && (
        <div className="max-w-xl mx-auto bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
