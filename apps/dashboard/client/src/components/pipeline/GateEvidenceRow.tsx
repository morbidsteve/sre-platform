import React, { useState, useEffect } from 'react';
import { Badge } from '../ui/Badge';
import { fetchGateOutput } from '../../api/pipeline';
import type { PipelineGate, PipelineFinding, GateOutputResponse } from '../../types/api';

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

function severityTextClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === 'critical') return 'text-red font-bold';
  if (s === 'high') return 'text-red';
  if (s === 'medium' || s === 'warning') return 'text-yellow';
  if (s === 'low') return 'text-accent';
  if (s === 'error') return 'text-red font-bold';
  return 'text-text-dim';
}

/* ---------- Formatted tool output renderers ---------- */

function SastResults({ toolOutput }: { toolOutput: Record<string, unknown> }) {
  const results = toolOutput.results as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(results)) return null;
  if (results.length === 0) return <p className="text-xs text-green">Semgrep: 0 findings</p>;
  return (
    <div>
      <p className="text-xs text-text-dim mb-1.5">Semgrep: {results.length} result(s)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-dim border-b border-border">
              <th className="text-left px-2 py-1">Severity</th>
              <th className="text-left px-2 py-1">Rule</th>
              <th className="text-left px-2 py-1">File</th>
              <th className="text-left px-2 py-1">Line</th>
              <th className="text-left px-2 py-1">Message</th>
            </tr>
          </thead>
          <tbody>
            {results.slice(0, 50).map((r, i) => {
              const extra = r.extra as Record<string, unknown> | undefined;
              const start = r.start as Record<string, number> | undefined;
              return (
                <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
                  <td className="px-2 py-1">
                    <span className={`text-[10px] font-semibold uppercase ${severityTextClass(String(extra?.severity || 'info'))}`}>
                      {String(extra?.severity || 'info')}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono text-accent max-w-[140px] truncate">{String(r.check_id || '--')}</td>
                  <td className="px-2 py-1 font-mono text-text-dim max-w-[120px] truncate">{String(r.path || '--')}</td>
                  <td className="px-2 py-1 font-mono text-text-dim">{start?.line || '--'}</td>
                  <td className="px-2 py-1 text-text-dim max-w-[200px] truncate">{String(extra?.message || '').substring(0, 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {results.length > 50 && <p className="text-[10px] text-text-dim mt-1">Showing 50 of {results.length}</p>}
      </div>
    </div>
  );
}

function SecretsResults({ toolOutput }: { toolOutput: unknown[] }) {
  if (toolOutput.length === 0) return <p className="text-xs text-green">Gitleaks: 0 secrets detected</p>;
  const items = toolOutput as Array<Record<string, unknown>>;
  return (
    <div>
      <p className="text-xs text-red mb-1.5">Gitleaks: {items.length} secret(s) detected</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-dim border-b border-border">
              <th className="text-left px-2 py-1">Rule</th>
              <th className="text-left px-2 py-1">File</th>
              <th className="text-left px-2 py-1">Line</th>
              <th className="text-left px-2 py-1">Match (redacted)</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 50).map((s, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
                <td className="px-2 py-1 font-mono text-red">{String(s.RuleID || s.Description || '--')}</td>
                <td className="px-2 py-1 font-mono text-text-dim max-w-[150px] truncate">{String(s.File || '--')}</td>
                <td className="px-2 py-1 font-mono text-text-dim">{String(s.StartLine || '--')}</td>
                <td className="px-2 py-1 font-mono text-text-dim max-w-[120px] truncate">
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

function CveResults({ toolOutput }: { toolOutput: Record<string, unknown> }) {
  const results = toolOutput.Results as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(results)) return null;
  const allVulns: Array<{ cve: string; pkg: string; severity: string; fixedVersion: string; title: string }> = [];
  results.forEach((r) => {
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
  if (allVulns.length === 0) return <p className="text-xs text-green">Trivy: 0 vulnerabilities across {results.length} target(s)</p>;
  return (
    <div>
      <p className="text-xs text-text-dim mb-1.5">Trivy: {allVulns.length} vulnerabilities across {results.length} target(s)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-dim border-b border-border">
              <th className="text-left px-2 py-1">CVE ID</th>
              <th className="text-left px-2 py-1">Severity</th>
              <th className="text-left px-2 py-1">Package</th>
              <th className="text-left px-2 py-1">Fixed In</th>
              <th className="text-left px-2 py-1">Title</th>
            </tr>
          </thead>
          <tbody>
            {allVulns.slice(0, 50).map((v, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
                <td className="px-2 py-1 font-mono text-accent">{v.cve}</td>
                <td className="px-2 py-1">
                  <span className={`text-[10px] font-semibold uppercase ${severityTextClass(v.severity)}`}>{v.severity}</span>
                </td>
                <td className="px-2 py-1 font-mono text-text-dim">{v.pkg}</td>
                <td className="px-2 py-1 font-mono text-text-dim">{v.fixedVersion}</td>
                <td className="px-2 py-1 text-text-dim max-w-[180px] truncate">{v.title.substring(0, 80)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {allVulns.length > 50 && <p className="text-[10px] text-text-dim mt-1">Showing 50 of {allVulns.length}</p>}
      </div>
    </div>
  );
}

function SbomResults({ toolOutput }: { toolOutput: Record<string, unknown> }) {
  const pkgs = toolOutput.packages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(pkgs)) return null;
  // Summarize licenses
  const licenseCounts: Record<string, number> = {};
  pkgs.forEach((p) => {
    const lic = String(p.licenseConcluded || p.licenseDeclared || 'Unknown');
    licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;
  });
  const topLicenses = Object.entries(licenseCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div>
      <p className="text-xs text-text-dim mb-1.5">SBOM (SPDX): {pkgs.length} packages</p>
      {topLicenses.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {topLicenses.map(([lic, count]) => (
            <span key={lic} className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-dim border border-border">
              {lic} ({count})
            </span>
          ))}
        </div>
      )}
      {pkgs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-dim border-b border-border">
                <th className="text-left px-2 py-1">Package</th>
                <th className="text-left px-2 py-1">Version</th>
                <th className="text-left px-2 py-1">License</th>
              </tr>
            </thead>
            <tbody>
              {pkgs.slice(0, 20).map((p, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
                  <td className="px-2 py-1 font-mono text-text-primary">{String(p.name || '--')}</td>
                  <td className="px-2 py-1 font-mono text-text-dim">{String(p.versionInfo || '--')}</td>
                  <td className="px-2 py-1 text-text-dim">{String(p.licenseConcluded || p.licenseDeclared || '--')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pkgs.length > 20 && <p className="text-[10px] text-text-dim mt-1">Showing 20 of {pkgs.length}</p>}
        </div>
      )}
    </div>
  );
}

function DastResults({ toolOutput }: { toolOutput: Record<string, unknown> }) {
  const alerts = (toolOutput.site as Array<Record<string, unknown>> | undefined)?.[0];
  const allAlerts: Array<Record<string, unknown>> = [];
  if (alerts && Array.isArray(alerts.alerts)) {
    allAlerts.push(...(alerts.alerts as Array<Record<string, unknown>>));
  } else if (Array.isArray(toolOutput.alerts)) {
    allAlerts.push(...(toolOutput.alerts as Array<Record<string, unknown>>));
  }
  if (allAlerts.length === 0) return <p className="text-xs text-green">ZAP: 0 alerts</p>;
  return (
    <div>
      <p className="text-xs text-text-dim mb-1.5">ZAP: {allAlerts.length} alert(s)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-dim border-b border-border">
              <th className="text-left px-2 py-1">Risk</th>
              <th className="text-left px-2 py-1">Confidence</th>
              <th className="text-left px-2 py-1">Name</th>
              <th className="text-left px-2 py-1">URL</th>
            </tr>
          </thead>
          <tbody>
            {allAlerts.slice(0, 30).map((a, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface/50">
                <td className="px-2 py-1">
                  <span className={`text-[10px] font-semibold uppercase ${severityTextClass(String(a.riskdesc || a.risk || ''))}`}>
                    {String(a.riskdesc || a.risk || '--')}
                  </span>
                </td>
                <td className="px-2 py-1 text-text-dim">{String(a.confidence || '--')}</td>
                <td className="px-2 py-1 text-text-primary max-w-[180px] truncate">{String(a.name || a.alert || '--')}</td>
                <td className="px-2 py-1 font-mono text-text-dim max-w-[150px] truncate">{String(a.url || '--')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BuildResults({ toolOutput }: { toolOutput: unknown }) {
  const output = toolOutput as Record<string, unknown> | string;
  const logs = typeof output === 'string' ? output : String((output as Record<string, unknown>)?.logs || (output as Record<string, unknown>)?.output || '');
  const lines = logs.split('\n').filter(Boolean);
  const lastLines = lines.slice(-15);
  if (lastLines.length === 0) return <p className="text-xs text-text-dim">No build log available</p>;
  return (
    <div>
      <p className="text-xs text-text-dim mb-1.5">Build log (last {lastLines.length} lines)</p>
      <pre className="bg-bg border border-border rounded p-2 text-[10px] font-mono text-text-dim max-h-[200px] overflow-auto whitespace-pre-wrap">
        {lastLines.join('\n')}
      </pre>
    </div>
  );
}

function SigningResults({ toolOutput }: { toolOutput: unknown }) {
  const data = toolOutput as Record<string, unknown>;
  const verified = data?.verified === true || data?.signatures !== undefined;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-2 h-2 rounded-full ${verified ? 'bg-green' : 'bg-red'}`} />
      <span className={`text-xs font-semibold ${verified ? 'text-green' : 'text-red'}`}>
        {verified ? 'Signature Verified' : 'Signature Not Verified'}
      </span>
      {data?.keyId ? <span className="text-[10px] font-mono text-text-dim">Key: {String(data.keyId).substring(0, 16)}</span> : null}
      {data?.timestamp ? <span className="text-[10px] text-text-dim">{new Date(String(data.timestamp)).toLocaleString()}</span> : null}
    </div>
  );
}

function ISSMResults({ gate }: { gate: PipelineGate }) {
  return (
    <div className="text-xs text-text-dim">
      {gate.summary || 'Awaiting ISSM review decision'}
    </div>
  );
}

/** Render formatted tool output based on gate type */
function FormattedToolOutput({ shortName, rawOutput }: { shortName: string; rawOutput: GateOutputResponse['rawOutput'] }) {
  if (!rawOutput) return null;
  const toolOutput = rawOutput.toolOutput;
  const sn = (shortName || '').toUpperCase().replace(/\s+/g, '_');

  if (sn === 'SAST' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    return <SastResults toolOutput={toolOutput as Record<string, unknown>} />;
  }
  if (sn === 'SECRETS' && Array.isArray(toolOutput)) {
    return <SecretsResults toolOutput={toolOutput} />;
  }
  if (sn === 'CVE' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    return <CveResults toolOutput={toolOutput as Record<string, unknown>} />;
  }
  if (sn === 'SBOM' && toolOutput && typeof toolOutput === 'object' && !Array.isArray(toolOutput)) {
    return <SbomResults toolOutput={toolOutput as Record<string, unknown>} />;
  }
  if (sn === 'DAST' && toolOutput && typeof toolOutput === 'object') {
    return <DastResults toolOutput={toolOutput as Record<string, unknown>} />;
  }
  if ((sn === 'BUILD' || sn === 'CONTAINER_BUILD') && toolOutput) {
    return <BuildResults toolOutput={toolOutput} />;
  }
  if ((sn === 'IMAGE_SIGNING' || sn === 'IMAGE SIGNING') && toolOutput) {
    return <SigningResults toolOutput={toolOutput} />;
  }
  // Fallback: show summary from raw output
  if (rawOutput.summary) {
    return <p className="text-xs text-text-dim">{rawOutput.summary}</p>;
  }
  return null;
}

/* ---------- NIST 800-53 Control Mapping ---------- */

/** Maps gate short names to the NIST 800-53 controls they satisfy */
const GATE_NIST_CONTROLS: Record<string, { controls: string[]; family: string }> = {
  SAST:          { controls: ['SA-11', 'SI-10'], family: 'System & Info Integrity' },
  SECRETS:       { controls: ['IA-5', 'SC-28'],  family: 'Identification & Auth' },
  CVE:           { controls: ['RA-5', 'SI-2'],   family: 'Risk Assessment' },
  DAST:          { controls: ['SA-11', 'SC-7'],   family: 'System & Comms Protection' },
  IMAGE_SIGNING: { controls: ['SI-7', 'SA-10'],  family: 'System & Info Integrity' },
  SBOM:          { controls: ['CM-8', 'SA-11'],  family: 'Configuration Mgmt' },
  CONTAINER_BUILD: { controls: ['SA-10', 'CM-2'], family: 'Config & Acquisition' },
  BUILD:         { controls: ['SA-10', 'CM-2'],  family: 'Config & Acquisition' },
  ISSM_REVIEW:   { controls: ['CA-7', 'CA-2'],   family: 'Assessment & Authorization' },
};

function NistControlBadges({ shortName }: { shortName: string }) {
  const sn = (shortName || '').toUpperCase().replace(/\s+/g, '_');
  const mapping = GATE_NIST_CONTROLS[sn];
  if (!mapping) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {mapping.controls.map((ctrl) => (
        <span
          key={ctrl}
          className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20"
          title={`NIST 800-53: ${ctrl} (${mapping.family})`}
        >
          {ctrl}
        </span>
      ))}
    </div>
  );
}

/* ---------- Main components ---------- */

interface GateEvidenceRowProps {
  gate: PipelineGate;
  isReview?: boolean;
  runId?: string;
  defaultExpanded?: boolean;
  onDispositionChange?: (findingId: number, disposition: string, mitigation: string) => void;
}

export function GateEvidenceRow({ gate, isReview = false, runId, defaultExpanded = false, onDispositionChange }: GateEvidenceRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [rawOutput, setRawOutput] = useState<GateOutputResponse['rawOutput'] | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const findings = gate.findings || [];

  // Auto-load raw output when expanded and we have a runId
  useEffect(() => {
    if (!expanded || !runId || rawOutput !== null || rawLoading) return;
    if (gate.status === 'pending' || gate.status === 'running') return;
    setRawLoading(true);
    fetchGateOutput(runId, gate.gate_id)
      .then((data) => setRawOutput(data.rawOutput))
      .catch(() => setRawOutput(null))
      .finally(() => setRawLoading(false));
  }, [expanded, runId, gate.gate_id, gate.status, rawOutput, rawLoading]);

  const sn = (gate.short_name || '').toUpperCase().replace(/\s+/g, '_');
  const isISSM = sn === 'ISSM_REVIEW' || sn === 'ISSM REVIEW';
  const hasContent = findings.length > 0 || gate.summary || gate.status !== 'pending';

  return (
    <div className={`border rounded-lg mb-2 overflow-hidden ${
      gate.status === 'failed' ? 'border-red/30' :
      gate.status === 'warning' ? 'border-yellow/30' :
      gate.status === 'passed' ? 'border-green/20' :
      'border-border'
    }`}>
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
          <NistControlBadges shortName={gate.short_name} />
        </div>
        <div className="flex items-center gap-3">
          {/* Inline summary for quick scanning */}
          {gate.summary && !expanded && (
            <span className="text-[11px] text-text-dim max-w-[250px] truncate hidden sm:inline">
              {gate.summary}
            </span>
          )}
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
        <div className="border-t border-border p-3 space-y-3">
          {/* Gate summary */}
          {gate.summary && (
            <div className="text-xs text-text-dim">{gate.summary}</div>
          )}

          {/* Formatted tool output (pretty-printed results, loaded from API) */}
          {isISSM ? (
            <ISSMResults gate={gate} />
          ) : rawLoading ? (
            <div className="text-[11px] text-text-dim py-1">Loading scan output...</div>
          ) : rawOutput ? (
            <FormattedToolOutput shortName={gate.short_name} rawOutput={rawOutput} />
          ) : gate.status === 'passed' && findings.length === 0 ? (
            <div className="text-xs text-green py-1">Clean scan -- no issues found.</div>
          ) : null}

          {/* Findings (from pipeline DB) */}
          {findings.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-text-dim uppercase tracking-wide mb-1.5">
                Findings ({findings.length})
              </div>
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
            </div>
          )}

          {/* No findings, no raw output */}
          {!hasContent && (
            <div className="text-xs text-text-dim py-2">No data for this gate.</div>
          )}

          {/* Raw JSON collapsible (for technical users) */}
          {rawOutput && (
            <div className="pt-2 border-t border-border/50">
              <button
                className="text-[10px] text-text-dim hover:text-accent transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowRawJson(!showRawJson); }}
              >
                {showRawJson ? 'Hide' : 'Show'} Raw Output
              </button>
              {showRawJson && (
                <pre className="mt-1.5 bg-bg border border-border rounded p-2 text-[10px] font-mono text-text-dim max-h-[300px] overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(rawOutput, null, 2)}
                </pre>
              )}
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
