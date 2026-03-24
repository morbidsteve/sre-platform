import React, { useState } from 'react';

interface HelmDeployFormProps {
  onDeploy: (payload: {
    repoUrl: string;
    chartName: string;
    version: string;
    releaseName: string;
    team: string;
    values: string;
  }) => Promise<void>;
}

const POPULAR_CHARTS = [
  { label: 'Nginx', repo: 'https://charts.bitnami.com/bitnami', chart: 'nginx' },
  { label: 'PostgreSQL', repo: 'https://charts.bitnami.com/bitnami', chart: 'postgresql' },
  { label: 'Redis', repo: 'https://charts.bitnami.com/bitnami', chart: 'redis' },
  { label: 'MongoDB', repo: 'https://charts.bitnami.com/bitnami', chart: 'mongodb' },
  { label: 'RabbitMQ', repo: 'https://charts.bitnami.com/bitnami', chart: 'rabbitmq' },
  { label: 'MinIO', repo: 'https://charts.bitnami.com/bitnami', chart: 'minio' },
];

export function HelmDeployForm({ onDeploy }: HelmDeployFormProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [chartName, setChartName] = useState('');
  const [version, setVersion] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [team, setTeam] = useState('');
  const [values, setValues] = useState('');
  const [deploying, setDeploying] = useState(false);

  const fillChart = (repo: string, chart: string) => {
    setRepoUrl(repo);
    setChartName(chart);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl || !chartName || !releaseName || !team) return;
    setDeploying(true);
    try {
      await onDeploy({ repoUrl, chartName, version, releaseName, team, values });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-5">
      <h2 className="text-base font-semibold text-text-bright mb-1">Deploy Helm Chart</h2>
      <p className="text-text-dim text-[13px] mb-4">
        Deploy any Helm chart from a public or private chart repository.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Chart Repository URL
            </label>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://charts.bitnami.com/bitnami"
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Chart Name
            </label>
            <input
              type="text"
              value={chartName}
              onChange={(e) => setChartName(e.target.value)}
              placeholder="nginx"
              required
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Chart Version
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="18.1.0 (optional)"
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <div className="text-[11px] text-text-dim mt-1">Leave blank for latest</div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
              Release Name
            </label>
            <input
              type="text"
              value={releaseName}
              onChange={(e) => setReleaseName(e.target.value)}
              placeholder="my-nginx"
              required
              pattern="[a-z0-9\-]+"
              className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="mb-4 max-w-[300px]">
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
            Team Name
          </label>
          <input
            type="text"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="my-team"
            required
            pattern="[a-z0-9\-]+"
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">
            Values Override (YAML)
          </label>
          <textarea
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder={`# Override chart values here\nreplicaCount: 2\nservice:\n  type: ClusterIP\n  port: 8080`}
            rows={6}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>

        <div className="mb-4">
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-2">
            Popular Charts
          </div>
          <div className="flex flex-wrap gap-2">
            {POPULAR_CHARTS.map((pc) => (
              <button
                key={pc.label}
                type="button"
                className="px-2.5 py-1 text-xs font-mono border border-border rounded-[var(--radius)] bg-surface text-text-primary hover:bg-surface-hover hover:border-border-hover transition-colors"
                onClick={() => fillChart(pc.repo, pc.chart)}
              >
                {pc.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={deploying}
        >
          {deploying ? 'Deploying...' : 'Deploy Chart'}
        </button>
      </form>
    </div>
  );
}
