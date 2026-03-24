// All API response types extracted from server.js endpoints

// ── User & Auth ─────────────────────────────────────────────────────────────

export interface User {
  user: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
  role: 'admin' | 'issm' | 'developer' | 'viewer' | 'anonymous';
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface HelmRelease {
  name: string;
  namespace: string;
  ready: boolean;
  status: string;
  chart: string;
  version: string;
}

export interface ClusterNode {
  name: string;
  status: string;
  ready: boolean;
  roles: string[];
  ip: string;
  version: string;
  conditions: { type: string; status: string; message: string }[];
}

export interface ProblemPod {
  name: string;
  namespace: string;
  status: string;
  reason: string;
  restarts: number;
  age: string;
  containers: string[];
}

export interface HealthSummary {
  helmReleasesReady: number;
  helmReleasesTotal: number;
  nodesReady: number;
  nodesTotal: number;
  problemPodCount: number;
}

export interface HealthResponse {
  helmReleases: HelmRelease[];
  nodes: ClusterNode[];
  problemPods: ProblemPod[];
  summary: HealthSummary;
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface Alert {
  name: string;
  severity: string;
  state: string;
  summary: string;
  startsAt: string;
  alertname?: string;
  message?: string;
}

// ── Apps ─────────────────────────────────────────────────────────────────────

export interface App {
  name: string;
  namespace: string;
  team: string;
  ready: boolean;
  image: string;
  tag: string;
  port: number;
  host: string;
  url: string;
  created: string;
}

export interface AppsResponse {
  apps: App[];
  count: number;
}

export interface SampleApp {
  name: string;
  description: string;
  image: string;
  tag: string;
  port: number;
}

export interface SamplesResponse {
  samples: SampleApp[];
}

// ── Deploy ──────────────────────────────────────────────────────────────────

export interface DeployRequest {
  name: string;
  team: string;
  image: string;
  tag: string;
  port?: number;
  replicas?: number;
  ingress?: string;
  privileged?: boolean;
  env?: { name: string; value: string }[];
}

export interface DeployResponse {
  success: boolean;
  message: string;
  namespace: string;
  manifest?: unknown;
}

export interface HelmDeployRequest {
  repoUrl: string;
  chartName: string;
  chartVersion?: string;
  values?: string | Record<string, unknown>;
  appName: string;
  team: string;
}

export interface GitDeployRequest {
  url: string;
  branch?: string;
  team: string;
  name: string;
}

export interface GitDeployResponse {
  success: boolean;
  detectedType: string;
  strategy: string;
  buildId?: string;
  groupId?: string;
  builds?: { buildId: string; serviceName: string; destination: string; port: number; role: string }[];
  deployed?: { name: string; type: string; port?: number; image?: string }[];
  namespace: string;
  message: string;
  url?: string;
  services?: unknown[];
}

export interface FromBuildDeployRequest {
  buildId: string;
  appName: string;
  team: string;
  port?: number;
  replicas?: number;
  ingress?: string;
}

export interface DeployStatusPod {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  containers: { name: string; ready: boolean; state: string; reason: string }[];
}

export interface DeployStatusEvent {
  time: string;
  reason: string;
  message: string;
  type: string;
}

export interface DeployStatus {
  name: string;
  namespace: string;
  phase: 'pending' | 'creating' | 'running' | 'failed';
  helmRelease: { ready: boolean; message: string; lastTransition: string };
  pods: DeployStatusPod[];
  events: DeployStatusEvent[];
  progress: number;
}

// ── Build ───────────────────────────────────────────────────────────────────

export interface BuildStatus {
  buildId: string;
  status: 'pending' | 'building' | 'succeeded' | 'failed' | 'unknown';
  message: string;
  startTime: string;
  completionTime: string;
  appName: string;
  team: string;
  destination: string;
  imageRepo: string;
  imageTag: string;
}

export interface BuildLogEvent {
  type: 'status' | 'phase' | 'log' | 'error' | 'complete' | 'done';
  message?: string;
  phase?: string;
  container?: string;
  line?: string;
  status?: string;
}

export interface Build {
  buildId: string;
  appName: string;
  team: string;
  status: string;
  startTime: string;
  completionTime: string;
  destination: string;
}

// ── Database ────────────────────────────────────────────────────────────────

export interface DatabaseRequest {
  name: string;
  team: string;
  storage?: string;
  instances?: number;
  description?: string;
}

export interface Database {
  name: string;
  namespace: string;
  instances: number;
  status: string;
  ready: boolean;
  storage: string;
  phase: string;
  age: string;
  connectionSecret: string;
}

// ── Cluster ─────────────────────────────────────────────────────────────────

export interface ClusterNodeDetail {
  name: string;
  status: string;
  roles: string[];
  ip: string;
  kubelet: string;
  kernel: string;
  os: string;
  runtime: string;
  age: string;
  conditions: { type: string; status: string; message: string }[];
  unschedulable: boolean;
  cpu: { used: number; allocatable: number; usedFmt: string; allocFmt: string; pct: number };
  memory: { used: number; allocatable: number; usedFmt: string; allocFmt: string; pct: number };
  pods: { count: number; allocatable: number };
}

export interface ClusterPod {
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
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
}

export interface PodDetailContainer {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  state: string;
  stateDetail: string;
  ports: string[];
  resources: Record<string, unknown>;
}

export interface PodDetailEvent {
  type: string;
  reason: string;
  message: string;
  count: number;
  age: string;
}

export interface PodDetail {
  name: string;
  namespace: string;
  status: string;
  node: string;
  ip: string;
  serviceAccount: string;
  age: string;
  labels: Record<string, string>;
  conditions: { type: string; status: string; reason: string; message: string }[];
  containers: PodDetailContainer[];
  events: PodDetailEvent[];
}

export interface ClusterEvent {
  type: string;
  reason: string;
  message: string;
  namespace: string;
  object: string;
  count: number;
  age: string;
  firstSeen: string;
}

export interface Namespace {
  name: string;
  status: string;
  age: string;
  labels: Record<string, string>;
  pods: number;
  running: number;
  pending: number;
  failed: number;
  cpuRequests: string;
  memRequests: string;
  healthy: boolean;
}

export interface TopPod {
  name: string;
  namespace: string;
  cpu: string;
  memory: string;
  cpuRaw: number;
  memRaw: number;
}

export interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  ready: number;
  desired: number;
  age: string;
}

// ── Service Status ──────────────────────────────────────────────────────────

export interface ServiceStatus {
  name: string;
  namespace: string;
  healthy: boolean;
  url: string;
  icon: string;
  description: string;
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEvent {
  timestamp: string;
  namespace: string;
  kind: string;
  name: string;
  reason: string;
  message: string;
  type: string;
}

// ── Portal ──────────────────────────────────────────────────────────────────

export interface AppAccess {
  mode: 'everyone' | 'restricted' | 'private';
  groups: string[];
  users: string[];
  attributes: string[];
}

export interface PortalApp {
  name: string;
  displayName: string;
  description: string;
  url: string;
  icon: string;
  namespace: string;
  access: AppAccess;
  owner: string;
  deployedAt: string;
  registeredAt?: string;
  status: string;
  deployedVia?: string;
  helmReleaseName?: string;
}

export interface PortalAppsResponse {
  apps: PortalApp[];
  isAdmin: boolean;
  userGroups: string[];
}

export interface PortalGroupsResponse {
  groups: string[];
}

// ── Admin ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  createdTimestamp: number;
  groups: string[];
  attributes: Record<string, string[]>;
}

export interface AdminGroup {
  id: string;
  name: string;
  path: string;
  subGroups: AdminGroup[];
}

export interface CreateUserRequest {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  groups?: string[];
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

export interface UpdateUserRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

export interface Credential {
  service: string;
  username: string;
  password: string;
  url: string;
}

// ── Favorites ───────────────────────────────────────────────────────────────

export interface FavoritesResponse {
  favorites: string[];
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export interface PipelineFinding {
  id: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  location?: string;
  disposition?: string;
  mitigation?: string;
}

export interface PipelineGate {
  gate_id: number;
  name: string;
  short_name: string;
  status: string;
  tool: string | null;
  summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  findings: PipelineFinding[];
  findings_count: number;
  override_reason?: string;
  override_by?: string;
}

export interface PipelineReview {
  decision: string;
  reviewer: string;
  comment: string;
  reviewed_at: string;
}

export interface PipelineRun {
  id: string;
  app_name: string;
  git_url: string;
  branch: string;
  image_url: string;
  source_type: string;
  team: string;
  classification: string;
  contact: string;
  status: string;
  submitted_by: string;
  created_at: string;
  updated_at: string;
  gates: PipelineGate[];
  review?: PipelineReview;
  deployed_url?: string;
  security_exceptions?: unknown[];
}

export interface PipelineRunsResponse {
  runs: PipelineRun[];
  total: number;
  offset: number;
  limit: number;
}

export interface PipelineStats {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  running: number;
  review_pending: number;
  approved: number;
  deployed: number;
}

export interface GateOutputResponse {
  gateId: number;
  gateName: string;
  shortName: string;
  status: string;
  tool: string | null;
  summary: string | null;
  rawOutput: {
    gate?: string;
    tool?: string;
    status?: string;
    summary?: string;
    findings?: { severity: string; title: string; description?: string; location?: string }[];
    toolOutput?: unknown;
    packageCount?: number;
    format?: string;
    scannedAt?: string;
  } | null;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface DashboardConfig {
  baseUrl: string;
  loginUrl: string;
  logoutUrl: string;
  services: { name: string; icon: string; description: string; url: string }[];
}

// ── Ingress ─────────────────────────────────────────────────────────────────

export interface IngressRoute {
  host: string;
  namespace: string;
  service: string;
}

export interface IngressResponse {
  routes: IngressRoute[];
  nodeIp: string;
  httpsPort: number;
}
