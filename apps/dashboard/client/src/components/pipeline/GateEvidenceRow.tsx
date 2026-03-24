import React, { useState } from 'react';
import { Badge } from '../ui/Badge';
import type { PipelineGate, PipelineFinding } from '../../types/api';

function gateStatusColor(status: string): 'green' | 'red' | 'yellow' | 'dim' {
  if (status === 'passed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'warning') return 'yellow';
  return 'dim';
}

function severityVariant(sev: string): 'red' | 'yellow' | 'accent' | 'dim' {
  if (sev === 'critical' || sev === 'high') return 'red';
  if (sev === 'medium') return 'yellow';
  if (sev === 'low') return 'accent';
  return 'dim';
}

interface GateEvidenceRowProps {
  gate: PipelineGate;
  isReview?: boolean;
  onDispositionChange?: (findingId: number, disposition: string, mitigation: string) => void;
}

export function GateEvidenceRow({ gate, isReview = false, onDispositionChange }: GateEvidenceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const findings = gate.findings || [];

  return (
    <div className="border border-border rounded-lg mb-2 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-surface/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: `var(--${gateStatusColor(gate.status)})` }}
          />
          {gate.short_name && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface text-text-dim border border-border">
              {gate.short_name}
            </span>
          )}
          <span className="text-sm font-semibold text-text-primary">{gate.name}</span>
          {gate.tool && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-dim">
              {gate.tool}
            </span>
          )}
          <Badge variant={gateStatusColor(gate.status)}>
            {(gate.status || 'pending').toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          {findings.length > 0 && (
            <span className="text-[11px] text-text-dim">
              {findings.length} finding{findings.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className={`text-text-dim transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
            &#9654;
          </span>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border p-3">
          {gate.summary && (
            <div className="text-xs text-text-dim mb-3">{gate.summary}</div>
          )}

          {findings.length === 0 ? (
            <div className="text-xs text-text-dim py-2">No findings for this gate.</div>
          ) : (
            <div className="space-y-2">
              {findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  isReview={isReview}
                  onDispositionChange={onDispositionChange}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  isReview,
  onDispositionChange,
}: {
  finding: PipelineFinding;
  isReview: boolean;
  onDispositionChange?: (findingId: number, disposition: string, mitigation: string) => void;
}) {
  const [disposition, setDisposition] = useState(finding.disposition || 'will_fix');
  const [mitigation, setMitigation] = useState(finding.mitigation || '');

  return (
    <div className="bg-bg rounded border border-border p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-text-primary">{finding.title || 'Untitled Finding'}</span>
        <Badge variant={severityVariant(finding.severity)}>
          {finding.severity}
        </Badge>
      </div>
      {finding.description && (
        <div className="text-[11px] text-text-dim mb-1">{finding.description}</div>
      )}
      {finding.location && (
        <div className="text-[10px] font-mono text-text-dim mb-1">{finding.location}</div>
      )}
      {finding.disposition && (
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded bg-surface text-text-dim`}>
          {(finding.disposition || '').replace(/_/g, ' ')}
        </span>
      )}

      {!isReview && onDispositionChange && (
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <select
            className="form-input !mb-0 text-xs py-1 min-w-[120px]"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
          >
            <option value="will_fix">Will Fix</option>
            <option value="accepted_risk">Accepted Risk</option>
            <option value="false_positive">False Positive</option>
            <option value="na">N/A</option>
          </select>
          <input
            type="text"
            className="form-input !mb-0 text-xs py-1 flex-1 min-w-[120px]"
            placeholder="Mitigation..."
            value={mitigation}
            onChange={(e) => setMitigation(e.target.value)}
          />
          <button
            className="btn btn-sm btn-primary text-xs"
            onClick={() => onDispositionChange(finding.id, disposition, mitigation)}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
