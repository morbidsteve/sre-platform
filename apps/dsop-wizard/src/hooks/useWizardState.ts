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
  EasyConfig,
  BundleBuilderConfig,
  BundleManifest,
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

const initialEasyConfig: EasyConfig = {
  appName: '',
  team: 'team-alpha',
  image: '',
  appType: 'web-app',
  port: 8080,
  resources: 'small',
  ingress: '',
  database: { enabled: false, size: 'small' },
  redis: { enabled: false, size: 'small' },
  sso: false,
  storage: false,
  env: [],
};

const initialBundleBuilderConfig: BundleBuilderConfig = {
  name: '',
  version: '',
  author: '',
  email: '',
  description: '',
  appType: 'web-app',
  port: 8080,
  resources: 'small',
  ingress: '',
  probes: { liveness: '/healthz', readiness: '/readyz' },
  primaryImageFile: null,
  components: [],
  database: { enabled: false, size: 'small' },
  redis: { enabled: false, size: 'small' },
  sso: false,
  storage: false,
  env: [],
  sourceIncluded: false,
  sourceFile: null,
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
  mode: null,
  easyConfig: initialEasyConfig,
  easyPrUrl: null,
  bundleBuilderConfig: initialBundleBuilderConfig,
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
      mode: state.mode,
      easyConfig: state.easyConfig,
      easyPrUrl: state.easyPrUrl,
      bundleBuilderConfig: state.bundleBuilderConfig,
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

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ── Run recoverability ──

/**
 * A run is NOT recoverable (should never be auto-resumed) when:
 *  - status is 'failed' AND at least one gate has the "no job reference" message
 *    (meaning the dashboard restarted mid-scan and lost all K8s job references)
 *  - status is 'rejected' (ISSM rejected — the user must start fresh)
 *
 * A run IS resumable (offer a Resume / Start New choice) when:
 *  - status is 'scanning', 'review_pending', 'approved', 'deploying', or 'returned'
 *
 * A run is treated as "completed history" (just show fresh wizard) when:
 *  - status is 'deployed' or 'undeployed'
 */
export function classifyStoredRun(run: { status: string; gates?: Array<{ summary?: string | null }> }): 'unrecoverable' | 'resumable' | 'completed' | 'fresh' {
  const { status, gates = [] } = run;

  // Terminal failure — dashboard restarted and lost job refs
  const hasNoJobRef = gates.some(
    (g) => typeof g.summary === 'string' && g.summary.includes('no job reference to recover')
  );
  if (status === 'failed' && hasNoJobRef) return 'unrecoverable';

  // ISSM rejected — must start fresh
  if (status === 'rejected') return 'unrecoverable';

  // Already deployed or explicitly undeployed — nothing to resume, start fresh
  if (status === 'deployed' || status === 'undeployed') return 'completed';

  // Active / in-progress states worth offering a resume for
  if (
    status === 'scanning' ||
    status === 'review_pending' ||
    status === 'approved' ||
    status === 'deploying' ||
    status === 'returned' ||
    status === 'failed'   // failed but NOT the no-job-ref case — may be retryable
  ) return 'resumable';

  // pending or anything else — treat as resumable
  return 'resumable';
}

// ── Hook ──

/** Shape of a pending resume prompt shown to the user */
export interface ResumePromptData {
  runId: string;
  appName: string;
  status: string;
  createdAt: string;
}

export function useWizardState() {
  const [state, setState] = useState<WizardState>(() => {
    const saved = loadSession();
    if (saved) {
      return { ...initialState, ...saved, gates: getInitialGates(), deploySteps: getInitialDeploySteps() };
    }
    return initialState;
  });
  const [user, setUser] = useState<{ name: string; email: string; groups: string[] } | null>(null);
  // Holds run metadata while we ask the user "Resume or Start New?"
  const [resumePrompt, setResumePrompt] = useState<ResumePromptData | null>(null);

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

    if (!runIdToLoad) return;

    getPipelineRun(runIdToLoad).then((run) => {
      const classification = classifyStoredRun(run);

      // ── Unrecoverable: clear session and start fresh silently ──
      if (classification === 'unrecoverable') {
        clearSession();
        setState(initialState);
        if (urlRunId) window.history.replaceState({}, '', window.location.pathname);
        return;
      }

      // ── Completed runs from session: clear and start fresh ──
      // But if opened via URL link (?runId=), show the results instead of discarding
      if (classification === 'completed' && !urlRunId) {
        clearSession();
        setState(initialState);
        return;
      }

      // ── URL-linked run: auto-resume/view without prompting ──
      if (urlRunId) {
        const mappedGates = run.gates.map((g: PipelineGate) =>
          mapPipelineGateToSecurityGate(g, run.findings, getInitialGates())
        );
        const isDeployedStatus = run.status === 'deployed' || (run.status as string).startsWith('deployed_');
        const step = isDeployedStatus ? 7 :
                     run.status === 'deploying' ? 6 :
                     run.status === 'approved' || run.status === 'review_pending' || run.status === 'rejected' ? 5 :
                     run.status === 'failed' ? 4 :
                     4;
        setState((prev) => ({
          ...prev,
          mode: 'full' as const,
          pipelineRunId: run.id,
          pipelineRun: run,
          gates: mappedGates,
          currentStep: step,
          deployedUrl: run.deployed_url || prev.deployedUrl,
          appInfo: {
            ...prev.appInfo,
            name: run.app_name || prev.appInfo.name,
            team: run.team || prev.appInfo.team,
            classification: (run.classification || prev.appInfo.classification) as Classification,
          },
          source: {
            ...prev.source,
            gitUrl: run.git_url || prev.source.gitUrl,
            branch: run.branch || prev.source.branch,
            imageUrl: run.image_url || prev.source.imageUrl,
            type: run.source_type === 'bundle' ? 'bundle' : run.source_type === 'image' ? 'container' : 'git',
          },
        }));
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }

      // ── Resumable session run: ask the user what to do ──
      setResumePrompt({
        runId: run.id,
        appName: run.app_name || 'Unknown app',
        status: run.status,
        createdAt: run.created_at,
      });
    }).catch(() => {
      // Run was deleted or API unreachable — clear stale session and start fresh
      clearSession();
      setState(initialState);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** User chose to resume the previous run */
  const confirmResume = useCallback(async () => {
    if (!resumePrompt) return;
    try {
      const run = await getPipelineRun(resumePrompt.runId);
      const mappedGates = run.gates.map((g: PipelineGate) =>
        mapPipelineGateToSecurityGate(g, run.findings, getInitialGates())
      );
      const step = run.status === 'deployed' ? 7 :
                   run.status === 'deploying' ? 6 :
                   run.status === 'approved' || run.status === 'review_pending' || run.status === 'rejected' ? 5 :
                   4;
      setState((prev) => ({
        ...prev,
        mode: 'full' as const,
        pipelineRunId: run.id,
        pipelineRun: run,
        gates: mappedGates,
        currentStep: step,
        appInfo: {
          ...prev.appInfo,
          name: run.app_name || prev.appInfo.name,
          team: run.team || prev.appInfo.team,
          classification: (run.classification || prev.appInfo.classification) as Classification,
        },
        source: {
          ...prev.source,
          gitUrl: run.git_url || prev.source.gitUrl,
          branch: run.branch || prev.source.branch,
          imageUrl: run.image_url || prev.source.imageUrl,
          type: run.source_type === 'bundle' ? 'bundle' : run.source_type === 'image' ? 'container' : 'git',
        },
      }));
    } catch {
      // Run gone — start fresh
      clearSession();
      setState(initialState);
    } finally {
      setResumePrompt(null);
    }
  }, [resumePrompt]);

  /** Load a specific run by ID (for resume from launcher without page reload) */
  const loadRunById = useCallback(async (runId: string) => {
    try {
      const run = await getPipelineRun(runId);
      const mappedGates = run.gates.map((g: PipelineGate) =>
        mapPipelineGateToSecurityGate(g, run.findings, getInitialGates())
      );
      const isDeployedStatus = run.status === 'deployed' || (run.status as string).startsWith('deployed_');
      const step = isDeployedStatus ? 7 :
                   run.status === 'deploying' ? 6 :
                   run.status === 'approved' || run.status === 'review_pending' || run.status === 'rejected' ? 5 :
                   4;
      setState((prev) => ({
        ...prev,
        mode: 'full' as const,
        pipelineRunId: run.id,
        pipelineRun: run,
        gates: mappedGates,
        currentStep: step,
        appInfo: {
          ...prev.appInfo,
          name: run.app_name || prev.appInfo.name,
          team: run.team || prev.appInfo.team,
          classification: (run.classification || prev.appInfo.classification) as Classification,
        },
        source: {
          ...prev.source,
          gitUrl: run.git_url || prev.source.gitUrl,
          branch: run.branch || prev.source.branch,
          imageUrl: run.image_url || prev.source.imageUrl,
          type: run.source_type === 'bundle' ? 'bundle' : run.source_type === 'image' ? 'container' : 'git',
        },
      }));
    } catch {
      clearSession();
      setState(initialState);
    }
  }, []);

  /** User chose to discard the previous run and start fresh */
  const discardAndStartNew = useCallback(() => {
    clearSession();
    setState(initialState);
    setResumePrompt(null);
  }, []);

  // ── Auto-resume deploy polling when mounting with a deploying run ──
  // If we land on step 6 with a pipelineRunId (via resume or URL link),
  // we need to start polling for deploy status updates.
  useEffect(() => {
    if (state.currentStep !== 6 || !state.pipelineRunId || state.isDeploying) return;

    // Check if the run is still deploying
    getPipelineRun(state.pipelineRunId).then((run) => {
      if (run.status === 'deploying') {
        setState((prev) => ({
          ...prev,
          isDeploying: true,
          pipelineRun: run,
          deploySteps: getInitialDeploySteps().map((s, i) =>
            i === 0 ? { ...s, status: 'running' as const } : s
          ),
        }));

        // Start polling for completion
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

            if (updatedRun.status === 'deployed' || (updatedRun.status as string).startsWith('deployed_')) {
              clearInterval(deployPoll);
              setState((prev) => ({
                ...prev,
                deploySteps: steps.map((s) => ({ ...s, status: 'completed' as const })),
                deployedUrl: updatedRun.deployed_url || `https://${state.appInfo.name || 'my-app'}.${getConfig().domain}`,
                isDeploying: false,
                currentStep: 7,
              }));
            } else if (updatedRun.status === 'failed') {
              clearInterval(deployPoll);
              setState((prev) => ({
                ...prev,
                deploySteps: updatedSteps.map((s) =>
                  s.status === 'running' ? { ...s, status: 'failed' as const } : s
                ),
                isDeploying: false,
                error: 'Deployment failed — check pipeline history for details',
              }));
            }
          } catch {
            // Keep polling
          }
        }, 3000);

        return () => clearInterval(deployPoll);
      } else if (run.status === 'deployed' || (run.status as string).startsWith('deployed_')) {
        // Already finished — jump to complete step
        setState((prev) => ({
          ...prev,
          pipelineRun: run,
          deploySteps: getInitialDeploySteps().map((s) => ({ ...s, status: 'completed' as const })),
          deployedUrl: run.deployed_url || `https://${state.appInfo.name || 'my-app'}.${getConfig().domain}`,
          isDeploying: false,
          currentStep: 7,
        }));
      } else if (run.status === 'failed') {
        setState((prev) => ({
          ...prev,
          pipelineRun: run,
          isDeploying: false,
          error: 'Deployment failed — check pipeline history for details',
        }));
      }
    }).catch(() => {
      // Run gone — can't resume
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, state.pipelineRunId]);

  const isAdmin = user
    ? user.groups.some((g) => g === 'sre-admins' || g === 'issm')
    : false;

  // ── Step navigation ──

  const setStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step, error: null }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, currentStep: prev.currentStep + 1, error: null };

      // Pre-fill appInfo from bundle manifest when moving from Step 1 (source) to Step 2 (appInfo)
      if (prev.currentStep === 1 && prev.source.type === 'bundle' && prev.source.bundleManifest) {
        const bm = prev.source.bundleManifest;
        const spec = bm.spec || {};
        const app = spec.app || {};
        const security = spec.security || {};

        next.appInfo = {
          ...prev.appInfo,
          name: bm.metadata?.name || prev.appInfo.name,
          description: bm.metadata?.description || prev.appInfo.description,
          team: bm.metadata?.team || prev.appInfo.team,
          classification: (spec.classification as Classification) || prev.appInfo.classification,
          contact: bm.metadata?.author || prev.appInfo.contact,
        };

        // Auto-enable security exceptions from bundle manifest
        // Create exception objects (the array starts empty — we must add, not just toggle)
        const bundleExceptions: SecurityException[] = [];
        if (security.runAsNonRoot === false) {
          bundleExceptions.push({ type: 'run_as_root', enabled: true, justification: 'Specified in deployment bundle manifest' });
        }
        if (security.readOnlyRootFilesystem === false) {
          bundleExceptions.push({ type: 'writable_filesystem', enabled: true, justification: 'Specified in deployment bundle manifest' });
        }
        if (bundleExceptions.length > 0) {
          // Merge with any existing exceptions, avoiding duplicates
          const existingTypes = new Set(prev.securityExceptions.map(e => e.type));
          next.securityExceptions = [
            ...prev.securityExceptions,
            ...bundleExceptions.filter(e => !existingTypes.has(e.type)),
          ];
        }
      }

      return next;
    });
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
      let detection: DetectionResult;

      if (state.source.type === 'bundle' && state.source.bundleManifest) {
        // For bundles, construct detection from the manifest
        const manifest = state.source.bundleManifest;
        const services = [
          {
            name: manifest.metadata.name,
            image: manifest.spec.app.image,
            port: manifest.spec.app.port || 8080,
            type: 'application' as const,
          },
          ...(manifest.spec.components || []).map((c) => ({
            name: c.name,
            image: c.image,
            port: null,
            type: 'application' as const,
          })),
        ];
        const platformServices = [];
        if (manifest.spec.services?.database?.enabled) platformServices.push({ detected: 'PostgreSQL', mappedTo: 'CNPG', icon: 'Database' });
        if (manifest.spec.services?.redis?.enabled) platformServices.push({ detected: 'Redis', mappedTo: 'Redis', icon: 'Zap' });
        if (manifest.spec.services?.sso?.enabled) platformServices.push({ detected: 'SSO', mappedTo: 'Keycloak', icon: 'Shield' });
        if (manifest.spec.services?.storage?.enabled) platformServices.push({ detected: 'Object Storage', mappedTo: 'MinIO', icon: 'HardDrive' });
        const externalAccess = (manifest.spec.externalApis || []).map((host) => ({ service: host, hostname: host }));

        detection = {
          repoType: 'container' as const,
          services,
          platformServices,
          externalAccess,
        };
      } else {
        detection = await analyzeSource(state.source);
      }

      // Capture manifest ref for appInfo pre-fill in the bundle case
      const bundleManifest = state.source.type === 'bundle' ? state.source.bundleManifest : undefined;

      setState((prev) => {
        // Auto-enable security exceptions based on detected requirements
        const reqs = detection.detectedRequirements || detection.services?.[0]?.requirements;
        let autoExceptions = prev.securityExceptions;
        if (reqs) {
          autoExceptions = prev.securityExceptions.map((exc) => {
            if (exc.type === 'privileged_container' && reqs.needsPrivileged) {
              return { ...exc, enabled: true, justification: reqs.detectedFrom?.join('; ') || 'Auto-detected from repository analysis' };
            }
            if (exc.type === 'run_as_root' && reqs.needsRoot) {
              return { ...exc, enabled: true, justification: reqs.detectedFrom?.join('; ') || 'Auto-detected from repository analysis' };
            }
            if (exc.type === 'writable_filesystem' && reqs.needsWritableFs) {
              return { ...exc, enabled: true, justification: reqs.detectedFrom?.join('; ') || 'Auto-detected from repository analysis' };
            }
            return exc;
          });
        }

        return {
          ...prev,
          detection,
          securityExceptions: autoExceptions,
          isAnalyzing: false,
          currentStep: 3,
          // Pre-fill appInfo from bundle manifest when available
          ...(bundleManifest ? {
            appInfo: {
              ...prev.appInfo,
              name: prev.appInfo.name || bundleManifest.metadata.name,
              description: prev.appInfo.description || bundleManifest.metadata.description || '',
              team: bundleManifest.metadata.team || prev.appInfo.team,
              classification: (bundleManifest.spec.classification as Classification) || prev.appInfo.classification,
              contact: bundleManifest.metadata.author || prev.appInfo.contact,
            },
          } : {}),
        };
      });
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

  // Bulk update all findings for a gate in one setState call
  const bulkUpdateAllFindings = useCallback((gateId: number, updates: Partial<GateFinding>) => {
    setState((prev) => ({
      ...prev,
      gates: prev.gates.map((g) => {
        if (g.id !== gateId) return g;
        return {
          ...g,
          findings: g.findings.map((f) => ({ ...f, ...updates })),
        };
      }),
    }));
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
      // Build security context from enabled exceptions so deploy applies the right pod spec
      const enabledExcs = state.securityExceptions.filter((e) => e.enabled);
      const scOverride: Record<string, unknown> = {};
      for (const ex of enabledExcs) {
        if (ex.type === 'privileged_container') { scOverride.privileged = true; scOverride.runAsRoot = true; }
        if (ex.type === 'run_as_root') scOverride.runAsRoot = true;
        if (ex.type === 'writable_filesystem') scOverride.writableFilesystem = true;
        if (ex.type === 'host_networking') scOverride.hostNetworking = true;
      }

      const run = await createPipelineRun({
        appName: state.appInfo.name || 'my-app',
        gitUrl: state.source.gitUrl,
        branch: state.source.branch || 'main',
        imageUrl: state.source.imageUrl,
        sourceType: state.source.type,
        team: state.appInfo.team || 'team-alpha',
        classification: state.appInfo.classification,
        contact: state.appInfo.contact,
        securityContext: Object.keys(scOverride).length > 0 ? scOverride : undefined,
        bundleUploadId: state.source.bundleUploadId,
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
        // Pipeline deploy failed — report error, do NOT fall through to legacy /deploy/git
        setState((prev) => ({
          ...prev,
          isDeploying: false,
          error: err instanceof Error ? err.message : 'Deployment failed',
        }));
      }
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
    clearSession();
    setState(initialState);
    setResumePrompt(null);
    // Clear runId from URL
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('runId');
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
  }, []);

  // ── Easy mode methods ──

  const setMode = useCallback((mode: 'full' | 'easy' | 'bundle') => {
    setState((prev) => {
      const next = { ...prev, mode, currentStep: 1 };
      saveSession(next);
      return next;
    });
  }, []);

  const updateEasyConfig = useCallback((updates: Partial<EasyConfig>) => {
    setState((prev) => {
      const next = { ...prev, easyConfig: { ...prev.easyConfig, ...updates } };
      saveSession(next);
      return next;
    });
  }, []);

  const updateBundleBuilderConfig = useCallback((updates: Partial<BundleBuilderConfig>) => {
    setState((prev) => {
      const next = { ...prev, bundleBuilderConfig: { ...prev.bundleBuilderConfig, ...updates } };
      saveSession(next);
      return next;
    });
  }, []);

  const submitEasyDeploy = useCallback(async () => {
    setState((prev) => ({ ...prev, isDeploying: true, error: null }));
    try {
      const cfg = state.easyConfig;
      const dashboardApi = `https://dashboard.${(window as any).__SRE_CONFIG__?.domain || 'apps.sre.example.com'}/api`;
      const response = await fetch(`${dashboardApi}/portal/deploy`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: cfg.appName,
          appType: cfg.appType,
          image: cfg.image,
          port: cfg.port,
          team: cfg.team,
          resources: cfg.resources,
          ingress: cfg.ingress || undefined,
          database: cfg.database.enabled ? { enabled: true, size: cfg.database.size } : undefined,
          redis: cfg.redis.enabled ? { enabled: true, size: cfg.redis.size } : undefined,
          sso: cfg.sso || undefined,
          storage: cfg.storage || undefined,
          env: cfg.env.filter((e) => e.name.trim()).length > 0
            ? cfg.env.filter((e) => e.name.trim())
            : undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body.error as string) || `HTTP ${response.status}`);
      }
      const data = await response.json() as { success: boolean; prUrl?: string };
      setState((prev) => {
        const next = {
          ...prev,
          isDeploying: false,
          easyPrUrl: data.prUrl || null,
          deployedUrl: data.prUrl || null,
        };
        saveSession(next);
        return next;
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isDeploying: false,
        error: err instanceof Error ? err.message : 'Deploy failed',
      }));
    }
  }, [state.easyConfig]);

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
    bulkUpdateAllFindings,
    overrideGate,
    submitForReview,
    deploy,
    reviewPipelineRun,
    refreshPipelineRun,
    downloadPackage,
    reset,
    // Resume / start-new prompt
    resumePrompt,
    confirmResume,
    discardAndStartNew,
    loadRunById,
    // Easy mode
    setMode,
    updateEasyConfig,
    submitEasyDeploy,
    // Bundle builder mode
    updateBundleBuilderConfig,
  };
}
