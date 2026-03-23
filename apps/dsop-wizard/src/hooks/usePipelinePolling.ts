import { useCallback, useRef } from 'react';
import type {
  WizardState,
  SecurityGate,
  GateFinding,
  PipelineGate,
  PipelineFinding,
  PipelineRun,
} from '../types';
import {
  getInitialGates,
  getPipelineRun,
  retryPipelineRun as apiRetryPipelineRun,
} from '../api';

// ── Exported helpers (also used by useWizardState) ──

/** Map PipelineGate objects from the API to SecurityGate objects for the UI */
export function mapPipelineGateToSecurityGate(
  pipelineGate: PipelineGate,
  findings: PipelineFinding[],
  localGates: SecurityGate[]
): SecurityGate {
  const gateFindings = findings.filter((f) => f.gate_id === pipelineGate.id);
  const localGate = localGates.find((g) => g.id === pipelineGate.gate_order) ||
    localGates.find((g) => g.shortName === pipelineGate.short_name) ||
    localGates[0];

  return {
    id: pipelineGate.id,
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

/** Check if a pipeline run has reached a terminal state where no further updates are expected */
function isTerminalStatus(status: string): boolean {
  return ['deployed', 'rejected', 'returned', 'failed', 'undeployed'].includes(status);
}

// ── Hook ──

export function usePipelinePolling(
  setState: React.Dispatch<React.SetStateAction<WizardState>>
) {
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingSlowedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollingSlowedRef.current = false;
  }, []);

  /** Start polling for pipeline run updates. Call after creating a run. */
  const startPolling = useCallback((runId: string) => {
    stopPolling();
    pollingSlowedRef.current = false;

    const localGates = getInitialGates();

    const pollFn = async () => {
      try {
        const updatedRun = await getPipelineRun(runId);

        setState((prev) => ({ ...prev, pipelineRun: updatedRun }));

        if (updatedRun.gates && updatedRun.gates.length > 0) {
          const mappedGates = updatedRun.gates.map((g) =>
            mapPipelineGateToSecurityGate(g, updatedRun.findings || [], localGates)
          );
          setState((prev) => ({ ...prev, gates: mappedGates }));
        }

        // Auto-advance to completion when deployed
        if (updatedRun.status === 'deployed') {
          stopPolling();
          setState((prev) => ({
            ...prev,
            isPipelineRunning: false,
            deployedUrl: updatedRun.deployed_url || prev.deployedUrl,
            currentStep: 7,
          }));
          return;
        }

        // Stop polling entirely on terminal states
        if (isTerminalStatus(updatedRun.status)) {
          stopPolling();
          setState((prev) => ({ ...prev, isPipelineRunning: false }));
          return;
        }

        // Slow down polling after automated gates finish (for ISSM review, signing, deploy)
        if (areAutomatedGatesDone(updatedRun.gates) && !pollingSlowedRef.current) {
          pollingSlowedRef.current = true;
          setState((prev) => ({ ...prev, isPipelineRunning: false }));
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = setInterval(pollFn, 10000); // 10s for manual gates
          }
        }
      } catch {
        // Polling error -- keep trying silently
      }
    };

    pollingRef.current = setInterval(pollFn, 3000);
  }, [stopPolling, setState]);

  /** Retry a failed pipeline run: creates a new run and starts polling it. */
  const retryPipeline = useCallback(async (pipelineRunId: string) => {
    stopPolling();
    try {
      const newRun = await apiRetryPipelineRun(pipelineRunId);
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

      // Start polling for updates
      startPolling(newRun.id);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to retry pipeline',
      }));
    }
  }, [stopPolling, startPolling, setState]);

  return {
    startPolling,
    stopPolling,
    retryPipeline,
  };
}
