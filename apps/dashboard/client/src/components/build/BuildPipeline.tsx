import React from 'react';
import { Download, Hammer, Upload, Rocket } from 'lucide-react';

export type BuildStepStatus = 'pending' | 'active' | 'done' | 'failed';

interface BuildStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: BuildStepStatus;
}

interface BuildPipelineProps {
  steps?: BuildStep[];
  currentStep?: string;
}

const DEFAULT_STEPS: BuildStep[] = [
  { id: 'clone', label: 'Clone', icon: <Download className="w-4 h-4" />, status: 'pending' },
  { id: 'build', label: 'Build', icon: <Hammer className="w-4 h-4" />, status: 'pending' },
  { id: 'push', label: 'Push', icon: <Upload className="w-4 h-4" />, status: 'pending' },
  { id: 'deploy', label: 'Deploy', icon: <Rocket className="w-4 h-4" />, status: 'pending' },
];

export function BuildPipeline({ steps, currentStep }: BuildPipelineProps) {
  const displaySteps = steps || DEFAULT_STEPS;

  const getStepClasses = (status: BuildStepStatus): string => {
    switch (status) {
      case 'done':
        return 'border-green bg-[rgba(64,192,87,0.1)] text-green';
      case 'active':
        return 'border-accent bg-[rgba(77,171,247,0.1)] text-accent animate-pipe-pulse';
      case 'failed':
        return 'border-red bg-[rgba(250,82,82,0.1)] text-red';
      default:
        return 'border-border bg-surface text-text-dim';
    }
  };

  const getConnectorClasses = (status: BuildStepStatus): string => {
    switch (status) {
      case 'done':
        return 'bg-green';
      case 'active':
        return 'bg-accent animate-pipe-pulse';
      case 'failed':
        return 'bg-red';
      default:
        return 'bg-border';
    }
  };

  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {displaySteps.map((step, i) => (
        <React.Fragment key={step.id}>
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius)] border transition-all text-sm font-mono ${getStepClasses(step.status)}`}
          >
            {step.icon}
            <span>{step.label}</span>
          </div>
          {i < displaySteps.length - 1 && (
            <div className={`w-8 h-0.5 ${getConnectorClasses(displaySteps[i + 1].status === 'pending' ? step.status : displaySteps[i + 1].status)}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
