import { useCallback } from 'react';
import { useWizardState } from './useWizardState';
import { usePipelinePolling } from './usePipelinePolling';
import { useSecurityExceptions } from './useSecurityExceptions';

/**
 * Main wizard hook — thin composition layer.
 *
 * Composes useWizardState, usePipelinePolling, and useSecurityExceptions
 * into a single interface. Existing components that call useWizard()
 * continue to work without changes.
 */
export function useWizard() {
  const wizardState = useWizardState();
  const polling = usePipelinePolling(wizardState.setState);
  const exceptions = useSecurityExceptions();

  // ── Override runPipeline to start polling after run creation ──

  const runPipeline = useCallback(async () => {
    const run = await wizardState.runPipeline();
    if (run) {
      polling.startPolling(run.id);
    }
  }, [wizardState.runPipeline, polling.startPolling]);

  // ── Override retryPipeline to delegate to polling hook ──

  const retryPipeline = useCallback(async () => {
    if (!wizardState.state.pipelineRunId) return;
    await polling.retryPipeline(wizardState.state.pipelineRunId);
  }, [wizardState.state.pipelineRunId, polling.retryPipeline]);

  // ── Override reset to also clean up polling and exception state ──

  const reset = useCallback(() => {
    polling.stopPolling();
    exceptions.resetExceptions();
    wizardState.reset();
  }, [polling.stopPolling, exceptions.resetExceptions, wizardState.reset]);

  // ── discardAndStartNew also stops polling ──

  const discardAndStartNew = useCallback(() => {
    polling.stopPolling();
    exceptions.resetExceptions();
    wizardState.discardAndStartNew();
  }, [polling.stopPolling, exceptions.resetExceptions, wizardState.discardAndStartNew]);

  // ── Return the exact same interface as the original useWizard ──

  return {
    state: wizardState.state,
    setStep: wizardState.setStep,
    nextStep: wizardState.nextStep,
    prevStep: wizardState.prevStep,
    updateSource: wizardState.updateSource,
    updateAppInfo: wizardState.updateAppInfo,
    updateSecurityExceptions: wizardState.updateSecurityExceptions,
    updateSecurityCategorization: wizardState.updateSecurityCategorization,
    analyze: wizardState.analyze,
    setDetection: wizardState.setDetection,
    runPipeline,
    retryPipeline,
    updateGate: wizardState.updateGate,
    updateFinding: wizardState.updateFinding,
    submitForReview: wizardState.submitForReview,
    refreshPipelineRun: wizardState.refreshPipelineRun,
    reviewPipelineRun: wizardState.reviewPipelineRun,
    overrideGate: wizardState.overrideGate,
    isAdmin: wizardState.isAdmin,
    user: wizardState.user,
    deploy: wizardState.deploy,
    downloadPackage: wizardState.downloadPackage,
    reset,
    // Resume / start-new prompt
    resumePrompt: wizardState.resumePrompt,
    confirmResume: wizardState.confirmResume,
    discardAndStartNew,
    // Security exception state (for Step4 security exception UI)
    exceptionJustification: exceptions.exceptionJustification,
    setExceptionJustification: exceptions.setExceptionJustification,
    exceptionRequested: exceptions.exceptionRequested,
    requestException: exceptions.requestException,
    requestingException: exceptions.requestingException,
  };
}
