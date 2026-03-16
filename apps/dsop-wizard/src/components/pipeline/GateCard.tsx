import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  SkipForward,
  ExternalLink,
  SquareCheck,
  Square,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { SecurityGate } from '../../types';

interface GateCardProps {
  gate: SecurityGate;
  onAcknowledge?: (gateId: number) => void;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-gray-400', bg: 'border-navy-600', label: 'PENDING' },
  running: { icon: Loader2, color: 'text-cyan-400', bg: 'border-cyan-500/40', label: 'RUNNING' },
  passed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'border-emerald-500/40', label: 'PASSED' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'border-red-500/40', label: 'FAILED' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'border-amber-500/40', label: 'WARNING' },
  skipped: { icon: SkipForward, color: 'text-gray-400', bg: 'border-gray-500/30', label: 'MANUAL' },
};

const severityColors = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
} as const;

export function GateCard({ gate, onAcknowledge }: GateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[gate.status];
  const StatusIcon = config.icon;

  const hasDetails =
    gate.findings.length > 0 ||
    gate.summary ||
    !gate.implemented ||
    gate.reportUrl;

  return (
    <div
      className={`gate-card ${expanded ? 'expanded' : ''} ${config.bg} ${
        gate.status === 'running' ? 'scanline-effect' : ''
      }`}
    >
      {/* Header Row */}
      <div
        className={`flex items-center gap-3 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {/* Status Icon */}
        <StatusIcon
          className={`w-5 h-5 flex-shrink-0 ${config.color} ${
            gate.status === 'running' ? 'animate-spin' : ''
          }`}
        />

        {/* Gate Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-400">
              GATE {gate.id}:
            </span>
            <span className="text-sm font-medium text-gray-200 truncate">
              {gate.shortName}
            </span>
          </div>
          {gate.status === 'running' && (
            <div className="mt-2 progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${gate.progress}%` }}
              />
            </div>
          )}
          {gate.summary && gate.status !== 'running' && (
            <p className="text-xs text-gray-400 mt-1 font-mono">{gate.summary}</p>
          )}
        </div>

        {/* Status Badge */}
        <Badge
          variant={
            gate.status === 'passed'
              ? 'success'
              : gate.status === 'failed'
              ? 'danger'
              : gate.status === 'warning'
              ? 'warning'
              : gate.status === 'running'
              ? 'info'
              : 'neutral'
          }
        >
          {config.label}
        </Badge>

        {/* Expand Arrow */}
        {hasDetails && (
          <div className="text-gray-500">
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-navy-600 animate-fade-in">
          <p className="text-sm text-gray-300 mb-3">{gate.description}</p>

          {/* Findings */}
          {gate.findings.length > 0 && (
            <div className="space-y-2 mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Findings ({gate.findings.length})
              </h4>
              {gate.findings.map((finding, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-navy-900/50 rounded-lg p-3"
                >
                  <Badge variant={severityColors[finding.severity]}>
                    {finding.severity.toUpperCase()}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200 font-medium">
                      {finding.title}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {finding.description}
                    </p>
                    {finding.location && (
                      <p className="text-xs text-gray-500 font-mono mt-1">
                        {finding.location}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Not Implemented Notice */}
          {!gate.implemented && gate.status === 'skipped' && (
            <div className="bg-navy-900/50 rounded-lg p-3 border border-gray-600/30">
              <p className="text-sm text-amber-400 font-medium mb-2">
                Coming Soon — Manual Verification Required
              </p>
              <p className="text-xs text-gray-400 mb-3">
                This gate is not yet automated. Please verify manually and
                acknowledge below.
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAcknowledge?.(gate.id);
                }}
                className="flex items-center gap-2 text-sm text-gray-300 hover:text-cyan-400 transition-colors"
              >
                {gate.manualAck ? (
                  <SquareCheck className="w-4 h-4 text-cyan-400" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                I have manually verified this gate
              </button>
            </div>
          )}

          {/* Report Link */}
          {gate.reportUrl && (
            <a
              href={gate.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 mt-2"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Report
            </a>
          )}
        </div>
      )}
    </div>
  );
}
