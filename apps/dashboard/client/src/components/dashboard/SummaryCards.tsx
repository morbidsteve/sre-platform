import React from 'react';
import { Activity, Server, AlertTriangle } from 'lucide-react';

interface HealthSummary {
  helmReleasesReady: number;
  helmReleasesTotal: number;
  nodesReady: number;
  nodesTotal: number;
  problemPodCount: number;
}

interface SummaryCardsProps {
  summary: HealthSummary | null;
  loading: boolean;
  onProblemPodsClick: () => void;
}

export function SummaryCards({ summary, loading, onProblemPodsClick }: SummaryCardsProps) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card border border-border rounded-[var(--radius)] p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">--</h3>
            <div className="text-3xl font-bold font-mono text-text-dim">--</div>
          </div>
        ))}
      </div>
    );
  }

  const componentsHealthy = summary.helmReleasesReady === summary.helmReleasesTotal;
  const nodesHealthy = summary.nodesReady === summary.nodesTotal;
  const noProblemPods = summary.problemPodCount === 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-card border border-border rounded-[var(--radius)] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-text-dim" />
          <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">Components</h3>
        </div>
        <div className={`text-3xl font-bold font-mono ${componentsHealthy ? 'text-green' : 'text-red'}`}>
          {summary.helmReleasesReady}/{summary.helmReleasesTotal}
        </div>
      </div>

      <div className="bg-card border border-border rounded-[var(--radius)] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Server className="w-4 h-4 text-text-dim" />
          <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">Nodes</h3>
        </div>
        <div className={`text-3xl font-bold font-mono ${nodesHealthy ? 'text-green' : 'text-red'}`}>
          {summary.nodesReady}/{summary.nodesTotal}
        </div>
      </div>

      <div
        className="bg-card border border-border rounded-[var(--radius)] p-5 cursor-pointer hover:border-border-hover transition-colors"
        onClick={onProblemPodsClick}
      >
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-text-dim" />
          <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">Problem Pods</h3>
        </div>
        <div className={`text-3xl font-bold font-mono ${noProblemPods ? 'text-green' : 'text-red'}`}>
          {summary.problemPodCount}
        </div>
        {summary.problemPodCount > 0 && (
          <div className="text-[11px] text-text-dim mt-1">Click for details</div>
        )}
      </div>
    </div>
  );
}
