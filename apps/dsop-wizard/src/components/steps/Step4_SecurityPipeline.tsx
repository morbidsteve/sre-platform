import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert, FileCheck, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';
import { PipelineProgress } from '../pipeline/PipelineProgress';
import { GateCard } from '../pipeline/GateCard';
import type { SecurityGate, GateFinding, PipelineRunStatus } from '../../types';

interface Step4Props {
  gates: SecurityGate[];
  isPipelineRunning: boolean;
  onUpdateGate: (gateId: number, updates: Partial<SecurityGate>) => void;
  onUpdateFinding: (gateId: number, findingIndex: number, updates: Partial<GateFinding>) => void;
  onOverrideGate?: (gateId: number, status: 'passed' | 'skipped', reason: string) => void;
  isAdmin?: boolean;
  username: string;
  onBack: () => void;
  onNext: () => void;
  pipelineRunId?: string | null;
  pipelineRunStatus?: PipelineRunStatus | null;
  onSubmitForReview?: () => void;
  onRetryPipeline?: () => Promise<void>;
}

export function Step4_SecurityPipeline({
  gates,
  isPipelineRunning,
  onUpdateGate,
  onUpdateFinding,
  onOverrideGate,
  isAdmin,
  username,
  onBack,
  onNext,
  pipelineRunId,
  pipelineRunStatus,
  onSubmitForReview,
  onRetryPipeline,
}: Step4Props) {
  const [submittingReview, setSubmittingReview] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Automated gates = everything except ISSM_REVIEW and IMAGE_SIGNING
  const automatedGates = gates.filter(
    (g) => g.shortName !== 'ISSM REVIEW' && g.shortName !== 'ISSM_REVIEW' &&
           g.shortName !== 'IMAGE SIGNING' && g.shortName !== 'IMAGE_SIGNING'
  );

  const automatedDone = automatedGates.every(
    (g) => g.status !== 'pending' && g.status !== 'running'
  );
  const automatedPassed = automatedGates.every(
    (g) => g.status === 'passed' || g.status === 'warning' || g.status === 'skipped'
  );
  const hasCriticalFailure = automatedGates.some((g) => g.status === 'failed');

  const isReviewPending = pipelineRunStatus === 'review_pending';
  const isApproved = pipelineRunStatus === 'approved';

  const canSubmitForReview =
    pipelineRunId &&
    onSubmitForReview &&
    automatedDone &&
    automatedPassed &&
    !hasCriticalFailure &&
    !isReviewPending &&
    !isApproved;

  // User can proceed to next step once automated gates are done and no critical failures
  const canProceed = automatedDone && !hasCriticalFailure;

  const handleSubmitForReview = async () => {
    if (!onSubmitForReview) return;
    setSubmittingReview(true);
    try {
      await onSubmitForReview();
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleAcknowledge = (gateId: number) => {
    const gate = gates.find((g) => g.id === gateId);
    if (gate) {
      onUpdateGate(gateId, { manualAck: !gate.manualAck });
    }
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Progress Header */}
      <PipelineProgress gates={gates} />

      {/* Gate Cards — expand inline, no modal */}
      <div className="space-y-3">
        {gates.map((gate) => (
          <GateCard
            key={gate.id}
            gate={gate}
            onAcknowledge={handleAcknowledge}
            onUpdateFinding={onUpdateFinding}
            onOverrideGate={onOverrideGate}
            isAdmin={isAdmin}
            username={username}
          />
        ))}
      </div>

      {/* Status Messages */}
      {hasCriticalFailure && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center space-y-3">
          <p className="text-sm text-red-400">
            One or more security gates failed. Please resolve the issues before
            deploying.
          </p>
          {onRetryPipeline && pipelineRunId && (
            <Button
              variant="secondary"
              onClick={async () => {
                setRetrying(true);
                try { await onRetryPipeline(); } finally { setRetrying(false); }
              }}
              disabled={retrying}
              icon={retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            >
              {retrying ? 'Restarting...' : 'Restart Pipeline'}
            </Button>
          )}
        </div>
      )}

      {/* ISSM Review Submission */}
      {automatedDone && !hasCriticalFailure && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <FileCheck className="w-4 h-4" />
            ISSM Review
          </h3>
          {isApproved ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <ShieldAlert className="w-5 h-5 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">
                Approved by ISSM — ready to deploy
              </span>
            </div>
          ) : isReviewPending ? (
            <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-4 py-3">
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              <span className="text-sm text-cyan-400">
                Submitted for ISSM review — awaiting decision...
              </span>
            </div>
          ) : canSubmitForReview ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-300">
                All automated security gates have completed. Submit this pipeline run for ISSM review to proceed with deployment.
              </p>
              <Button
                onClick={handleSubmitForReview}
                disabled={submittingReview}
                icon={submittingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
              >
                {submittingReview ? 'Submitting...' : 'Submit for ISSM Review'}
              </Button>
            </div>
          ) : !pipelineRunId ? (
            <p className="text-sm text-gray-400">
              Complete the automated security gates above, then submit for ISSM review.
            </p>
          ) : null}
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
          disabled={!canProceed || isPipelineRunning}
          icon={<ArrowRight className="w-4 h-4" />}
          size="lg"
        >
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
