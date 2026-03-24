import React from 'react';

interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  ready: boolean;
}

interface HelmReleaseTableProps {
  helmReleases: HelmRelease[];
  loading: boolean;
}

export function HelmReleaseTable({ helmReleases, loading }: HelmReleaseTableProps) {
  const sorted = [...helmReleases].sort((a, b) => a.namespace.localeCompare(b.namespace));

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-bright">Platform Components</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Status</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Component</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Namespace</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Chart</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Version</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <span className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-dim">
                  No HelmReleases found
                </td>
              </tr>
            ) : (
              sorted.map((hr) => (
                <tr key={`${hr.namespace}/${hr.name}`} className="border-b border-border last:border-b-0 hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                      hr.ready
                        ? 'bg-[rgba(64,192,87,0.15)] text-green'
                        : 'bg-[rgba(250,82,82,0.15)] text-red'
                    }`}>
                      {hr.ready ? 'Healthy' : 'Unhealthy'}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-semibold text-text-bright">{hr.name}</td>
                  <td className="px-4 py-2 text-text-dim">{hr.namespace}</td>
                  <td className="px-4 py-2 text-text-dim">{hr.chart}</td>
                  <td className="px-4 py-2 text-text-dim">{hr.version}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
