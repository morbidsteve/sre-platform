import React from 'react';
import { Badge } from '../ui/Badge';
import type { GateFinding } from '../../types';

interface GateDetailProps {
  findings: GateFinding[];
}

const severityOrder = ['critical', 'high', 'medium', 'low', 'info'] as const;

const severityColors = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
} as const;

export function GateDetail({ findings }: GateDetailProps) {
  const sorted = [...findings].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
  );

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {severityOrder.map((sev) =>
          counts[sev] ? (
            <Badge key={sev} variant={severityColors[sev]}>
              {counts[sev]} {sev.toUpperCase()}
            </Badge>
          ) : null
        )}
      </div>

      {/* Findings List */}
      <div className="space-y-2">
        {sorted.map((finding, i) => (
          <div
            key={i}
            className="bg-navy-900/50 rounded-lg p-3 border border-navy-600"
          >
            <div className="flex items-start gap-2">
              <Badge variant={severityColors[finding.severity]} className="mt-0.5">
                {finding.severity.toUpperCase()}
              </Badge>
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {finding.title}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {finding.description}
                </p>
                {finding.location && (
                  <p className="text-xs text-gray-500 font-mono mt-1">
                    {finding.location}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
