/**
 * Shared types that could be used across both the DSOP Wizard and the Portal.
 * Keep these generic and backend-aligned.
 */

/** User identity from SSO / auth headers */
export interface User {
  name: string;
  email: string;
  groups: string[];
}

/** Alias for components that expect a narrower user shape */
export type UserInfo = User;

/** Basic application metadata */
export interface AppInfo {
  name: string;
  description: string;
  team: string;
  classification: Classification;
  contact: string;
  accessLevel: AccessLevel;
}

/** Health status for platform services */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  message?: string;
  checkedAt?: string;
}

/** Classification levels */
export type Classification =
  | 'UNCLASSIFIED'
  | 'CUI'
  | 'CONFIDENTIAL'
  | 'SECRET'
  | 'TOP SECRET'
  | 'TS//SCI';

export type AccessLevel = 'everyone' | 'restricted' | 'private';

/** Status of an individual security gate */
export type GateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'warning' | 'skipped';

/** Disposition assigned to a finding during triage */
export type FindingDisposition = 'will_fix' | 'accepted_risk' | 'false_positive' | 'na';

/** A single finding within a security gate */
export interface GateFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  location?: string;
  disposition?: FindingDisposition;
  mitigation?: string;
  mitigatedBy?: string;
  mitigatedAt?: string;
}

/** UI-facing security gate (mapped from backend PipelineGate) */
export interface SecurityGate {
  id: number;
  name: string;
  shortName: string;
  description: string;
  status: GateStatus;
  progress: number;
  findings: GateFinding[];
  summary?: string;
  implemented?: boolean;
  manualAck?: boolean;
  reportUrl?: string;
}

/** Pipeline run status from the backend */
export type PipelineRunStatus =
  | 'pending'
  | 'scanning'
  | 'review_pending'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'undeployed';

/** Full pipeline run as returned by the API */
export interface PipelineRun {
  id: string;
  app_name: string;
  git_url: string | null;
  branch: string;
  image_url: string | null;
  source_type: string;
  team: string;
  classification: string;
  contact: string | null;
  status: PipelineRunStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deployed_url: string | null;
  deploy_build_id: string | null;
  gates: PipelineGate[];
  findings: PipelineFinding[];
  reviews: PipelineReview[];
  audit_log: PipelineAuditEntry[];
  metadata?: Record<string, unknown>;
}

/** A single gate within a pipeline run (backend shape) */
export interface PipelineGate {
  id: number;
  gate_name: string;
  short_name: string;
  gate_order: number;
  status: GateStatus;
  progress: number;
  summary: string | null;
  tool: string | null;
  report_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  raw_output?: RawGateOutput | null;
}

/** Raw output stored per gate */
export interface RawGateOutput {
  gate?: string;
  tool?: string;
  status?: string;
  summary?: string;
  findings?: Array<{ severity: string; title: string; description?: string; location?: string }>;
  toolOutput?: unknown;
  packageCount?: number;
  format?: string;
  scannedAt?: string;
}

/** A single finding within a pipeline run (backend shape) */
export interface PipelineFinding {
  id: number;
  gate_id: number;
  severity: string;
  title: string;
  description: string | null;
  location: string | null;
  disposition: FindingDisposition | null;
  mitigation: string | null;
  mitigated_by: string | null;
  mitigated_at: string | null;
}

/** Review decision on a pipeline run */
export interface PipelineReview {
  id: number;
  reviewer: string;
  decision: string;
  comment: string | null;
  reviewed_at: string;
}

/** Audit log entry for a pipeline run */
export interface PipelineAuditEntry {
  id: number;
  action: string;
  actor: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
