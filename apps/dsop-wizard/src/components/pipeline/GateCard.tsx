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
  Check,
  Save,
  Shield,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { SecurityGate, GateFinding, FindingDisposition } from '../../types';

interface GateCardProps {
  gate: SecurityGate;
  onAcknowledge?: (gateId: number) => void;
  onUpdateFinding?: (gateId: number, findingIndex: number, updates: Partial<GateFinding>) => void;
  onOverrideGate?: (gateId: number, status: 'passed' | 'skipped', reason: string) => void;
  isAdmin?: boolean;
  username?: string;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-gray-400', bg: 'border-navy-600', label: 'PENDING' },
  running: { icon: Loader2, color: 'text-cyan-400', bg: 'border-cyan-500/40', label: 'RUNNING' },
  passed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'border-emerald-500/40', label: 'PASSED' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'border-red-500/40', label: 'FAILED' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'border-amber-500/40', label: 'WARNING' },
  skipped: { icon: SkipForward, color: 'text-gray-400', bg: 'border-gray-500/30', label: 'SKIPPED' },
};

const severityColors = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
} as const;

const dispositionOptions: { value: FindingDisposition; label: string }[] = [
  { value: 'will_fix', label: 'Will Fix' },
  { value: 'accepted_risk', label: 'Accepted Risk' },
  { value: 'false_positive', label: 'False Positive' },
  { value: 'na', label: 'N/A' },
];

interface FindingCommentFormProps {
  finding: GateFinding;
  gateId: number;
  findingIndex: number;
  onSave: (gateId: number, findingIndex: number, updates: Partial<GateFinding>) => void;
  username: string;
}

function FindingCommentForm({ finding, gateId, findingIndex, onSave, username }: FindingCommentFormProps) {
  const [disposition, setDisposition] = useState<FindingDisposition | undefined>(finding.disposition);
  const [mitigation, setMitigation] = useState(finding.mitigation || '');
  const [saved, setSaved] = useState(!!finding.disposition);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disposition) return;
    onSave(gateId, findingIndex, {
      disposition,
      mitigation,
      mitigatedBy: username,
      mitigatedAt: new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mt-3 pt-3 border-t border-navy-600/50" onClick={(e) => e.stopPropagation()}>
      {/* Disposition Radio Buttons */}
      <div className="mb-2">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
          Disposition
        </label>
        <div className="flex flex-wrap gap-3">
          {dispositionOptions.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 cursor-pointer text-sm"
            >
              <input
                type="radio"
                name={`disposition-${gateId}-${findingIndex}`}
                value={opt.value}
                checked={disposition === opt.value}
                onChange={() => setDisposition(opt.value)}
                className="sr-only"
              />
              <span
                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  disposition === opt.value
                    ? 'border-cyan-400 bg-cyan-400'
                    : 'border-gray-500 bg-transparent'
                }`}
              >
                {disposition === opt.value && (
                  <span className="w-1.5 h-1.5 rounded-full bg-navy-900" />
                )}
              </span>
              <span
                className={`${
                  disposition === opt.value ? 'text-cyan-300' : 'text-gray-400'
                }`}
              >
                {opt.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Mitigation Textarea */}
      <div className="mb-2">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
          Mitigation / Comment
        </label>
        <textarea
          value={mitigation}
          onChange={(e) => setMitigation(e.target.value)}
          placeholder="Describe mitigating controls or remediation plan..."
          rows={2}
          className="w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 resize-none"
        />
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-2">
        {finding.mitigatedAt && (
          <span className="text-xs text-gray-500">
            Last saved {new Date(finding.mitigatedAt).toLocaleString()}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={!disposition}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            !disposition
              ? 'bg-navy-700 text-gray-500 cursor-not-allowed'
              : saved
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/40'
          }`}
        >
          {saved ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Saved
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              Save
            </>
          )}
        </button>
      </div>
    </div>
  );
}

interface AdminOverrideProps {
  gate: SecurityGate;
  onOverride: (gateId: number, status: 'passed' | 'skipped', reason: string) => void;
}

function AdminOverride({ gate, onOverride }: AdminOverrideProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');

  const handleOverride = (status: 'passed' | 'skipped') => {
    if (reason.trim().length < 3) return;
    onOverride(gate.id, status, reason.trim());
    setReason('');
    setExpanded(false);
  };

  return (
    <div className="mt-4 pt-4 border-t border-navy-600/50" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-amber-400 transition-colors"
      >
        <Shield className="w-3.5 h-3.5" />
        Admin Override
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 animate-fade-in">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Override reason (required, min 3 characters)..."
            className="w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleOverride('passed')}
              disabled={reason.trim().length < 3}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                reason.trim().length < 3
                  ? 'bg-navy-700 text-gray-500 cursor-not-allowed'
                  : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/40'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mark as Passed
            </button>
            <button
              onClick={() => handleOverride('skipped')}
              disabled={reason.trim().length < 3}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                reason.trim().length < 3
                  ? 'bg-navy-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 border border-gray-500/40'
              }`}
            >
              <SkipForward className="w-3.5 h-3.5" />
              Skip Gate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GateCard({ gate, onAcknowledge, onUpdateFinding, onOverrideGate, isAdmin, username = 'operator' }: GateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[gate.status];
  const StatusIcon = config.icon;

  const hasDetails =
    gate.findings.length > 0 ||
    gate.summary ||
    !gate.implemented ||
    gate.reportUrl;

  // Count reviewed findings (those with a disposition set)
  const reviewedCount = gate.findings.filter((f) => f.disposition).length;
  const totalFindings = gate.findings.length;

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
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-navy-700 text-xs font-mono text-gray-400 flex-shrink-0">
              {gate.shortName}
            </span>
            <span className="text-sm font-medium text-gray-200 truncate">
              {gate.name}
            </span>
            {/* Review Badge */}
            {totalFindings > 0 && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono ${
                  reviewedCount === totalFindings
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : reviewedCount > 0
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-navy-700 text-gray-500 border border-navy-600'
                }`}
              >
                {reviewedCount}/{totalFindings} reviewed
              </span>
            )}
          </div>
          {gate.status === 'running' && (
            <>
              <p className="text-xs text-cyan-400/70 mt-1 font-mono animate-pulse">
                {gate.summary || gate.description?.split('. Runs')[0] || 'Processing...'}
              </p>
              <div className="mt-2 progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${gate.progress}%` }}
                />
              </div>
            </>
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
                  className={`bg-navy-900/50 rounded-lg p-3 border-l-4 ${
                    finding.disposition
                      ? 'border-l-emerald-500/60'
                      : 'border-l-amber-500/60'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Badge variant={severityColors[finding.severity]}>
                      {finding.severity.toUpperCase()}
                    </Badge>
                    <div className="min-w-0 flex-1">
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
                    {finding.disposition && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    )}
                  </div>

                  {/* Inline Comment Form */}
                  {onUpdateFinding && (
                    <FindingCommentForm
                      finding={finding}
                      gateId={gate.id}
                      findingIndex={i}
                      onSave={onUpdateFinding}
                      username={username}
                    />
                  )}
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

          {/* Admin Override */}
          {isAdmin && onOverrideGate && gate.status !== 'passed' && (
            <AdminOverride gate={gate} onOverride={onOverrideGate} />
          )}
        </div>
      )}
    </div>
  );
}
