import { apiFetch, apiFetchText } from './client';
import type {
  ClusterNodeDetail,
  ClusterPod,
  PodDetail,
  ClusterEvent,
  Namespace,
  TopPod,
  Deployment,
} from '../types/api';

export function fetchNodes(): Promise<ClusterNodeDetail[]> {
  return apiFetch<ClusterNodeDetail[]>('/api/cluster/nodes');
}

export function fetchPods(namespace?: string, search?: string, status?: string): Promise<ClusterPod[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  const qs = params.toString();
  return apiFetch<ClusterPod[]>('/api/cluster/pods' + (qs ? '?' + qs : ''));
}

export function fetchPodDetail(namespace: string, name: string): Promise<PodDetail> {
  return apiFetch<PodDetail>('/api/cluster/pods/' + namespace + '/' + name);
}

export function fetchPodLogs(
  namespace: string,
  name: string,
  container?: string,
  tailLines?: number,
  previous?: boolean,
): Promise<string> {
  const params = new URLSearchParams();
  if (container) params.set('container', container);
  if (tailLines) params.set('tailLines', String(tailLines));
  if (previous) params.set('previous', 'true');
  const qs = params.toString();
  return apiFetchText('/api/cluster/pods/' + namespace + '/' + name + '/logs' + (qs ? '?' + qs : ''));
}

export function fetchEvents(namespace?: string, type?: string): Promise<ClusterEvent[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  if (type) params.set('type', type);
  const qs = params.toString();
  return apiFetch<ClusterEvent[]>('/api/cluster/events' + (qs ? '?' + qs : ''));
}

export function fetchNamespaces(): Promise<Namespace[]> {
  return apiFetch<Namespace[]>('/api/cluster/namespaces');
}

export function fetchTopPods(sortBy?: string, limit?: number): Promise<TopPod[]> {
  const params = new URLSearchParams();
  if (sortBy) params.set('sortBy', sortBy);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiFetch<TopPod[]>('/api/cluster/top/pods' + (qs ? '?' + qs : ''));
}

export function fetchDeployments(namespace?: string): Promise<Deployment[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  const qs = params.toString();
  return apiFetch<Deployment[]>('/api/cluster/deployments' + (qs ? '?' + qs : ''));
}

export function restartDeployment(namespace: string, name: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/cluster/deployments/' + namespace + '/' + name + '/restart', { method: 'POST' });
}

export function scaleDeployment(namespace: string, name: string, replicas: number): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/cluster/deployments/' + namespace + '/' + name + '/scale', {
    method: 'PATCH',
    body: JSON.stringify({ replicas }),
  });
}

export function deletePod(namespace: string, name: string): Promise<{ ok: boolean; message: string }> {
  return apiFetch('/api/cluster/pods/' + namespace + '/' + name, { method: 'DELETE' });
}

export function cordonNode(name: string, cordon: boolean): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/cluster/nodes/' + name + '/cordon', {
    method: 'POST',
    body: JSON.stringify({ cordon }),
  });
}
