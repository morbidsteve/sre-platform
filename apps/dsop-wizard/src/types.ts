export type SecurityExceptionType = 'run_as_root' | 'writable_filesystem' | 'host_networking' | 'privileged_container' | 'custom_capability';

export interface SecurityException {
  type: SecurityExceptionType;
  justification: string;
  enabled: boolean;
  requestedBy?: string;
  requestedAt?: string;
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export type SourceType = 'git' | 'container' | 'helm';

export type Classification =
  | 'UNCLASSIFIED'
  | 'CUI'
  | 'CONFIDENTIAL'
  | 'SECRET'
  | 'TOP SECRET'
  | 'TS//SCI';

export type AccessLevel = 'everyone' | 'restricted' | 'private';

export type GateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'warning' | 'skipped';

export type DeployStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AppSource {
  type: SourceType;
  gitUrl?: string;
  branch?: string;
  imageUrl?: string;
  chartRepo?: string;
  chartName?: string;
}

export interface AppInfo {
  name: string;
  description: string;
  team: string;
  classification: Classification;
  contact: string;
  accessLevel: AccessLevel;
}

export interface DetectedService {
  name: string;
  image: string;
  port: number | null;
  type: 'application' | 'database' | 'cache' | 'queue' | 'proxy';
}

export interface PlatformMapping {
  detected: string;
  mappedTo: string;
  icon: string;
}

export interface ExternalAccess {
  service: string;
  hostname: string;
}

export interface DetectionResult {
  repoType: 'docker-compose' | 'dockerfile' | 'helm' | 'kustomize' | 'container';
  services: DetectedService[];
  platformServices: PlatformMapping[];
  externalAccess: ExternalAccess[];
}

export type FindingDisposition = 'will_fix' | 'accepted_risk' | 'false_positive' | 'na';

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

export interface SecurityGate {
  id: number;
  name: string;
  shortName: string;
  description: string;
  status: GateStatus;
  progress: number;
  findings: GateFinding[];
  summary?: string;
  implemented: boolean;
  manualAck?: boolean;
  reportUrl?: string;
}

export interface DeployStep {
  id: string;
  label: string;
  status: DeployStepStatus;
}

export interface WizardState {
  currentStep: number;
  source: AppSource;
  appInfo: AppInfo;
  detection: DetectionResult | null;
  gates: SecurityGate[];
  deploySteps: DeployStep[];
  deployedUrl: string | null;
  isAnalyzing: boolean;
  isPipelineRunning: boolean;
  isDeploying: boolean;
  error: string | null;
  pipelineRunId: string | null;
  pipelineRun: PipelineRun | null;
  securityExceptions: SecurityException[];
}

export interface User {
  name: string;
  email: string;
  groups: string[];
}

// --- Pipeline API Types ---

export type PipelineRunStatus = 'pending' | 'scanning' | 'review_pending' | 'approved' | 'rejected' | 'deploying' | 'deployed' | 'failed';

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
}

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
}

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

export interface PipelineReview {
  id: number;
  reviewer: string;
  decision: string;
  comment: string | null;
  reviewed_at: string;
}

export interface PipelineAuditEntry {
  id: number;
  action: string;
  actor: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
