import { useState, useCallback, useEffect } from 'react';
import { getConfig } from '../config';
import type {
  WizardState,
  AppSource,
  AppInfo,
  Classification,
  SecurityException,
  SecurityCategorization,
  SecurityGate,
  GateFinding,
  DetectionResult,
  DeployStep,
  PipelineGate,
  PipelineFinding,
  FindingDisposition,
} from '../types';
import {
  analyzeSource,
  getInitialGates,
  runSecurityPipeline,
  getInitialDeploySteps,
  runDeploy,
  createPipelineRun,
  getPipelineRun,
  submitForReview as apiSubmitForReview,
  submitReview as apiSubmitReview,
  updateFindingDisposition as apiUpdateFindingDisposition,
  overrideGate as apiOverrideGate,
  deployPipelineRun,
  downloadCompliancePackage as apiDownloadCompliancePackage,
  requestSecurityExceptions as apiRequestSecurityExceptions,
  getCurrentUser,
} from '../api';
import { mapPipelineGateToSecurityGate } from './usePipelinePolling';

// ── Defaults ──

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

const initialSecurityCategorization: SecurityCategorization = {
  dataTypes: [],
  confidentiality: 'low',
  integrity: 'low',
  availability: 'low',
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
  pipelineRunId: null,
  pipelineRun: null,
  securityExceptions: [],
  securityCategorization: initialSecurityCategorization,
};

// ── Session persistence ──

const SESSION_KEY = 'dsop-wizard-state';

function saveSession(state: WizardState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      currentStep: state.currentStep,
      source: state.source,
      appInfo: state.appInfo,
      securityExceptions: state.securityExceptions,
      securityCategorization: state.securityCategorization,
      pipelineRunId: state.pipelineRunId,
      deployedUrl: state.deployedUrl,
    }));
  } catch { /* ignore */ }
}

function loadSession(): Partial<WizardState> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Hook ──

