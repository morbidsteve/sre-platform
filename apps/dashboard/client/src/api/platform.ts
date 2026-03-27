import { apiFetch } from './client';

// ── Platform Overview ────────────────────────────────────────────────────────

export interface PlatformNode {
  name: string;
  status: string; // "Ready" | "NotReady"
  roles: string[];
  ip: string;
  kubelet: string;
  os: string;
  age: string;
  cpu: { pct: number; usedFmt: string; allocFmt: string };
  memory: { pct: number; usedFmt: string; allocFmt: string };
  pods: { count: number; allocatable: number };
  conditions: { type: string; status: string; message: string }[];
  unschedulable: boolean;
}

export interface PlatformService {
  name: string;
  namespace: string;
  healthy: boolean;
  podCount: number;
  icon: string;
  description: string;
  url: string;
}

export interface PlatformOverview {
  clusterName: string;
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  fluxSynced: boolean;
  fluxLastSync: string;
  nodes: PlatformNode[];
  services: PlatformService[];
}

// ── Flux ─────────────────────────────────────────────────────────────────────

export interface FluxKustomization {
  name: string;
  namespace: string;
  ready: boolean;
  suspended: boolean;
  revision: string;
  lastMessage: string;
  age: string;
}

export interface FluxHelmRelease {
  name: string;
  namespace: string;
  ready: boolean;
  suspended: boolean;
  chart: string;
  version: string;
  revision: string;
  lastMessage: string;
  age: string;
}

export interface FluxStatus {
  kustomizations: FluxKustomization[];
  helmReleases: FluxHelmRelease[];
  syncedCount: number;
  totalCount: number;
}

// ── Pods ─────────────────────────────────────────────────────────────────────

export interface PlatformPod {
  name: string;
  namespace: string;
  status: string;
  statusReason: string;
  ready: string;
  restarts: number;
  age: string;
  node: string;
  ip: string;
  containers: string[];
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface PlatformEvent {
  type: string;
  reason: string;
  message: string;
  namespace: string;
  object: string;
  count: number;
  age: string;
  firstSeen: string;
}

// ── Certificates ─────────────────────────────────────────────────────────────

export interface PlatformCertificate {
  name: string;
  namespace: string;
  ready: boolean;
  dnsNames: string[];
  expiresAt: string;
  daysUntilExpiry: number;
  issuer: string;
}

// ── Policies ─────────────────────────────────────────────────────────────────

export interface PlatformPolicy {
  name: string;
  kind: string;
  validationFailureAction: string;
  background: boolean;
  ready: boolean;
  violationCount: number;
}

// ── API Functions ─────────────────────────────────────────────────────────────

export function fetchPlatformOverview(): Promise<PlatformOverview> {
  return apiFetch<PlatformOverview>('/api/platform/overview');
}

export function fetchPlatformFlux(): Promise<FluxStatus> {
  return apiFetch<FluxStatus>('/api/platform/flux');
}

export function fetchPlatformPods(namespace?: string, status?: string, search?: string): Promise<PlatformPod[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const qs = params.toString();
  return apiFetch<PlatformPod[]>('/api/platform/pods' + (qs ? '?' + qs : ''));
}

export function fetchPlatformEvents(namespace?: string): Promise<PlatformEvent[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  params.set('type', 'Warning');
  return apiFetch<PlatformEvent[]>('/api/platform/events?' + params.toString());
}

export function fetchPlatformCertificates(): Promise<PlatformCertificate[]> {
  return apiFetch<PlatformCertificate[]>('/api/platform/certificates');
}

export function fetchPlatformPolicies(): Promise<PlatformPolicy[]> {
  return apiFetch<PlatformPolicy[]>('/api/platform/policies');
}

export function triggerFluxReconcile(name: string, namespace: string, kind: 'kustomization' | 'helmrelease'): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/platform/flux/reconcile', {
    method: 'POST',
    body: JSON.stringify({ name, namespace, kind }),
  });
}

export function triggerFluxReconcileAll(): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/platform/flux/reconcile-all', { method: 'POST' });
}
