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

export function fetchOpsDiagnostics(namespace: string, name: string): Promise<OpsDiagnostics> {
  return apiFetch<OpsDiagnostics>(
    `/api/ops/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  );
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
