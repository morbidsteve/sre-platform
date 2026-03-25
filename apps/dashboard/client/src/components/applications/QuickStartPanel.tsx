import React, { useEffect, useState } from 'react';
import { SampleAppCard } from './SampleAppCard';
import { useConfig } from '../../context/ConfigContext';

interface SampleApp {
  name: string;
  description: string;
  image: string;
  tag: string;
  port: number;
}

interface QuickStartPanelProps {
  onDeploy: (payload: {
    name: string;
    team: string;
    image: string;
    tag: string;
    port: number;
    replicas: number;
    ingress: string;
  }) => Promise<void>;
}

export function QuickStartPanel({ onDeploy }: QuickStartPanelProps) {
  const config = useConfig();
  const [samples, setSamples] = useState<SampleApp[]>([]);
  const [teamName, setTeamName] = useState('demo');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSamples = async () => {
      try {
        const resp = await fetch('/api/samples');
        const data = await resp.json();
        setSamples(data.samples || []);
      } catch {
        setSamples([]);
      } finally {
        setLoading(false);
      }
    };
    loadSamples();
  }, []);

  const handleDeploy = async (sample: SampleApp) => {
    const team = teamName.trim() || 'demo';
    await onDeploy({
      name: sample.name,
      team,
      image: sample.image,
      tag: sample.tag,
      port: sample.port,
      replicas: 1,
      ingress: `${sample.name}.${config.domain}`,
    });
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-5">
      <h2 className="text-base font-semibold text-text-bright mb-1">Quick Start</h2>
      <p className="text-text-dim text-[13px] mb-4">
        Deploy a sample app with one click to try the platform.
      </p>

      <div className="max-w-[300px] mb-4">
        <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
          Team Name
        </label>
        <input
          type="text"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="demo"
          pattern="[a-z0-9\-]+"
          className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <div className="text-[11px] text-text-dim mt-1">Namespace for sample deployments</div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <span className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {samples.map((s) => (
            <SampleAppCard key={s.name} sample={s} onDeploy={handleDeploy} />
          ))}
        </div>
      )}
    </div>
  );
}
