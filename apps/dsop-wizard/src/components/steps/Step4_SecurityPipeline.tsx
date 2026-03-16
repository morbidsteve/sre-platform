import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert, MapPin, Wrench } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { PipelineProgress } from '../pipeline/PipelineProgress';
import { GateCard } from '../pipeline/GateCard';
import type { SecurityGate, GateFinding } from '../../types';

interface Step4Props {
  gates: SecurityGate[];
  isPipelineRunning: boolean;
  onUpdateGate: (gateId: number, updates: Partial<SecurityGate>) => void;
  onUpdateFinding: (gateId: number, findingIndex: number, updates: Partial<GateFinding>) => void;
  username: string;
  onBack: () => void;
  onNext: () => void;
}

const severityColors = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
} as const;

const remediationGuidance: Record<string, string> = {
  SAST: 'Review flagged code patterns and apply secure coding practices. Use parameterized queries for SQL, escape user input, and avoid unsafe deserialization.',
  SBOM: 'Ensure all dependencies are declared. Remove unused packages. Verify component licenses are compatible with your deployment classification.',
  SECRETS: 'Rotate any detected credentials immediately. Use environment variables or a secrets manager (OpenBao/Vault) instead of hardcoded values. Add a .gitignore for sensitive files.',
  'CVE SCAN': 'Update affected packages to patched versions. If no patch is available, evaluate risk and apply compensating controls. Document accepted risks for ATO.',
  DAST: 'Fix identified vulnerabilities in the running application. Common issues: XSS (sanitize output), CSRF (add tokens), insecure headers (add CSP, HSTS).',
  'ISSM REVIEW': 'Submit scan results to your ISSM for review. Provide remediation plans for any open findings. Await formal approval before production deployment.',
  'IMAGE SIGNING': 'Sign container images with Cosign using your organization key. Ensure Kyverno admission policies verify signatures before allowing deployment.',
  'ARTIFACT STORE': 'Verify images are stored in Harbor with vulnerability scan results attached. Confirm replication policies are active for DR.',
};

export function Step4_SecurityPipeline({
  gates,
  isPipelineRunning,
  onUpdateGate,
  onUpdateFinding,
  username,
  onBack,
  onNext,
}: Step4Props) {
  const [selectedGate, setSelectedGate] = useState<SecurityGate | null>(null);

  const allDone = gates.every(
    (g) => g.status !== 'pending' && g.status !== 'running'
  );
  const hasCriticalFailure = gates.some((g) => g.status === 'failed');

  // Check if unimplemented skipped gates have been acknowledged
  const skippedGates = gates.filter(
    (g) => !g.implemented && g.status === 'skipped'
  );
  const allAcknowledged =
    skippedGates.length === 0 ||
    skippedGates.every((g) => g.manualAck);

  const canProceed = allDone && !hasCriticalFailure;

  const handleAcknowledge = (gateId: number) => {
    const gate = gates.find((g) => g.id === gateId);
    if (gate) {
      onUpdateGate(gateId, { manualAck: !gate.manualAck });
    }
  };

  const handleGateClick = (gate: SecurityGate) => {
    // Only show modal for gates that have completed (not pending/running)
    if (gate.status !== 'pending' && gate.status !== 'running') {
      setSelectedGate(gate);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Progress Header */}
      <PipelineProgress gates={gates} />

      {/* Gate Cards */}
      <div className="space-y-3">
        {gates.map((gate) => (
          <div
            key={gate.id}
            onClick={() => handleGateClick(gate)}
            className={gate.status !== 'pending' && gate.status !== 'running' ? 'cursor-pointer' : ''}
          >
            <GateCard
              gate={gate}
              onAcknowledge={handleAcknowledge}
              onUpdateFinding={onUpdateFinding}
              username={username}
            />
          </div>
        ))}
      </div>

      {/* Gate Detail Modal */}
      <Modal
        open={selectedGate !== null}
        onClose={() => setSelectedGate(null)}
        title={selectedGate ? `Gate ${selectedGate.id}: ${selectedGate.name}` : ''}
      >
        {selectedGate && (
          <div className="space-y-5">
            {/* Gate Description */}
            <div>
              <p className="text-sm text-gray-300">{selectedGate.description}</p>
              {selectedGate.summary && (
                <p className="text-sm font-mono text-cyan-400 mt-2">
                  {selectedGate.summary}
                </p>
              )}
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 uppercase tracking-wider">Status:</span>
              <Badge
                variant={
                  selectedGate.status === 'passed'
                    ? 'success'
                    : selectedGate.status === 'failed'
                    ? 'danger'
                    : selectedGate.status === 'warning'
                    ? 'warning'
                    : 'neutral'
                }
              >
                {selectedGate.status.toUpperCase()}
              </Badge>
              {!selectedGate.implemented && (
                <Badge variant="neutral">NOT AUTOMATED</Badge>
              )}
            </div>

            {/* SBOM-specific: component count */}
            {selectedGate.shortName === 'SBOM' && selectedGate.status === 'passed' && (
              <div className="bg-navy-900/50 rounded-lg p-3 border border-navy-600">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">SBOM Details</p>
                <p className="text-sm text-gray-200">Format: SPDX + CycloneDX</p>
                <p className="text-sm text-gray-200">Auto-generated by Harbor (Syft engine)</p>
              </div>
            )}

            {/* Findings */}
            {selectedGate.findings.length > 0 && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4" />
                  Findings ({selectedGate.findings.length})
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedGate.findings.map((finding, i) => (
                    <div
                      key={i}
                      className="bg-navy-900/50 rounded-lg p-3 border border-navy-600"
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant={severityColors[finding.severity]}>
                          {finding.severity.toUpperCase()}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-200 font-medium">
                            {finding.title}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {finding.description}
                          </p>
                          {finding.location && (
                            <p className="flex items-center gap-1 text-xs text-gray-500 font-mono mt-1">
                              <MapPin className="w-3 h-3" />
                              {finding.location}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedGate.findings.length === 0 && selectedGate.status !== 'skipped' && (
              <div className="bg-navy-900/50 rounded-lg p-4 border border-navy-600 text-center">
                <p className="text-sm text-gray-400">No findings detected.</p>
              </div>
            )}

            {/* Remediation Guidance */}
            {remediationGuidance[selectedGate.shortName] && (
              <div className="bg-navy-900/50 rounded-lg p-3 border border-navy-600">
                <h4 className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  <Wrench className="w-4 h-4" />
                  Remediation Guidance
                </h4>
                <p className="text-sm text-gray-300">
                  {remediationGuidance[selectedGate.shortName]}
                </p>
              </div>
            )}

            {/* Report Link */}
            {selectedGate.reportUrl && (
              <a
                href={selectedGate.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
              >
                View Full Report
              </a>
            )}
          </div>
        )}
      </Modal>

      {/* Status Message */}
      {allDone && !hasCriticalFailure && !allAcknowledged && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-amber-400">
            Please acknowledge all manual verification gates before proceeding.
          </p>
        </div>
      )}

      {hasCriticalFailure && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">
            One or more security gates failed. Please resolve the issues before
            deploying.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={isPipelineRunning}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed || isPipelineRunning || !allAcknowledged}
          icon={<ArrowRight className="w-4 h-4" />}
          size="lg"
        >
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
