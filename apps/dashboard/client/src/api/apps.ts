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
