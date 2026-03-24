import React, { useState } from 'react';
import { Rocket } from 'lucide-react';

interface SampleApp {
  name: string;
  description: string;
  image: string;
  tag: string;
  port: number;
}

interface SampleAppCardProps {
  sample: SampleApp;
  onDeploy: (sample: SampleApp) => Promise<void>;
}

export function SampleAppCard({ sample, onDeploy }: SampleAppCardProps) {
  const [deploying, setDeploying] = useState(false);

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      await onDeploy(sample);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-4 flex flex-col justify-between">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-text-bright mb-1">{sample.name}</h4>
        <p className="text-xs text-text-dim mb-2">{sample.description}</p>
        <code className="text-[11px] bg-bg px-1.5 py-0.5 rounded font-mono text-text-dim">
          {sample.image}:{sample.tag}
        </code>
      </div>
      <button
        className="btn btn-success text-xs w-full flex items-center justify-center gap-1.5"
        onClick={handleDeploy}
        disabled={deploying}
      >
        {deploying ? (
          <span className="inline-block w-3 h-3 border border-green border-t-transparent rounded-full animate-spin" />
        ) : (
          <Rocket className="w-3 h-3" />
        )}
        {deploying ? 'Deploying...' : 'Deploy'}
      </button>
    </div>
  );
}
