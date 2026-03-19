import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  WizardState,
  AppSource,
  AppInfo,
  SecurityException,
  SecurityGate,
  GateFinding,
  DeployStep,
  DetectionResult,
  PipelineRun,
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
  retryPipelineRun as apiRetryPipelineRun,
  getCurrentUser,
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
  pipelineRunId: null,
  pipelineRun: null,
  securityExceptions: [],
};

const SESSION_KEY = 'dsop-wizard-state';

function saveSession(state: WizardState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      currentStep: state.currentStep,
      source: state.source,
      appInfo: state.appInfo,
      securityExceptions: state.securityExceptions,
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

/** Map PipelineGate objects from the API to SecurityGate objects for the UI */
function mapPipelineGateToSecurityGate(
  pipelineGate: PipelineGate,
  findings: PipelineFinding[],
  localGates: SecurityGate[]
): SecurityGate {
  const gateFindings = findings.filter((f) => f.gate_id === pipelineGate.id);
  // Try to find the matching local gate by order for description/implemented info
  // Match by gate_order (1-based) to the initial gate's id (also 1-based in getInitialGates)
  const localGate = localGates.find((g) => g.id === pipelineGate.gate_order) ||
    localGates.find((g) => g.shortName === pipelineGate.short_name) ||
    localGates[0];

  return {
    id: pipelineGate.id, // Use DB primary key so API calls (e.g., gate output) work correctly
    name: pipelineGate.gate_name,
    shortName: pipelineGate.short_name,
    description: localGate?.description || pipelineGate.gate_name,
    status: pipelineGate.status,
    progress: pipelineGate.progress,
    findings: gateFindings.map((f) => ({
      severity: (f.severity?.toLowerCase() || 'info') as GateFinding['severity'],
      title: f.title,
      description: f.description || '',
      location: f.location || undefined,
      disposition: f.disposition || undefined,
      mitigation: f.mitigation || undefined,
      mitigatedBy: f.mitigated_by || undefined,
      mitigatedAt: f.mitigated_at || undefined,
    })),
    summary: pipelineGate.summary || undefined,
    implemented: pipelineGate.completed_at !== null || pipelineGate.status !== 'pending',
    reportUrl: pipelineGate.report_url || undefined,
  };
}

/** Check if all automated gates are done (not running/pending, excluding ISSM REVIEW and IMAGE SIGNING) */
function areAutomatedGatesDone(gates: PipelineGate[]): boolean {
  return gates.every((g) => {
    const isManual = g.short_name === 'ISSM REVIEW' || g.short_name === 'IMAGE SIGNING';
    if (isManual) return true;
    return g.status !== 'running' && g.status !== 'pending';
  });
}

export function useWizard() {
  const [state, setState] = useState<WizardState>(() => {
    const saved = loadSession();
    if (saved) {
      return { ...initialState, ...saved, gates: getInitialGates(), deploySteps: getInitialDeploySteps() };
    }
    return initialState;
  });
  const [user, setUser] = useState<{ name: string; email: string; groups: string[] } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch user info on mount
  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  // Persist wizard state to sessionStorage on changes
  useEffect(() => {
    saveSession(state);
  }, [state.currentStep, state.source, state.appInfo, state.pipelineRunId, state.deployedUrl]);

  // On mount, if we have a pipelineRunId, refetch it to restore gate state
  useEffect(() => {
    if (state.pipelineRunId) {
      getPipelineRun(state.pipelineRunId).then((run) => {
        const mappedGates = run.gates.map((g) =>
          mapPipelineGateToSecurityGate(g, run.findings, getInitialGates())
        );
        setState((prev) => ({
          ...prev,
          pipelineRun: run,
          gates: mappedGates,
        }));
      }).catch(() => { /* run may have been deleted */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = user
    ? user.groups.some((g) => g === 'sre-admins' || g === 'issm')
    : false;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

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

  const updateSecurityExceptions = useCallback((exceptions: SecurityException[]) => {
    setState((prev) => ({ ...prev, securityExceptions: exceptions }));
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

      // Poll for updates every 3 seconds
      pollingRef.current = setInterval(async () => {
        try {
          const updatedRun = await getPipelineRun(run.id);

          setState((prev) => ({ ...prev, pipelineRun: updatedRun }));

          if (updatedRun.gates && updatedRun.gates.length > 0) {
            const mappedGates = updatedRun.gates.map((g) =>
              mapPipelineGateToSecurityGate(g, updatedRun.findings || [], localGates)
            );
            setState((prev) => ({ ...prev, gates: mappedGates }));
          }

          // Stop polling when all automated gates are done
          if (areAutomatedGatesDone(updatedRun.gates)) {
            stopPolling();
            setState((prev) => ({ ...prev, isPipelineRunning: false }));
          }
        } catch {
          // Polling error -- keep trying silently
        }
      }, 3000);

      return;
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
  }, [state.appInfo, state.source, state.securityExceptions, stopPolling]);

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
        // Find the API finding ID by matching gate DB id and index
        const gate = prev.gates.find((g) => g.id === gateId);
        if (gate && prev.pipelineRun.findings) {
          // gateId is now the DB primary key, so match directly on gate_id
          const gateApiFindings = prev.pipelineRun.findings.filter(
            (f) => f.gate_id === gateId
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

    // If we have a pipeline run, also update on the backend
    const { pipelineRunId } = state;
    if (pipelineRunId) {
      apiOverrideGate(pipelineRunId, gateId, status, reason).catch(() => {
        // Silently fail -- local state already updated
      });
    }
  }, [state.pipelineRunId]);

  const submitForReviewCb = useCallback(async () => {
    if (!state.pipelineRunId) return;
    try {
      await apiSubmitForReview(state.pipelineRunId);
      // Refetch the full run to get updated gate states
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

            // Update deploy steps based on elapsed time to show progress
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
                deployedUrl: updatedRun.deployed_url || `https://${state.appInfo.name || 'my-app'}.apps.sre.example.com`,
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

  const downloadPackage = useCallback(async () => {
    if (!state.pipelineRunId) {
      // Fall back to local compliance package generation (no-op, handled by Step7)
      return null;
    }
    try {
      const pkg = await apiDownloadCompliancePackage(state.pipelineRunId);
      // Trigger file download
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

  const reviewPipelineRun = useCallback(async (
    decision: 'approved' | 'rejected' | 'returned',
    comment: string
  ) => {
    if (!state.pipelineRunId) return;
    try {
      await apiSubmitReview(state.pipelineRunId, decision, comment || undefined);
      // Refetch the full run to get updated gate states (ISSM_REVIEW, IMAGE_SIGNING)
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
  }, [state.pipelineRunId, user]);

  const retryPipeline = useCallback(async () => {
    if (!state.pipelineRunId) return;
    stopPolling();
    try {
      const newRun = await apiRetryPipelineRun(state.pipelineRunId);
      const localGates = getInitialGates();
      setState((prev) => ({
        ...prev,
        pipelineRunId: newRun.id,
        pipelineRun: newRun,
        isPipelineRunning: true,
        gates: localGates,
        error: null,
      }));

      // Map initial gates from response
      if (newRun.gates && newRun.gates.length > 0) {
        const mappedGates = newRun.gates.map((g: PipelineGate) =>
          mapPipelineGateToSecurityGate(g, newRun.findings || [], localGates)
        );
        setState((prev) => ({ ...prev, gates: mappedGates }));
      }

      // Start polling for updates (same as runPipeline)
      pollingRef.current = setInterval(async () => {
        try {
          const updatedRun = await getPipelineRun(newRun.id);
          setState((prev) => ({ ...prev, pipelineRun: updatedRun }));
          if (updatedRun.gates && updatedRun.gates.length > 0) {
            const mappedGates = updatedRun.gates.map((g: PipelineGate) =>
              mapPipelineGateToSecurityGate(g, updatedRun.findings || [], localGates)
            );
            setState((prev) => ({ ...prev, gates: mappedGates }));
          }
          if (areAutomatedGatesDone(updatedRun.gates)) {
            stopPolling();
            setState((prev) => ({ ...prev, isPipelineRunning: false }));
          }
        } catch {
          // Keep polling silently
        }
      }, 3000);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to retry pipeline',
      }));
    }
  }, [state.pipelineRunId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState(initialState);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, [stopPolling]);

  return {
    state,
    setStep,
    nextStep,
    prevStep,
    updateSource,
    updateAppInfo,
    updateSecurityExceptions,
    analyze,
    setDetection,
    runPipeline,
    retryPipeline,
    updateGate,
    updateFinding,
    submitForReview: submitForReviewCb,
    refreshPipelineRun,
    reviewPipelineRun,
    overrideGate,
    isAdmin,
    user,
    deploy,
    downloadPackage,
    reset,
  };
}
