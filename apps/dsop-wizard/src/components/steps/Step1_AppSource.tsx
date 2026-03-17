import React from 'react';
import { GitBranch, Container, ArrowRight } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import type { AppSource, SourceType } from '../../types';

interface Step1Props {
  source: AppSource;
  onUpdate: (source: Partial<AppSource>) => void;
  onNext: () => void;
}

// Helm icon since lucide doesn't have one
function HelmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2v20M2 12h20M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  );
}

const sourceOptions: { type: SourceType; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    type: 'git',
    label: 'Git Repo',
    icon: <GitBranch className="w-8 h-8" />,
    desc: 'Clone and auto-detect',
  },
  {
    type: 'container',
    label: 'Container Image',
    icon: <Container className="w-8 h-8" />,
    desc: 'Pull from any registry',
  },
  {
    type: 'helm',
    label: 'Helm Chart',
    icon: <HelmIcon className="w-8 h-8" />,
    desc: 'Deploy from chart repo',
  },
];

export function Step1_AppSource({ source, onUpdate, onNext }: Step1Props) {
  const isValid =
    (source.type === 'git' && source.gitUrl && source.gitUrl.trim().length > 0) ||
    (source.type === 'container' && source.imageUrl && source.imageUrl.trim().length > 0) ||
    (source.type === 'helm' && source.chartRepo && source.chartName);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100 glow-text">
          Deploy to SRE Platform
        </h2>
        <p className="text-gray-400 mt-2">
          Choose your deployment source to begin the DSOP-compliant pipeline
        </p>
      </div>

      {/* Source Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sourceOptions.map((opt) => (
          <button
            key={opt.type}
            onClick={() => onUpdate({ type: opt.type })}
            className={`source-card text-center ${
              source.type === opt.type ? 'selected' : ''
            }`}
          >
            <div
              className={`mx-auto mb-3 ${
                source.type === opt.type ? 'text-cyan-400' : 'text-gray-400'
              }`}
            >
              {opt.type === 'helm' ? (
                <HelmIcon className="w-8 h-8 mx-auto" />
              ) : (
                opt.icon
              )}
            </div>
            <h3 className="font-semibold text-gray-200">{opt.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
          </button>
        ))}
      </div>

      {/* Input Fields Based on Selection */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        {source.type === 'git' && (
          <>
            <Input
              label="Git Repository URL"
              placeholder="https://github.com/org/repo.git"
              value={source.gitUrl || ''}
              onChange={(e) => onUpdate({ gitUrl: e.target.value })}
            />
            <Input
              label="Branch"
              placeholder="main"
              value={source.branch || 'main'}
              onChange={(e) => onUpdate({ branch: e.target.value })}
            />
          </>
        )}

        {source.type === 'container' && (
          <Input
            label="Container Image URL"
            placeholder="registry.example.com/org/app:v1.2.3"
            value={source.imageUrl || ''}
            onChange={(e) => onUpdate({ imageUrl: e.target.value })}
          />
        )}

        {source.type === 'helm' && (
          <>
            <Input
              label="Helm Chart Repository"
              placeholder="https://charts.example.com"
              value={source.chartRepo || ''}
              onChange={(e) => onUpdate({ chartRepo: e.target.value })}
            />
            <Input
              label="Chart Name"
              placeholder="my-chart"
              value={source.chartName || ''}
              onChange={(e) => onUpdate({ chartName: e.target.value })}
            />
          </>
        )}
      </div>

      {/* Next Button */}
      <div className="flex justify-end">
        <Button
          onClick={onNext}
          disabled={!isValid}
          icon={<ArrowRight className="w-4 h-4" />}
          size="lg"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
