import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { WizardLayout } from './components/WizardLayout';
import { WizardLauncher } from './components/WizardLauncher';
import { ResumePrompt } from './components/ResumePrompt';
import { Step1_AppSource } from './components/steps/Step1_AppSource';
import { Step2_AppInfo } from './components/steps/Step2_AppInfo';
import { Step3_Detection } from './components/steps/Step3_Detection';
import { Step4_SecurityPipeline } from './components/steps/Step4_SecurityPipeline';
import { Step5_Review } from './components/steps/Step5_Review';
import { Step6_Deploy } from './components/steps/Step6_Deploy';
import { Step7_Complete } from './components/steps/Step7_Complete';
import { Step0_ModeSelect } from './components/steps/Step0_ModeSelect';
import { Step_EasyConfig } from './components/steps/Step_EasyConfig';
import { Step_EasyReview } from './components/steps/Step_EasyReview';
import { Step_BundleConfig } from './components/steps/Step_BundleConfig';
import { Step_BundleReview } from './components/steps/Step_BundleReview';
import { useWizard } from './hooks/useWizard';
import { useUser } from './hooks/useUser';
import { usePipelineStream } from './hooks/usePipelineStream';
import { Spinner } from './components/ui/Spinner';
import { getConfig } from './config';

const easyStepLabels = ['Configure', 'Review', 'Complete'];
const bundleStepLabels = ['Configure', 'Review', 'Download'];

