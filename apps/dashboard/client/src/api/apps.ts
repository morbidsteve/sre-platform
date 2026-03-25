import { apiFetch } from './client';
import type {
  AppsResponse,
  SamplesResponse,
  DeployRequest,
  DeployResponse,
  HelmDeployRequest,
  GitDeployRequest,
  GitDeployResponse,
  FromBuildDeployRequest,
  DeployStatus,
  BuildStatus,
  DatabaseRequest,
  Database,
  RollbackHistoryResponse,
  RollbackResponse,
  PolicyViolationsResponse,
  QuotaResponse,
  ManifestResponse,
} from '../types/api';

export function fetchApps(): Promise<AppsResponse> {
  return apiFetch<AppsResponse>('/api/apps');
}

export function fetchSamples(): Promise<SamplesResponse> {
  return apiFetch<SamplesResponse>('/api/samples');
}

export function deployApp(req: DeployRequest): Promise<DeployResponse> {
  return apiFetch<DeployResponse>('/api/deploy', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function deployHelmChart(req: HelmDeployRequest): Promise<DeployResponse> {
  return apiFetch<DeployResponse>('/api/deploy/helm-chart', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function deployFromGit(req: GitDeployRequest): Promise<GitDeployResponse> {
  return apiFetch<GitDeployResponse>('/api/deploy/git', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function deployFromBuild(req: FromBuildDeployRequest): Promise<DeployResponse> {
  return apiFetch<DeployResponse>('/api/deploy/from-build', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function deleteApp(namespace: string, name: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/deploy/' + namespace + '/' + name, { method: 'DELETE' });
}

export function fetchDeployStatus(namespace: string, name: string): Promise<DeployStatus> {
  return apiFetch<DeployStatus>('/api/deploy/' + namespace + '/' + name + '/status');
}

export function fetchBuildStatus(id: string): Promise<BuildStatus> {
  return apiFetch<BuildStatus>('/api/build/' + id + '/status');
}

export function fetchBuildLogs(id: string): EventSource {
  return new EventSource('/api/build/' + id + '/logs');
}

export function createDatabase(req: DatabaseRequest): Promise<{ success: boolean; message: string; namespace: string }> {
  return apiFetch('/api/databases', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function fetchDatabases(): Promise<Database[]> {
  return apiFetch<Database[]>('/api/databases');
}

export function deleteDatabase(namespace: string, name: string): Promise<{ success: boolean }> {
  return apiFetch('/api/databases/' + namespace + '/' + name, { method: 'DELETE' });
}

// ── Rollback ───────────────────────────────────────────────────────────────

export function fetchRollbackHistory(namespace: string, name: string): Promise<RollbackHistoryResponse> {
  return apiFetch<RollbackHistoryResponse>('/api/apps/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name) + '/rollback', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function rollbackApp(namespace: string, name: string, revision: number): Promise<RollbackResponse> {
  return apiFetch<RollbackResponse>('/api/apps/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name) + '/rollback', {
    method: 'POST',
    body: JSON.stringify({ revision }),
  });
}

// ── Policy Violations ──────────────────────────────────────────────────────

export function fetchPolicyViolations(namespace?: string): Promise<PolicyViolationsResponse> {
  const query = namespace ? '?namespace=' + encodeURIComponent(namespace) : '';
  return apiFetch<PolicyViolationsResponse>('/api/security/policy-violations' + query);
}

// ── Resource Quota ─────────────────────────────────────────────────────────

export function fetchNamespaceQuota(namespace: string): Promise<QuotaResponse> {
  return apiFetch<QuotaResponse>('/api/namespaces/' + encodeURIComponent(namespace) + '/quota');
}

// ── Manifest Export ────────────────────────────────────────────────────────

export function fetchAppManifest(namespace: string, name: string): Promise<ManifestResponse> {
  return apiFetch<ManifestResponse>('/api/apps/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(name) + '/manifest');
}
