import React from 'react';
import type { PipelineStats } from '../../types/api';

interface PipelineStatsCardsProps {
  stats: PipelineStats | null;
}

const STAT_CARDS = [
  { key: 'total', label: 'Total Runs', color: '' },
  { key: 'approved', label: 'Approved', color: 'text-green' },
  { key: 'failed', label: 'Failed', color: 'text-red' },
  { key: 'review_pending', label: 'Pending Review', color: 'text-yellow' },
] as const;

export function PipelineStatsCards({ stats }: PipelineStatsCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {STAT_CARDS.map((card) => (
        <div key={card.key} className="card-base p-4 text-center">
          <h3 className="text-[11px] uppercase tracking-[1px] text-text-dim mb-1">{card.label}</h3>
          <div className={`text-2xl font-bold ${card.color || 'text-text-primary'}`}>
            {stats ? stats[card.key] ?? '--' : '--'}
          </div>
        </div>
      ))}
    </div>
  );
}