export default function App() {
  const { user, loading: userLoading } = useUser();
  const wizard = useWizard();
  const { state } = wizard;

  // Easy mode deploy result tracking
  const [easyResult, setEasyResult] = useState<{ success: boolean; prUrl?: string; error?: string } | null>(null);

  const [bundleFiles, setBundleFiles] = useState<{
    primaryImage: File | null;
    components: Map<number, File>;
    source: File | null;
  }>({ primaryImage: null, components: new Map(), source: null });

  // ── Launcher vs Wizard view ──────────────────────────────────
  // Show the launcher unless:
  //   - URL has ?runId= (skip straight to wizard/resume)
  //   - User clicked "Start New" or selected a run from the launcher
  const [showLauncher, setShowLauncher] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return !params.get('runId');
  });

  // Subscribe to the SSE stream for deploy-phase events (active for Steps 5–7)
  const pipelineStream = usePipelineStream(
    state.currentStep >= 5 ? state.pipelineRunId : null
  );

  // ── Theme sync from dashboard ──────────────────────────────────
  const dashboardTheme = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('theme');
  }, []);

  useEffect(() => {
    if (dashboardTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  }, [dashboardTheme]);

  // ── Launcher handlers ──────────────────────────────────────────
  const handleStartNew = useCallback(() => {
    sessionStorage.removeItem('dsop-wizard-state');
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('runId');
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
    wizard.reset();
    setEasyResult(null);
    setShowLauncher(false);
  }, [wizard]);

  const handleSelectRun = useCallback((runId: string) => {
    setShowLauncher(false);
    // Load the run directly instead of reloading the page.
    // Page reload inside an iframe causes the dashboard to re-open a new wizard.
    wizard.loadRunById(runId);
  }, [wizard]);

  // When wizard.reset() is called (e.g. from Step7 "New Pipeline" button),
  // return to the launcher
  const handleWizardReset = useCallback(() => {
    wizard.reset();
    setEasyResult(null);
    setShowLauncher(true);
  }, [wizard]);

  // ── Easy mode deploy ──────────────────────────────────────────────
  // Track easy deploy results from state
  useEffect(() => {
    if (state.mode === 'easy' && state.easyPrUrl) {
      setEasyResult({ success: true, prUrl: state.easyPrUrl });
    }
  }, [state.mode, state.easyPrUrl]);

  // Track easy deploy errors from state
  useEffect(() => {
    if (state.mode === 'easy' && state.error && !state.isDeploying) {
      setEasyResult({ success: false, error: state.error });
    }
  }, [state.mode, state.error, state.isDeploying]);

  const handleEasySubmit = useCallback(async () => {
    setEasyResult(null);
    await wizard.submitEasyDeploy();
  }, [wizard]);

  // ── Enter key advances to next step, Escape closes iframe ────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Escape: tell parent frame to close us
      if (e.key === 'Escape') {
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'dsop-wizard-close' }, '*');
        }
        return;
      }

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
          handleWizardReset();
          break;
        }
      }
    },
    [state, wizard, handleWizardReset]
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

  // ── Show launcher screen ──────────────────────────────────────
  if (showLauncher) {
    return <WizardLauncher onStartNew={handleStartNew} onSelectRun={handleSelectRun} />;
  }

  const renderStep = () => {
    // Mode selection (Step 0 — mode not yet chosen)
    if (state.mode === null) {
      return (
        <Step0_ModeSelect
          onSelectMode={(mode) => {
            wizard.setMode(mode);
          }}
        />
      );
    }

    // Easy mode steps
    if (state.mode === 'easy') {
      switch (state.currentStep) {
        case 1:
          return (
            <Step_EasyConfig
              config={state.easyConfig}
              onUpdate={wizard.updateEasyConfig}
              onNext={wizard.nextStep}
              onBack={() => handleWizardReset()}
            />
          );
        case 2:
          return (
            <Step_EasyReview
              config={state.easyConfig}
              onBack={wizard.prevStep}
              onSubmit={handleEasySubmit}
              submitting={state.isDeploying}
              result={easyResult}
              onReset={handleWizardReset}
            />
          );
        case 3:
          return (
            <Step7_Complete
              appName={state.easyConfig.appName || 'my-app'}
              deployedUrl={
                state.easyPrUrl ||
                `https://${state.easyConfig.appName || 'my-app'}.${getConfig().domain}`
              }
              onReset={handleWizardReset}
            />
          );
        default:
          return null;
      }
    }

    // Bundle builder steps
    if (state.mode === 'bundle') {
      switch (state.currentStep) {
        case 1:
          return (
            <Step_BundleConfig
              config={state.bundleBuilderConfig}
              onUpdate={wizard.updateBundleBuilderConfig}
              onFilesChange={setBundleFiles}
              onNext={wizard.nextStep}
              onBack={handleWizardReset}
            />
          );
        case 2:
          return (
            <Step_BundleReview
              config={state.bundleBuilderConfig}
              files={bundleFiles}
              onBack={wizard.prevStep}
              onReset={handleWizardReset}
            />
          );
        default:
          return null;
      }
    }

    // Full pipeline steps (existing, unchanged)
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
            securityCategorization={state.securityCategorization}
            onUpdateSecurityCategorization={wizard.updateSecurityCategorization}
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
            appName={state.appInfo.name || 'my-app'}
            teamName={state.appInfo.team || 'team-alpha'}
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
            deployStreamStates={pipelineStream.deploySteps}
            deployLogs={pipelineStream.deployLogs}
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
            onReset={handleWizardReset}
            pipelineRunId={state.pipelineRunId}
            onDownloadPackage={wizard.downloadPackage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Resume / Start New prompt — shown when a previous session run is found */}
      {wizard.resumePrompt && (
        <ResumePrompt
          prompt={wizard.resumePrompt}
          onResume={wizard.confirmResume}
          onStartNew={wizard.discardAndStartNew}
        />
      )}

      <WizardLayout
        currentStep={state.mode === null ? 0 : state.currentStep}
        classification={state.appInfo.classification}
        stepLabels={state.mode === 'easy' ? easyStepLabels : state.mode === 'bundle' ? bundleStepLabels : undefined}
        totalSteps={state.mode === 'easy' ? 3 : state.mode === 'bundle' ? 2 : undefined}
        onStepClick={(step) => {
          if (state.mode === null) return;
          if (state.isDeploying || state.isAnalyzing) return;
          if (step < state.currentStep) {
            wizard.setStep(step);
          } else if (state.mode === 'full' && step === 4 && state.pipelineRunId && !state.isPipelineRunning) {
            wizard.setStep(4);
          } else if (step <= state.currentStep) {
            wizard.setStep(step);
          }
        }}
        onReset={handleWizardReset}
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
    </>
  );
}
