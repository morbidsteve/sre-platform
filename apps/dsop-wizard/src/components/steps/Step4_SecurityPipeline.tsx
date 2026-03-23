import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert, FileCheck, Loader2, RotateCcw, Rocket, CheckCircle2, XCircle, RotateCw, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { PipelineProgress } from '../pipeline/PipelineProgress';
import { GateCard } from '../pipeline/GateCard';
import type { SecurityGate, GateFinding, PipelineRunStatus, PipelineRun } from '../../types';

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
  pipelineRun?: PipelineRun | null;
  onSubmitForReview?: () => void;
  onRetryPipeline?: () => Promise<void>;
  exceptionJustification?: string;
  onExceptionJustificationChange?: (value: string) => void;
  onRequestException?: (pipelineRunId: string, exceptionType: string, justification: string) => void;
  exceptionRequested?: boolean;
  requestingException?: boolean;
}

interface DetectedException {
  type: string;
  reason: string;
}

function getDetectedExceptions(pipelineRun?: PipelineRun | null): DetectedException[] {
  if (!pipelineRun?.metadata?.detected_exceptions) return [];
  const raw = pipelineRun.metadata.detected_exceptions;
  if (!Array.isArray(raw)) return [];
  return raw as DetectedException[];
}

function SecurityExceptionPrompt({
  pipelineRun,
  pipelineRunId,
  exceptionJustification = '',
  onExceptionJustificationChange,
  onRequestException,
  exceptionRequested = false,
  requestingException = false,
}: {
  pipelineRun?: PipelineRun | null;
  pipelineRunId?: string | null;
  exceptionJustification?: string;
  onExceptionJustificationChange?: (value: string) => void;
  onRequestException?: (pipelineRunId: string, exceptionType: string, justification: string) => void;
  exceptionRequested?: boolean;
  requestingException?: boolean;
}) {
  const detected = getDetectedExceptions(pipelineRun);
  if (detected.length === 0) return null;

  return (
    <div className="bg-amber-900/30 border border-amber-500/50 rounded-lg p-4 mt-4">
      <h4 className="text-amber-400 font-semibold mb-2 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Security Exception Required
      </h4>
      <p className="text-sm text-gray-300 mb-3">
        This application requires elevated privileges that are normally restricted:
      </p>
      <ul className="list-disc list-inside text-sm text-gray-300 mb-3">
        {detected.map((ex, i) => (
          <li key={i}>
            {ex.reason} ({ex.type})
          </li>
        ))}
      </ul>
      {exceptionRequested ? (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400">Security exception requested successfully</span>
        </div>
      ) : (
        <>
          <textarea
            placeholder="Provide justification for why this exception is needed..."
            className="w-full bg-navy-800 border border-gray-600 rounded p-2 text-sm text-white mb-2 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
            value={exceptionJustification}
            onChange={(e) => onExceptionJustificationChange?.(e.target.value)}
            rows={3}
          />
          <button
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm flex items-center gap-2"
            onClick={() => {
              if (pipelineRunId && onRequestException) {
                onRequestException(pipelineRunId, detected[0].type, exceptionJustification);
              }
            }}
            disabled={requestingException || !exceptionJustification.trim()}
          >
            {requestingException ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Requesting...
              </>
            ) : (
              'Request Security Exception'
            )}
          </button>
        </>
      )}
    </div>
  );
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
  pipelineRun,
  onSubmitForReview,
  onRetryPipeline,
  exceptionJustification = '',
  onExceptionJustificationChange,
  onRequestException,
  exceptionRequested = false,
  requestingException = false,
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
  const isDeploying = pipelineRunStatus === 'deploying';
  const isDeployed = pipelineRunStatus === 'deployed';
  const isRejected = pipelineRunStatus === 'rejected';
  const isReturned = pipelineRunStatus === 'returned';
  const isFailed = pipelineRunStatus === 'failed';

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

      {/* Security Exception Prompt */}
      <SecurityExceptionPrompt
        pipelineRun={pipelineRun}
        pipelineRunId={pipelineRunId}
        exceptionJustification={exceptionJustification}
        onExceptionJustificationChange={onExceptionJustificationChange}
        onRequestException={onRequestException}
        exceptionRequested={exceptionRequested}
        requestingException={requestingException}
      />

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
          {isDeployed ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">
                ISSM Review: Approved — Application deployed
              </span>
            </div>
          ) : isDeploying ? (
            <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-4 py-3">
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              <span className="text-sm text-cyan-400 font-medium">
                ISSM Review: Approved — Deploying to cluster...
              </span>
            </div>
          ) : isApproved ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <ShieldAlert className="w-5 h-5 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">
                ISSM Review: Approved — ready to deploy
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

      {/* Pipeline Status Transitions */}
      {isRejected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-400" />
            <span className="text-sm text-red-400 font-medium">
              ISSM Review: Rejected
            </span>
          </div>
          <p className="text-xs text-gray-400">
            The ISSM has rejected this pipeline run. Please address the findings and resubmit.
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

      {isReturned && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <RotateCw className="w-5 h-5 text-amber-400" />
            <span className="text-sm text-amber-400 font-medium">
              ISSM Review: Returned for Revision
            </span>
          </div>
          <p className="text-xs text-gray-400">
            The ISSM has returned this pipeline run for revisions. Please address the feedback and resubmit.
          </p>
        </div>
      )}

      {isDeploying && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-sm text-cyan-400 font-medium">
              Deploying to cluster...
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Your application is being deployed to the SRE platform. This page will update automatically.
          </p>
        </div>
      )}

      {isDeployed && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">
              Deployed successfully!
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Your application is live on the SRE platform.
          </p>
        </div>
      )}

      {isFailed && !hasCriticalFailure && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-400" />
            <span className="text-sm text-red-400 font-medium">
              Pipeline failed
            </span>
          </div>
          <p className="text-xs text-gray-400">
            The pipeline run has failed. Please check the gate results above for details.
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

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={isPipelineRunning || isDeploying}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed || isPipelineRunning || isDeploying}
          icon={<ArrowRight className="w-4 h-4" />}
          size="lg"
        >
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