export function useWizardState() {
  const [state, setState] = useState<WizardState>(() => {
    const saved = loadSession();
    if (saved) {
      return { ...initialState, ...saved, gates: getInitialGates(), deploySteps: getInitialDeploySteps() };
    }
    return initialState;
  });
  const [user, setUser] = useState<{ name: string; email: string; groups: string[] } | null>(null);

  // Fetch user info on mount
  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  // Persist wizard state to sessionStorage on changes
  useEffect(() => {
    saveSession(state);
  }, [state.currentStep, state.source, state.appInfo, state.pipelineRunId, state.deployedUrl]);

  // On mount, check URL for ?runId= parameter first, then fall back to session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRunId = params.get('runId');
    const runIdToLoad = urlRunId || state.pipelineRunId;

    if (runIdToLoad) {
      getPipelineRun(runIdToLoad).then((run) => {
        const mappedGates = run.gates.map((g: PipelineGate) =>
          mapPipelineGateToSecurityGate(g, run.findings, getInitialGates())
        );
        // Determine which step to show based on run status
        const step = run.status === 'deployed' ? 7 :
                     run.status === 'deploying' ? 6 :
                     run.status === 'approved' || run.status === 'review_pending' || run.status === 'rejected' ? 5 :
                     run.status === 'scanning' || run.status === 'failed' ? 4 : 4;
        setState((prev) => ({
          ...prev,
          pipelineRunId: run.id,
          pipelineRun: run,
          gates: mappedGates,
          currentStep: urlRunId ? step : prev.currentStep,
          appInfo: urlRunId ? {
            ...prev.appInfo,
            name: run.app_name || prev.appInfo.name,
            team: run.team || prev.appInfo.team,
            classification: (run.classification || prev.appInfo.classification) as Classification,
          } : prev.appInfo,
          source: urlRunId ? {
            ...prev.source,
            gitUrl: run.git_url || prev.source.gitUrl,
            branch: run.branch || prev.source.branch,
            imageUrl: run.image_url || prev.source.imageUrl,
            type: run.source_type === 'image' ? 'container' : 'git',
          } : prev.source,
        }));
        // Clean URL parameter without reload
        if (urlRunId) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }).catch(() => { /* run may have been deleted */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = user
    ? user.groups.some((g) => g === 'sre-admins' || g === 'issm')
    : false;

  // ── Step navigation ──

  const setStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step, error: null }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => ({ ...prev, currentStep: prev.currentStep + 1, error: null }));
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({ ...prev, currentStep: Math.max(1, prev.currentStep - 1), error: null }));
  }, []);

  // ── Form data updates ──

  const updateSource = useCallback((source: Partial<AppSource>) => {
    setState((prev) => ({ ...prev, source: { ...prev.source, ...source } }));
  }, []);

  const updateAppInfo = useCallback((info: Partial<AppInfo>) => {
    setState((prev) => ({ ...prev, appInfo: { ...prev.appInfo, ...info } }));
  }, []);

  const updateSecurityExceptions = useCallback((exceptions: SecurityException[]) => {
    setState((prev) => ({ ...prev, securityExceptions: exceptions }));
  }, []);

  const updateSecurityCategorization = useCallback((categorization: Partial<SecurityCategorization>) => {
    setState((prev) => ({
      ...prev,
      securityCategorization: { ...prev.securityCategorization, ...categorization },
    }));
  }, []);

  // ── Source analysis ──

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

  // ── Gate updates ──

  const updateGate = useCallback((gateId: number, updates: Partial<SecurityGate>) => {
    setState((prev) => ({
      ...prev,
      gates: prev.gates.map((g) => (g.id === gateId ? { ...g, ...updates } : g)),
    }));
  }, []);

  const updateFinding = useCallback((gateId: number, findingIndex: number, updates: Partial<GateFinding>) => {
    setState((prev) => {
      const newState = {
        ...prev,
        gates: prev.gates.map((g) => {
          if (g.id !== gateId) return g;
          const findings = [...g.findings];
          findings[findingIndex] = { ...findings[findingIndex], ...updates };
          return { ...g, findings };
        }),
      };

      // If we have a pipeline run, also update the finding disposition via API
      if (prev.pipelineRunId && prev.pipelineRun && updates.disposition) {
        const gate = prev.gates.find((g) => g.id === gateId);
        if (gate && prev.pipelineRun.findings) {
          const gateApiFindings = prev.pipelineRun.findings.filter(
            (f: PipelineFinding) => f.gate_id === gateId
          );
          const apiFinding = gateApiFindings[findingIndex];
          if (apiFinding) {
            apiUpdateFindingDisposition(
              prev.pipelineRunId,
              apiFinding.id,
              updates.disposition as FindingDisposition,
              updates.mitigation
            ).catch(() => {
              // Silently fail -- local state already updated
            });
          }
        }
      }

      return newState;
    });
  }, []);

  const overrideGate = useCallback((gateId: number, status: 'passed' | 'skipped', reason: string) => {
    setState((prev) => ({
      ...prev,
      gates: prev.gates.map((g) =>
        g.id === gateId
          ? { ...g, status, summary: `Admin override: ${reason}` }
          : g
      ),
    }));

    const { pipelineRunId } = state;
    if (pipelineRunId) {
      apiOverrideGate(pipelineRunId, gateId, status, reason).catch(() => {
        // Silently fail -- local state already updated
      });
    }
  }, [state.pipelineRunId]);

  // ── Pipeline run creation (creates run, submits exceptions) ──

  const runPipeline = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isPipelineRunning: true,
      gates: getInitialGates(),
      error: null,
      currentStep: 4,
      pipelineRunId: null,
      pipelineRun: null,
    }));

    // Try the Pipeline API first
    try {
      const run = await createPipelineRun({
        appName: state.appInfo.name || 'my-app',
        gitUrl: state.source.gitUrl,
        branch: state.source.branch || 'main',
        imageUrl: state.source.imageUrl,
        sourceType: state.source.type,
        team: state.appInfo.team || 'team-alpha',
        classification: state.appInfo.classification,
        contact: state.appInfo.contact,
      });

      const localGates = getInitialGates();

      setState((prev) => ({
        ...prev,
        pipelineRunId: run.id,
        pipelineRun: run,
      }));

      // Update browser URL with runId for shareable link
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('runId', run.id);
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Ignore URL update failures
      }

      // Submit security exceptions if any are enabled
      const enabledExceptions = state.securityExceptions.filter((e) => e.enabled);
      if (enabledExceptions.length > 0) {
        apiRequestSecurityExceptions(
          run.id,
          enabledExceptions.map((e) => ({ type: e.type, justification: e.justification }))
        ).catch(() => {
          // Silently fail -- pipeline run still created
        });
      }

      // Update gates from initial response
      if (run.gates && run.gates.length > 0) {
        const mappedGates = run.gates.map((g) =>
          mapPipelineGateToSecurityGate(g, run.findings || [], localGates)
        );
        setState((prev) => ({ ...prev, gates: mappedGates }));
      }

      // Return the run so the caller (useWizard) can start polling
      return run;
    } catch (pipelineErr) {
      // Pipeline API unavailable -- fall back to direct scan mode (degraded)
      console.warn(
        'Pipeline API unavailable, falling back to direct scan mode:',
        pipelineErr instanceof Error ? pipelineErr.message : pipelineErr
      );
      setState((prev) => ({
        ...prev,
        error: 'Pipeline API unavailable — running in degraded mode (direct scans). Auth headers may not be forwarded.',
      }));
    }

    // Fallback: use the existing runSecurityPipeline flow (direct scan endpoints)
    try {
      const finalGates = await runSecurityPipeline(
        getInitialGates(),
        (gates: SecurityGate[]) => {
          setState((prev) => ({ ...prev, gates }));
        },
        state.source.gitUrl,
        state.source.branch
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

    return null;
  }, [state.appInfo, state.source, state.securityExceptions]);

  // ── ISSM review submission ──

  const submitForReview = useCallback(async () => {
    if (!state.pipelineRunId) return;
    try {
      await apiSubmitForReview(state.pipelineRunId);
      const updatedRun = await getPipelineRun(state.pipelineRunId);
      const mappedGates = updatedRun.gates.map((g: PipelineGate) =>
        mapPipelineGateToSecurityGate(g, updatedRun.findings || [], getInitialGates())
      );
      setState((prev) => ({
        ...prev,
        pipelineRun: updatedRun,
        gates: mappedGates,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to submit for review',
      }));
    }
  }, [state.pipelineRunId]);

  // ── Deploy ──

  const deploy = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      isDeploying: true,
      deploySteps: getInitialDeploySteps(),
      error: null,
      currentStep: 6,
    }));

    // If we have a pipeline run, use the pipeline deploy endpoint
    if (state.pipelineRunId) {
      try {
        await deployPipelineRun(state.pipelineRunId);

        // Mark first step as running immediately
        setState((prev) => ({
          ...prev,
          deploySteps: prev.deploySteps.map((s, i) =>
            i === 0 ? { ...s, status: 'running' as const } : s
          ),
        }));

        // Poll for deployment completion
        let pollCount = 0;
        const deployPoll = setInterval(async () => {
          try {
            pollCount++;
            const updatedRun = await getPipelineRun(state.pipelineRunId!);
            setState((prev) => ({ ...prev, pipelineRun: updatedRun }));

            const steps = getInitialDeploySteps();
            const stepCount = steps.length;
            const completedIdx = updatedRun.status === 'deployed'
              ? stepCount
              : Math.min(Math.floor(pollCount / 3), stepCount - 1);
            const updatedSteps = steps.map((s, i) => ({
              ...s,
              status: (i < completedIdx ? 'completed' : i === completedIdx ? 'running' : 'pending') as DeployStep['status'],
            }));
            setState((prev) => ({ ...prev, deploySteps: updatedSteps }));

            if (updatedRun.status === 'deployed') {
              clearInterval(deployPoll);
              const completedSteps = steps.map((s) => ({
                ...s,
                status: 'completed' as const,
              }));
              setState((prev) => ({
                ...prev,
                deploySteps: completedSteps,
                deployedUrl: updatedRun.deployed_url || `https://${state.appInfo.name || 'my-app'}.${getConfig().domain}`,
                isDeploying: false,
                currentStep: 7,
              }));
            } else if (updatedRun.status === 'failed') {
              clearInterval(deployPoll);
              const failedSteps = updatedSteps.map((s) =>
                s.status === 'running' ? { ...s, status: 'failed' as const } : s
              );
              setState((prev) => ({
                ...prev,
                deploySteps: failedSteps,
                isDeploying: false,
                error: 'Deployment failed — check pipeline history for details',
              }));
            }
          } catch {
            // Keep polling
          }
        }, 3000);

        return;
      } catch (err) {
        // Fall through to legacy deploy
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Pipeline deploy failed, trying legacy deploy...',
        }));
      }
    }

    // Fallback: use the existing runDeploy flow
    try {
      const result = await runDeploy(
        state.appInfo.name || 'my-app',
        state.source.gitUrl || '',
        state.source.branch || 'main',
        state.appInfo.team || 'team-alpha',
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
  }, [state.appInfo.name, state.source.gitUrl, state.source.branch, state.appInfo.team, state.pipelineRunId]);

  // ── Review ──

  const reviewPipelineRun = useCallback(async (
    decision: 'approved' | 'rejected' | 'returned',
    comment: string
  ) => {
    if (!state.pipelineRunId) return;
    try {
      await apiSubmitReview(state.pipelineRunId, decision, comment || undefined);
      const updatedRun = await getPipelineRun(state.pipelineRunId);
      const mappedGates = updatedRun.gates.map((g: PipelineGate) =>
        mapPipelineGateToSecurityGate(g, updatedRun.findings || [], getInitialGates())
      );
      setState((prev) => ({
        ...prev,
        pipelineRun: updatedRun,
        gates: mappedGates,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to submit review',
      }));
      throw err;
    }
  }, [state.pipelineRunId]);

  // ── Refresh pipeline ──

  const refreshPipelineRun = useCallback(async () => {
    if (!state.pipelineRunId) return;
    try {
      const updatedRun = await getPipelineRun(state.pipelineRunId);
      const localGates = getInitialGates();
      const mappedGates = updatedRun.gates.map((g) =>
        mapPipelineGateToSecurityGate(g, updatedRun.findings || [], localGates)
      );
      setState((prev) => ({
        ...prev,
        pipelineRun: updatedRun,
        gates: mappedGates,
      }));
    } catch {
      // Silently fail -- pipeline run may have been deleted
    }
  }, [state.pipelineRunId]);

  // ── Download compliance package ──

  const downloadPackage = useCallback(async () => {
    if (!state.pipelineRunId) {
      return null;
    }
    try {
      const pkg = await apiDownloadCompliancePackage(state.pipelineRunId);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.appInfo.name || 'app'}-compliance-package-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return pkg;
    } catch {
      return null;
    }
  }, [state.pipelineRunId, state.appInfo.name]);

  // ── Reset ──

  const reset = useCallback(() => {
    setState(initialState);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    // Clear runId from URL
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('runId');
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
  }, []);

  // ── Expose setState for sub-hooks ──

  return {
    state,
    setState,
    user,
    isAdmin,
    setStep,
    nextStep,
    prevStep,
    updateSource,
    updateAppInfo,
    updateSecurityExceptions,
    updateSecurityCategorization,
    analyze,
    setDetection,
    runPipeline,
    updateGate,
    updateFinding,
    overrideGate,
    submitForReview,
    deploy,
    reviewPipelineRun,
    refreshPipelineRun,
    downloadPackage,
    reset,
  };
}
