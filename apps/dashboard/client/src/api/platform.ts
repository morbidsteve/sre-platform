import { apiFetch } from './client';

// ── Platform Overview ────────────────────────────────────────────────────────

export interface PlatformNode {
  name: string;
  status: string; // "Ready" | "NotReady"
  roles: string[] | string;
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

// Backend returns shapes that may be wrapped in objects — unwrap to match frontend types

export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/overview');
  // Transform backend shape to PlatformOverview
  const nodes = (raw.nodes || []) as PlatformNode[];
  const flux = raw.fluxStatus || {};
  const totals = raw.clusterTotals || {};
  return {
    clusterName: 'SRE Platform',
    nodeCount: nodes.length,
    podCount: totals.pods?.total ?? 0,
    namespaceCount: totals.namespaces ?? 0,
    fluxSynced: (flux.kustomizations || []).every((k: FluxKustomization) => k.ready),
    fluxLastSync: '',
    nodes,
    services: [], // populated separately
  };
}

export async function fetchPlatformFlux(): Promise<FluxStatus> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/flux');
  const ks = raw.kustomizations || [];
  const hr = raw.helmReleases || [];
  return {
    kustomizations: ks,
    helmReleases: hr,
    syncedCount: ks.filter((k: FluxKustomization) => k.ready).length + hr.filter((h: FluxHelmRelease) => h.ready).length,
    totalCount: ks.length + hr.length,
  };
}

export async function fetchPlatformPods(namespace?: string, status?: string, search?: string): Promise<PlatformPod[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const qs = params.toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/pods' + (qs ? '?' + qs : ''));
  // Backend returns {pods: [...], total, limit, offset} — unwrap
  return Array.isArray(raw) ? raw : (raw.pods || []);
}

export async function fetchPlatformEvents(namespace?: string): Promise<PlatformEvent[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  params.set('type', 'Warning');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/events?' + params.toString());
  return Array.isArray(raw) ? raw : (raw.events || []);
}

export async function fetchPlatformCertificates(): Promise<PlatformCertificate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/certificates');
  return Array.isArray(raw) ? raw : (raw.certificates || []);
}

export async function fetchPlatformPolicies(): Promise<PlatformPolicy[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await apiFetch('/api/platform/policies');
  return Array.isArray(raw) ? raw : (raw.policies || []);
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
