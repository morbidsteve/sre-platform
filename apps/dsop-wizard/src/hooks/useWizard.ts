import { useState, useCallback } from 'react';
import type {
  WizardState,
  AppSource,
  AppInfo,
  SecurityGate,
  DeployStep,
  DetectionResult,
} from '../types';
import {
  analyzeSource,
  getInitialGates,
  runSecurityPipeline,
  getInitialDeploySteps,
  runDeploy,
} from '../api';

const initialSource: AppSource = {
  type: 'git',
  gitUrl: '',
  branch: 'main',
};

const initialAppInfo: AppInfo = {
  name: '',
  description: '',
  team: 'team-alpha',
  classification: 'UNCLASSIFIED',
  contact: '',
  accessLevel: 'everyone',
};

const initialState: WizardState = {
  currentStep: 1,
  source: initialSource,
  appInfo: initialAppInfo,
  detection: null,
  gates: getInitialGates(),
  deploySteps: getInitialDeploySteps(),
  deployedUrl: null,
  isAnalyzing: false,
  isPipelineRunning: false,
  isDeploying: false,
  error: null,
};

export function useWizard() {
  const [state, setState] = useState<WizardState>(initialState);

  const setStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step, error: null }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => ({ ...prev, currentStep: prev.currentStep + 1, error: null }));
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({ ...prev, currentStep: Math.max(1, prev.currentStep - 1), error: null }));
  }, []);

  const updateSource = useCallback((source: Partial<AppSource>) => {
    setState((prev) => ({ ...prev, source: { ...prev.source, ...source } }));
  }, []);

  const updateAppInfo = useCallback((info: Partial<AppInfo>) => {
    setState((prev) => ({ ...prev, appInfo: { ...prev.appInfo, ...info } }));
  }, []);

  const analyze = useCallback(async () => {
    setState((prev) => ({ ...prev, isAnalyzing: true, error: null }));
    try {
      const detection = await analyzeSource(state.source);
      setState((prev) => ({
        ...prev,
        detection,
        isAnalyzing: false,
        currentStep: 3,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isAnalyzing: false,
        error: err instanceof Error ? err.message : 'Analysis failed',
      }));
    }
  }, [state.source]);

  const setDetection = useCallback((detection: DetectionResult) => {
    setState((prev) => ({ ...prev, detection }));
  }, []);

  const runPipeline = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isPipelineRunning: true,
      gates: getInitialGates(),
      error: null,
      currentStep: 4,
    }));

    try {
      const finalGates = await runSecurityPipeline(
        getInitialGates(),
        (gates: SecurityGate[]) => {
          setState((prev) => ({ ...prev, gates }));
        }
      );
      setState((prev) => ({
        ...prev,
        gates: finalGates,
        isPipelineRunning: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isPipelineRunning: false,
        error: err instanceof Error ? err.message : 'Pipeline failed',
      }));
    }
  }, []);

  const updateGate = useCallback((gateId: number, updates: Partial<SecurityGate>) => {
    setState((prev) => ({
      ...prev,
      gates: prev.gates.map((g) => (g.id === gateId ? { ...g, ...updates } : g)),
    }));
  }, []);

  const deploy = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isDeploying: true,
      deploySteps: getInitialDeploySteps(),
      error: null,
      currentStep: 6,
    }));

    try {
      const result = await runDeploy(
        state.appInfo.name || 'my-app',
        getInitialDeploySteps(),
        (steps: DeployStep[]) => {
          setState((prev) => ({ ...prev, deploySteps: steps }));
        }
      );
      setState((prev) => ({
        ...prev,
        deploySteps: result.steps,
        deployedUrl: result.url,
        isDeploying: false,
        currentStep: 7,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isDeploying: false,
        error: err instanceof Error ? err.message : 'Deployment failed',
      }));
    }
  }, [state.appInfo.name]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    setStep,
    nextStep,
    prevStep,
    updateSource,
    updateAppInfo,
    analyze,
    setDetection,
    runPipeline,
    updateGate,
    deploy,
    reset,
  };
}
