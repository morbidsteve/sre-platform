import React, { useEffect, useCallback } from 'react';
import { WizardLayout } from './components/WizardLayout';
import { Step1_AppSource } from './components/steps/Step1_AppSource';
import { Step2_AppInfo } from './components/steps/Step2_AppInfo';
import { Step3_Detection } from './components/steps/Step3_Detection';
import { Step4_SecurityPipeline } from './components/steps/Step4_SecurityPipeline';
import { Step5_Review } from './components/steps/Step5_Review';
import { Step6_Deploy } from './components/steps/Step6_Deploy';
import { Step7_Complete } from './components/steps/Step7_Complete';
import { useWizard } from './hooks/useWizard';
import { useUser } from './hooks/useUser';
import { Spinner } from './components/ui/Spinner';
import { getConfig } from './config';

export default function App() {
  const { user, loading: userLoading } = useUser();
  const wizard = useWizard();
  const { state } = wizard;

  // ── Enter key advances to next step ──────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;

      // Don't trigger in textareas (multi-line input)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA') return;

      // Don't trigger if a modal/overlay is open or a dropdown is focused
      if ((e.target as HTMLElement)?.closest?.('[role="dialog"], [role="listbox"], .review-form')) return;

      // Don't trigger while async operations are running
      if (state.isAnalyzing || state.isPipelineRunning || state.isDeploying) return;

      e.preventDefault();

      switch (state.currentStep) {
        case 1: {
          const valid =
            (state.source.type === 'git' && state.source.gitUrl?.trim()) ||
            (state.source.type === 'container' && state.source.imageUrl?.trim()) ||
            (state.source.type === 'helm' && state.source.chartRepo && state.source.chartName);
          if (valid) wizard.nextStep();
          break;
        }
        case 2: {
          const nameValid = state.appInfo.name?.trim();
          if (nameValid) wizard.analyze();
          break;
        }
        case 3: {
          if (state.detection) wizard.runPipeline();
          break;
        }
        case 4: {
          const autoGates = state.gates.filter(
            (g) => !['ISSM REVIEW', 'ISSM_REVIEW', 'IMAGE SIGNING', 'IMAGE_SIGNING'].includes(g.shortName)
          );
          const done = autoGates.every((g) => g.status !== 'pending' && g.status !== 'running');
          const noFail = !autoGates.some((g) => g.status === 'failed');
          if (done && noFail) wizard.setStep(5);
          break;
        }
        case 5: {
          const status = state.pipelineRun?.status;
          if (status === 'approved' || wizard.isAdmin) wizard.deploy();
          break;
        }
        case 7: {
          wizard.reset();
          break;
        }
      }
    },
    [state, wizard]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (userLoading) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Spinner size="lg" className="text-cyan-400 mx-auto" />
          <p className="text-gray-400 text-sm font-mono">
            Initializing DSOP Wizard...
          </p>
        </div>
      </div>
    );
  }

  const renderStep = () => {
    switch (state.currentStep) {
      case 1:
        return (
          <Step1_AppSource
            source={state.source}
            onUpdate={wizard.updateSource}
            onNext={wizard.nextStep}
          />
        );

      case 2:
        return (
          <Step2_AppInfo
            appInfo={state.appInfo}
            user={user}
            onUpdate={wizard.updateAppInfo}
            onBack={wizard.prevStep}
            onNext={() => wizard.analyze()}
            isAnalyzing={state.isAnalyzing}
            securityExceptions={state.securityExceptions}
            onUpdateSecurityExceptions={wizard.updateSecurityExceptions}
          />
        );

      case 3:
        if (!state.detection) {
          return (
            <div className="text-center py-20">
              <Spinner size="lg" className="text-cyan-400 mx-auto mb-4" />
              <p className="text-gray-400 font-mono">Analyzing source...</p>
            </div>
          );
        }
        return (
          <Step3_Detection
            detection={state.detection}
            source={state.source}
            appName={state.appInfo.name}
            onBack={wizard.prevStep}
            onRunPipeline={wizard.runPipeline}
            hasPipelineRun={!!state.pipelineRunId}
            onGoToPipeline={() => wizard.setStep(4)}
          />
        );

      case 4:
        return (
          <Step4_SecurityPipeline
            gates={state.gates}
            isPipelineRunning={state.isPipelineRunning}
            onUpdateGate={wizard.updateGate}
            onUpdateFinding={wizard.updateFinding}
            onOverrideGate={wizard.overrideGate}
            isAdmin={wizard.isAdmin}
            username={user?.name || 'operator'}
            onBack={() => wizard.setStep(3)}
            onNext={() => wizard.setStep(5)}
            pipelineRunId={state.pipelineRunId}
            pipelineRunStatus={state.pipelineRun?.status}
            pipelineRun={state.pipelineRun}
            onSubmitForReview={wizard.submitForReview}
            onRetryPipeline={wizard.retryPipeline}
            exceptionJustification={wizard.exceptionJustification}
            onExceptionJustificationChange={wizard.setExceptionJustification}
            onRequestException={wizard.requestException}
            exceptionRequested={wizard.exceptionRequested}
            requestingException={wizard.requestingException}
          />
        );

      case 5:
        if (!state.detection && !state.pipelineRunId) return null;
        return (
          <Step5_Review
            appInfo={state.appInfo}
            detection={state.detection || { repoType: 'container' as const, services: [], platformServices: [], externalAccess: [] }}
            gates={state.gates}
            onBack={() => wizard.setStep(4)}
            onDeploy={wizard.deploy}
            pipelineRun={state.pipelineRun}
            pipelineRunStatus={state.pipelineRun?.status}
            onSubmitForReview={wizard.submitForReview}
            onRefreshPipelineRun={wizard.refreshPipelineRun}
            onDownloadPackage={wizard.downloadPackage}
            isAdmin={wizard.isAdmin}
            onReviewPipelineRun={wizard.reviewPipelineRun}
            securityExceptions={state.securityExceptions}
          />
        );

      case 6:
        return (
          <Step6_Deploy
            deploySteps={state.deploySteps}
            isDeploying={state.isDeploying}
            error={state.error}
          />
        );

      case 7:
        return (
          <Step7_Complete
            appName={state.appInfo.name || 'my-app'}
            deployedUrl={
              state.deployedUrl ||
              `https://${state.appInfo.name || 'my-app'}.${getConfig().domain}`
            }
            classification={state.appInfo.classification}
            gates={state.gates}
            onReset={wizard.reset}
            pipelineRunId={state.pipelineRunId}
            onDownloadPackage={wizard.downloadPackage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <WizardLayout
      currentStep={state.currentStep}
      classification={state.appInfo.classification}
      onStepClick={(step) => {
        // Allow navigating to completed steps or to step 4 if pipeline exists
        if (state.isDeploying || state.isAnalyzing) return;
        if (step < state.currentStep) {
          wizard.setStep(step);
        } else if (step === 4 && state.pipelineRunId && !state.isPipelineRunning) {
          wizard.setStep(4);
        } else if (step <= state.currentStep) {
          wizard.setStep(step);
        }
      }}
    >
      {/* Error Banner */}
      {state.error && state.currentStep !== 6 && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-400">{state.error}</p>
          <button
            onClick={() =>
              wizard.updateAppInfo({} as never)
            }
            className="text-xs text-red-300 hover:text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {renderStep()}
    </WizardLayout>
  );
}
