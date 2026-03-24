import React, { useState, useEffect } from 'react';
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
  Code2,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { getGateOutput, type GateOutputResponse } from '../../api';
import type { SecurityGate, GateFinding, FindingDisposition } from '../../types';

interface GateCardProps {
  gate: SecurityGate;
  pipelineRunId?: string | null;
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

/* ---------- Formatted tool output renderers ---------- */

function severityTextClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === 'critical' || s === 'error') return 'text-red-400 font-bold';
  if (s === 'high') return 'text-orange-400';
  if (s === 'medium' || s === 'warning') return 'text-amber-400';
  if (s === 'low') return 'text-cyan-400';
  return 'text-gray-400';
}

function FormattedToolOutput({ shortName, rawOutput }: { shortName: string; rawOutput: GateOutputResponse['rawOutput'] }) {
  if (!rawOutput) return null;
  const toolOutput = rawOutput.toolOutput;
  const sn = (shortName || '').toUpperCase().replace(/\s+/g, '_');

  // SAST / Semgrep
  if (sn === 'SAST' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    const results = (toolOutput as Record<string, unknown>).results;
    if (!Array.isArray(results)) return null;
    if (results.length === 0) return <p className="text-xs text-emerald-400">Semgrep: 0 findings</p>;
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Semgrep: {results.length} result(s)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-navy-700">
                <th className="text-left px-2 py-1">Severity</th>
                <th className="text-left px-2 py-1">Rule</th>
                <th className="text-left px-2 py-1">File</th>
                <th className="text-left px-2 py-1">Line</th>
                <th className="text-left px-2 py-1">Message</th>
              </tr>
            </thead>
            <tbody>
              {(results as Array<Record<string, unknown>>).slice(0, 50).map((r, i) => {
                const extra = r.extra as Record<string, unknown> | undefined;
                const start = r.start as Record<string, number> | undefined;
                return (
                  <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                    <td className="px-2 py-1">
                      <span className={`text-xs font-semibold uppercase ${severityTextClass(String(extra?.severity || 'info'))}`}>
                        {String(extra?.severity || 'info')}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-cyan-400/80 max-w-[140px] truncate">{String(r.check_id || '--')}</td>
                    <td className="px-2 py-1 font-mono text-gray-400 max-w-[120px] truncate">{String(r.path || '--')}</td>
                    <td className="px-2 py-1 font-mono text-gray-400">{start?.line || '--'}</td>
                    <td className="px-2 py-1 text-gray-500 max-w-[200px] truncate">{String(extra?.message || '').substring(0, 100)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {results.length > 50 && <p className="text-xs text-gray-600 mt-1">Showing 50 of {results.length}</p>}
        </div>
      </div>
    );
  }

  // Secrets / Gitleaks
  if (sn === 'SECRETS' && Array.isArray(toolOutput)) {
    if (toolOutput.length === 0) return <p className="text-xs text-emerald-400">Gitleaks: 0 secrets detected</p>;
    const items = toolOutput as Array<Record<string, unknown>>;
    return (
      <div>
        <p className="text-xs text-red-400 mb-1.5">Gitleaks: {items.length} secret(s) detected</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-navy-700">
                <th className="text-left px-2 py-1">Rule</th>
                <th className="text-left px-2 py-1">File</th>
                <th className="text-left px-2 py-1">Line</th>
                <th className="text-left px-2 py-1">Match (redacted)</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 50).map((s, i) => (
                <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                  <td className="px-2 py-1 font-mono text-red-400">{String(s.RuleID || s.Description || '--')}</td>
                  <td className="px-2 py-1 font-mono text-gray-400 max-w-[150px] truncate">{String(s.File || '--')}</td>
                  <td className="px-2 py-1 font-mono text-gray-400">{String(s.StartLine || '--')}</td>
                  <td className="px-2 py-1 font-mono text-gray-400 max-w-[120px] truncate">
                    {String(s.Match || '').substring(0, 8)}{'***'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // CVE / Trivy
  if (sn === 'CVE' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    const tResults = (toolOutput as Record<string, unknown>).Results;
    if (!Array.isArray(tResults)) return null;
    const allVulns: Array<{ cve: string; pkg: string; severity: string; fixedVersion: string; title: string }> = [];
    tResults.forEach((r: Record<string, unknown>) => {
      ((r.Vulnerabilities || []) as Array<Record<string, unknown>>).forEach((v) => {
        allVulns.push({
          cve: String(v.VulnerabilityID || '--'),
          pkg: String(v.PkgName || '--'),
          severity: String(v.Severity || 'unknown'),
          fixedVersion: String(v.FixedVersion || '--'),
          title: String(v.Title || ''),
        });
      });
    });
    if (allVulns.length === 0) return <p className="text-xs text-emerald-400">Trivy: 0 vulnerabilities across {tResults.length} target(s)</p>;
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Trivy: {allVulns.length} vulnerabilities across {tResults.length} target(s)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-navy-700">
                <th className="text-left px-2 py-1">CVE ID</th>
                <th className="text-left px-2 py-1">Severity</th>
                <th className="text-left px-2 py-1">Package</th>
                <th className="text-left px-2 py-1">Fixed In</th>
                <th className="text-left px-2 py-1">Title</th>
              </tr>
            </thead>
            <tbody>
              {allVulns.slice(0, 50).map((v, i) => (
                <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                  <td className="px-2 py-1 font-mono text-cyan-400/80">{v.cve}</td>
                  <td className="px-2 py-1">
                    <span className={`text-xs font-semibold uppercase ${severityTextClass(v.severity)}`}>{v.severity}</span>
                  </td>
                  <td className="px-2 py-1 font-mono text-gray-400">{v.pkg}</td>
                  <td className="px-2 py-1 font-mono text-gray-500">{v.fixedVersion}</td>
                  <td className="px-2 py-1 text-gray-500 max-w-[180px] truncate">{v.title.substring(0, 80)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {allVulns.length > 50 && <p className="text-xs text-gray-600 mt-1">Showing 50 of {allVulns.length}</p>}
        </div>
      </div>
    );
  }

  // SBOM / Syft
  if (sn === 'SBOM' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    const pkgs = (toolOutput as Record<string, unknown>).packages;
    if (!Array.isArray(pkgs)) return null;
    const licenseCounts: Record<string, number> = {};
    (pkgs as Array<Record<string, unknown>>).forEach((p) => {
      const lic = String(p.licenseConcluded || p.licenseDeclared || 'Unknown');
      licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;
    });
    const topLicenses = Object.entries(licenseCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1.5">SBOM (SPDX): {pkgs.length} packages</p>
        {topLicenses.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {topLicenses.map(([lic, count]) => (
              <span key={lic} className="text-[10px] px-1.5 py-0.5 rounded bg-navy-700 text-gray-400 border border-navy-600">
                {lic} ({count})
              </span>
            ))}
          </div>
        )}
        {pkgs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-navy-700">
                  <th className="text-left px-2 py-1">Package</th>
                  <th className="text-left px-2 py-1">Version</th>
                  <th className="text-left px-2 py-1">License</th>
                </tr>
              </thead>
              <tbody>
                {(pkgs as Array<Record<string, unknown>>).slice(0, 20).map((p, i) => (
                  <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                    <td className="px-2 py-1 font-mono text-gray-300">{String(p.name || '--')}</td>
                    <td className="px-2 py-1 font-mono text-gray-400">{String(p.versionInfo || '--')}</td>
                    <td className="px-2 py-1 text-gray-500">{String(p.licenseConcluded || p.licenseDeclared || '--')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pkgs.length > 20 && <p className="text-xs text-gray-600 mt-1">Showing 20 of {pkgs.length}</p>}
          </div>
        )}
      </div>
    );
  }

  // DAST / ZAP
  if (sn === 'DAST' && toolOutput && typeof toolOutput === 'object') {
    const to = toolOutput as Record<string, unknown>;
    const allAlerts: Array<Record<string, unknown>> = [];
    const siteArr = to.site as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(siteArr) && siteArr[0] && Array.isArray(siteArr[0].alerts)) {
      allAlerts.push(...(siteArr[0].alerts as Array<Record<string, unknown>>));
    } else if (Array.isArray(to.alerts)) {
      allAlerts.push(...(to.alerts as Array<Record<string, unknown>>));
    }
    if (allAlerts.length === 0) return <p className="text-xs text-emerald-400">ZAP: 0 alerts</p>;
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1.5">ZAP: {allAlerts.length} alert(s)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-navy-700">
                <th className="text-left px-2 py-1">Risk</th>
                <th className="text-left px-2 py-1">Confidence</th>
                <th className="text-left px-2 py-1">Name</th>
                <th className="text-left px-2 py-1">URL</th>
              </tr>
            </thead>
            <tbody>
              {allAlerts.slice(0, 30).map((a, i) => (
                <tr key={i} className="border-b border-navy-800 hover:bg-navy-800/50">
                  <td className="px-2 py-1">
                    <span className={`text-xs font-semibold uppercase ${severityTextClass(String(a.riskdesc || a.risk || ''))}`}>
                      {String(a.riskdesc || a.risk || '--')}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-gray-400">{String(a.confidence || '--')}</td>
                  <td className="px-2 py-1 text-gray-200 max-w-[180px] truncate">{String(a.name || a.alert || '--')}</td>
                  <td className="px-2 py-1 font-mono text-gray-400 max-w-[150px] truncate">{String(a.url || '--')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Build / Kaniko
  if ((sn === 'BUILD' || sn === 'CONTAINER_BUILD') && toolOutput) {
    const output = toolOutput as Record<string, unknown> | string;
    const logs = typeof output === 'string' ? output : String((output as Record<string, unknown>)?.logs || (output as Record<string, unknown>)?.output || '');
    const lines = logs.split('\n').filter(Boolean);
    const lastLines = lines.slice(-15);
    if (lastLines.length === 0) return <p className="text-xs text-gray-500">No build log available</p>;
    return (
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Build log (last {lastLines.length} lines)</p>
        <pre className="bg-navy-950 border border-navy-700 rounded-lg p-2 text-[10px] font-mono text-gray-400 max-h-[200px] overflow-auto whitespace-pre-wrap">
          {lastLines.join('\n')}
        </pre>
      </div>
    );
  }

  // Image Signing / Cosign
  if ((sn === 'IMAGE_SIGNING' || sn === 'IMAGE SIGNING') && toolOutput) {
    const data = toolOutput as Record<string, unknown>;
    const verified = data?.verified === true || data?.signatures !== undefined;
    return (
      <div className="flex items-center gap-2 py-1">
        <span className={`w-2 h-2 rounded-full ${verified ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className={`text-xs font-semibold ${verified ? 'text-emerald-400' : 'text-red-400'}`}>
          {verified ? 'Signature Verified' : 'Signature Not Verified'}
        </span>
        {data?.keyId ? <span className="text-[10px] font-mono text-gray-500">Key: {String(data.keyId).substring(0, 16)}</span> : null}
        {data?.timestamp ? <span className="text-[10px] text-gray-500">{new Date(String(data.timestamp)).toLocaleString()}</span> : null}
      </div>
    );
  }

  // Fallback summary
  if (rawOutput.summary) {
    return <p className="text-xs text-gray-400">{rawOutput.summary}</p>;
  }
  return null;
}

/** Inline scan output loader and display for gate cards */
function GateToolOutput({ pipelineRunId, gate }: { pipelineRunId: string; gate: SecurityGate }) {
  const [rawOutput, setRawOutput] = useState<GateOutputResponse['rawOutput'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  useEffect(() => {
    if (loaded || loading) return;
    if (gate.status === 'pending' || gate.status === 'running') return;
    setLoading(true);
    getGateOutput(pipelineRunId, gate.id)
      .then((data) => setRawOutput(data.rawOutput))
      .catch(() => setRawOutput(null))
      .finally(() => { setLoading(false); setLoaded(true); });
  }, [pipelineRunId, gate.id, gate.status, loaded, loading]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
        <span className="text-xs text-gray-500">Loading scan output...</span>
      </div>
    );
  }

  if (!rawOutput) return null;

  return (
    <div className="space-y-2 mb-3">
      <FormattedToolOutput shortName={gate.shortName} rawOutput={rawOutput} />
      <div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowRawJson(!showRawJson); }}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 transition-colors"
        >
          <Code2 className="w-3.5 h-3.5" />
          {showRawJson ? 'Hide' : 'Show'} raw JSON
        </button>
        {showRawJson && (
          <pre className="mt-1.5 bg-navy-950 border border-navy-700 rounded-lg p-3 text-xs font-mono text-gray-400 max-h-80 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(rawOutput, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function GateCard({ gate, pipelineRunId, onAcknowledge, onUpdateFinding, onOverrideGate, isAdmin, username = 'operator' }: GateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[gate.status];
  const StatusIcon = config.icon;

  const hasDetails =
    gate.findings.length > 0 ||
    gate.summary ||
    !gate.implemented ||
    gate.reportUrl ||
    (pipelineRunId && gate.status !== 'pending' && gate.status !== 'running');

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
          {gate.summary && gate.status === 'failed' && (
            <p className="text-xs text-red-400 mt-1 font-mono font-medium">{gate.summary}</p>
          )}
          {gate.summary && gate.status !== 'running' && gate.status !== 'failed' && (
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

          {/* Formatted tool output (auto-loaded from API) */}
          {pipelineRunId && gate.status !== 'pending' && gate.status !== 'running' && (
            <GateToolOutput pipelineRunId={pipelineRunId} gate={gate} />
          )}

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

          {/* Clean scan notice when no findings and no tool output */}
          {gate.findings.length === 0 && gate.status === 'passed' && !pipelineRunId && (
            <p className="text-xs text-emerald-400 mb-3">Clean scan -- no issues found.</p>
          )}

          {/* Not Implemented Notice */}
          {!gate.implemented && gate.status === 'skipped' && (
            <div className="bg-navy-900/50 rounded-lg p-3 border border-gray-600/30">
              <p className="text-sm text-amber-400 font-medium mb-2">
                Coming Soon -- Manual Verification Required
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
