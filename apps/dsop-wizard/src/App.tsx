import React from 'react';
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

export default function App() {
  const { user, loading: userLoading } = useUser();
  const wizard = useWizard();
  const { state } = wizard;

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
          />
        );

      case 4:
        return (
          <Step4_SecurityPipeline
            gates={state.gates}
            isPipelineRunning={state.isPipelineRunning}
            onUpdateGate={wizard.updateGate}
            onBack={() => wizard.setStep(3)}
            onNext={() => wizard.setStep(5)}
          />
        );

      case 5:
        if (!state.detection) return null;
        return (
          <Step5_Review
            appInfo={state.appInfo}
            detection={state.detection}
            gates={state.gates}
            onBack={() => wizard.setStep(4)}
            onDeploy={wizard.deploy}
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
              `https://${state.appInfo.name || 'my-app'}.apps.sre.example.com`
            }
            classification={state.appInfo.classification}
            gates={state.gates}
            onReset={wizard.reset}
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
        // Only allow navigating to completed steps (before current)
        if (step < state.currentStep && !state.isDeploying && !state.isPipelineRunning && !state.isAnalyzing) {
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
