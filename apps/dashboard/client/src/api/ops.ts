import { apiFetch } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpsProbeConfig {
  type: 'http' | 'tcp' | 'exec';
  path: string;
  port: number;
  initialDelaySeconds: number;
  periodSeconds: number;
  failureThreshold: number;
}

export interface OpsConfig {
  // Security context
  runAsRoot: boolean;
  writableFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
  privileged: boolean;
  capabilities: string[];

  // Container settings
  port: number;
  imageTag: string;
  replicas: number;
  env: { name: string; value: string }[];

  // Resources
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;

  // Health probes
  livenessProbe: OpsProbeConfig;
  readinessProbe: OpsProbeConfig;

  // Networking
  ingressHost: string;
  backendProtocol: 'HTTP' | 'HTTPS';
}

export interface OpsPodStatus {
  name: string;
  phase: string;
  ready: boolean;
  readyContainers: number;
  totalContainers: number;
  restarts: number;
  age: string;
  node: string;
  ip: string;
  containers: string[];
}

export interface OpsEvent {
  type: string;
  reason: string;
  message: string;
  age: string;
  firstSeen: string;
  count: number;
  namespace: string;
  object: string;
}

export interface OpsResourceUsage {
  cpu: { request: string; limit: string; used: string | null; pct: number | null };
  memory: { request: string; limit: string; used: string | null; pct: number | null };
}

export interface OpsPolicyException {
  name: string;
  policy: string;
  reason: string;
  createdAt: string;
}

export interface OpsDiagnostics {
  app: {
    name: string;
    namespace: string;
    image: string;
    tag: string;
    status: string;
    uptime: string;
    restartCount: number;
  };
  pods: OpsPodStatus[];
  events: OpsEvent[];
  resources: OpsResourceUsage | null;
  config: OpsConfig;
  policyExceptions: OpsPolicyException[];
  helmReleaseYaml: string;
}

export interface OpsCapabilitiesResponse {
  capabilities: string[];
}

export interface OpsAvailableTags {
  tags: string[];
}

// ── API Functions ─────────────────────────────────────────────────────────────

export async function fetchOpsDiagnostics(namespace: string, name: string): Promise<OpsDiagnostics> {
  // The backend returns a flat shape; transform to OpsDiagnostics
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch(
    `/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  );

  const hr = raw.helmRelease || {};
  const values = hr.values || {};
  const appVals = values.app || {};
  const img = raw.image || appVals.image || {};
  const pods = (raw.pods || []) as OpsPodStatus[];
  const sec = raw.security || {};
  const podSc = sec.podSecurityContext || {};
  const ctrSc = sec.containerSecurityContext || {};
  const probes = raw.probes || {};
  const res = raw.resources || {};
  const allEvents = [
    ...((raw.events?.warning || []) as OpsEvent[]),
    ...((raw.events?.normal || []) as OpsEvent[]),
    ...((raw.policyViolations || []) as OpsEvent[]),
  ];

  // Derive status from HR + pods
  const isReady = hr.ready === true;
  const hasCrash = pods.some((p: OpsPodStatus) => !p.ready && p.restarts > 2);
  const status = isReady && !hasCrash ? 'running' : hasCrash ? 'failed' : hr.reason === 'InstallFailed' || hr.reason === 'UpgradeFailed' ? 'failed' : 'deploying';

  const totalRestarts = pods.reduce((s: number, p: OpsPodStatus) => s + (p.restarts || 0), 0);

  return {
    app: {
      name: hr.name || name,
      namespace: hr.namespace || namespace,
      image: img.repository || '',
      tag: img.tag || '',
      status,
      uptime: pods[0]?.age || '',
      restartCount: totalRestarts,
    },
    pods,
    events: allEvents,
    resources: res.cpu ? res : null,
    config: {
      runAsRoot: podSc.runAsUser === 0 || podSc.runAsNonRoot === false,
      writableFilesystem: ctrSc.readOnlyRootFilesystem === false,
      allowPrivilegeEscalation: ctrSc.allowPrivilegeEscalation === true,
      privileged: ctrSc.privileged === true,
      capabilities: ctrSc.capabilities?.add || [],
      port: appVals.port || 8080,
      imageTag: img.tag || '',
      replicas: appVals.replicas || 2,
      env: appVals.env || [],
      cpuRequest: appVals.resources?.requests?.cpu || '100m',
      cpuLimit: appVals.resources?.limits?.cpu || '500m',
      memoryRequest: appVals.resources?.requests?.memory || '128Mi',
      memoryLimit: appVals.resources?.limits?.memory || '512Mi',
      livenessProbe: probes.liveness || { type: 'tcp', path: '/', port: 8080, initialDelaySeconds: 10, periodSeconds: 10, failureThreshold: 3 },
      readinessProbe: probes.readiness || { type: 'tcp', path: '/', port: 8080, initialDelaySeconds: 5, periodSeconds: 5, failureThreshold: 3 },
      ingressHost: raw.network?.ingressHost || '',
      backendProtocol: values.ingress?.backendProtocol || 'HTTP',
    },
    policyExceptions: (sec.exceptions || []).map((e: Record<string, unknown>) => ({
      name: e.name as string,
      policy: ((e.exceptions as Array<{policyName: string}>) || []).map(x => x.policyName).join(', '),
      reason: e.reason as string || '',
      createdAt: '',
    })),
    helmReleaseYaml: JSON.stringify(hr, null, 2),
  };
}

export function patchOpsConfig(
  namespace: string,
  name: string,
  config: Partial<OpsConfig>
): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/config`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
}

export function restartApp(
  namespace: string,
  name: string
): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, {
    method: 'POST',
  });
}

export function fetchOpsCapabilities(): Promise<OpsCapabilitiesResponse> {
  return apiFetch<OpsCapabilitiesResponse>('/api/ops/capabilities');
}

export function fetchAvailableTags(
  namespace: string,
  name: string
): Promise<OpsAvailableTags> {
  return apiFetch<OpsAvailableTags>(
    `/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tags`
  );
}

/** Returns an EventSource for real-time SSE log streaming. */
export function openLogStream(
  namespace: string,
  name: string,
  pod: string,
  container: string
): EventSource {
  const params = new URLSearchParams({ pod, container });
  return new EventSource(
    `/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs?${params}`
  );
}
