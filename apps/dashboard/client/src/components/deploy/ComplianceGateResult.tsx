import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ComplianceBlocker {
  check: string;
  severity: string;
  message: string;
}

interface ComplianceCheck {
  check: string;
  status: string;
  message: string;
}

interface ComplianceGateResponse {
  blockers: ComplianceBlocker[];
  warnings: ComplianceCheck[];
  checks: ComplianceCheck[];
  error: string;
}

interface ComplianceGateResultProps {
  result: ComplianceGateResponse;
  onDismiss: () => void;
}

const REMEDIATION: Record<string, string> = {
  'image-scan': 'Update your base image or mitigate CVEs in Harbor. Run a Trivy scan locally: `trivy image <your-image>` to see the full list.',
  'image_scan': 'Update your base image or mitigate CVEs in Harbor. Run a Trivy scan locally: `trivy image <your-image>` to see the full list.',
  'network_policies': 'Contact the platform admin. The namespace needs to be onboarded: `./scripts/onboard-tenant.sh <team-name>`',
  'network-policies': 'Contact the platform admin. The namespace needs to be onboarded: `./scripts/onboard-tenant.sh <team-name>`',
  'istio_injection': 'The namespace needs the Istio injection label: `kubectl label namespace <team> istio-injection=enabled`',
  'istio-injection': 'The namespace needs the Istio injection label: `kubectl label namespace <team> istio-injection=enabled`',
  'resource_quota': 'Contact the platform admin to set up resource quotas for your namespace.',
  'resource-quota': 'Contact the platform admin to set up resource quotas for your namespace.',
  'image-signed': 'Sign your image with Cosign after pushing to Harbor: `cosign sign --key cosign.key <image>`',
  'image_signed': 'Sign your image with Cosign after pushing to Harbor: `cosign sign --key cosign.key <image>`',
};

function getRemediation(check: string): string {
  return REMEDIATION[check] || REMEDIATION[check.replace(/-/g, '_')] || 'Contact your platform admin for assistance.';
}

export function ComplianceGateResult({ result, onDismiss }: ComplianceGateResultProps) {
  const [expandedBlockers, setExpandedBlockers] = useState<Set<number>>(new Set([0]));

  const toggleBlocker = (idx: number) => {
    setExpandedBlockers((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const hasBlockers = result.blockers && result.blockers.length > 0;
  const hasWarnings = result.warnings && result.warnings.length > 0;
  const passes = (result.checks || []).filter((c) => c.status === 'pass');

  return (
    <div className="bg-card border border-red/40 rounded-[var(--radius)] p-5 mb-4 relative">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-red flex items-center gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          Deploy Blocked — Compliance Gate Failed
        </h3>
        <button
          onClick={onDismiss}
          className="text-text-dim hover:text-text-primary ml-2 flex-shrink-0"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>

      {/* Blockers */}
      {hasBlockers && (
        <div className="mb-4">
          <p className="text-xs font-mono uppercase tracking-wider text-red mb-2">
            Blockers ({result.blockers.length})
          </p>
          <div className="space-y-2">
            {result.blockers.map((b, idx) => (
              <div key={idx} className="border border-red/25 rounded-[var(--radius)] bg-red/5 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-red/10 transition-colors"
                  onClick={() => toggleBlocker(idx)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0" />
                    <span className="text-xs font-mono text-red truncate">{b.check}</span>
                    <span className="text-xs text-text-dim truncate">{b.message}</span>
                  </div>
                  {expandedBlockers.has(idx)
                    ? <ChevronDown className="w-3.5 h-3.5 text-text-dim flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-text-dim flex-shrink-0" />
                  }
                </button>
                {expandedBlockers.has(idx) && (
                  <div className="px-3 pb-3 pt-1 border-t border-red/15">
                    <p className="text-xs text-text-dim font-semibold mb-1">How to fix:</p>
                    <p className="text-xs text-text-primary font-mono bg-bg rounded px-2 py-1.5 leading-relaxed">
                      {getRemediation(b.check)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="mb-4">
          <p className="text-xs font-mono uppercase tracking-wider text-yellow mb-2">
            Warnings ({result.warnings.length})
          </p>
          <div className="space-y-1.5">
            {result.warnings.map((w, idx) => (
              <div key={idx} className="flex items-start gap-2 px-3 py-2 border border-yellow/20 rounded-[var(--radius)] bg-yellow/5">
                <AlertCircle className="w-3.5 h-3.5 text-yellow flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="text-xs font-mono text-yellow">{w.check}</span>
                  <span className="text-xs text-text-dim ml-2">{w.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Passes */}
      {passes.length > 0 && (
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
            Passed ({passes.length})
          </p>
          <div className="space-y-1">
            {passes.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <CheckCircle className="w-3.5 h-3.5 text-green flex-shrink-0" />
                <span className="font-mono text-text-dim">{c.check}</span>
                <span className="text-text-muted">{c.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
