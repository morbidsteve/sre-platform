import React, { useState } from 'react';
import { Clock, AlertTriangle, Info, Filter } from 'lucide-react';
import type { OpsEvent } from '../../api/ops';

interface EventsTimelineProps {
  events: OpsEvent[];
  maxHeight?: string;
  compact?: boolean;
}

function eventIcon(type: string) {
  if (type === 'Warning') return <AlertTriangle className="w-3 h-3 text-yellow flex-shrink-0 mt-0.5" />;
  return <Info className="w-3 h-3 text-text-dim flex-shrink-0 mt-0.5" />;
}

function eventRowClass(type: string): string {
  if (type === 'Warning') return 'border-yellow/20 bg-yellow/5';
  return 'border-border bg-surface';
}

function eventReasonColor(type: string): string {
  if (type === 'Warning') return 'text-yellow';
  return 'text-accent';
}

export function EventsTimeline({ events, maxHeight = '320px', compact = false }: EventsTimelineProps) {
  const [filter, setFilter] = useState<'all' | 'Warning' | 'Normal'>('all');

  const filtered = filter === 'all' ? events : events.filter((e) => e.type === filter);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-text-dim text-xs font-mono">
        No events recorded
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-3 h-3 text-text-dim" />
          {(['all', 'Warning', 'Normal'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                filter === f
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-dim hover:border-border-hover'
              }`}
            >
              {f === 'all' ? `All (${events.length})` : f === 'Warning'
                ? `Warnings (${events.filter((e) => e.type === 'Warning').length})`
                : `Normal (${events.filter((e) => e.type === 'Normal').length})`}
            </button>
          ))}
        </div>
      )}

      <div
        className="overflow-y-auto space-y-1 pr-0.5"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-6 text-text-dim text-xs font-mono">No matching events</div>
        ) : (
          filtered.map((ev, i) => (
            <div
              key={i}
              className={`border rounded-[var(--radius)] px-2.5 py-2 ${eventRowClass(ev.type)}`}
            >
              <div className="flex items-start gap-2">
                {eventIcon(ev.type)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[10px] font-mono font-semibold ${eventReasonColor(ev.type)}`}>
                      {ev.reason}
                    </span>
                    {ev.count > 1 && (
                      <span className="text-[9px] font-mono text-text-muted bg-surface px-1 py-0.5 rounded border border-border">
                        ×{ev.count}
                      </span>
                    )}
                    <div className="flex items-center gap-0.5 text-[9px] font-mono text-text-muted ml-auto flex-shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      {ev.age}
                    </div>
                  </div>
                  <div className="text-[11px] text-text-dim leading-relaxed break-words">
                    {ev.message}
                  </div>
                  {!compact && ev.object && (
                    <div className="text-[9px] font-mono text-text-muted mt-0.5 truncate">
                      {ev.object}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
