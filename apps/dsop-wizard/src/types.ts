// Re-export all shared types (used by both wizard and portal)
export type {
  User,
  UserInfo,
  HealthStatus,
  GateStatus,
  FindingDisposition,
  GateFinding,
  PipelineRunStatus,
  PipelineGate,
  RawGateOutput,
  PipelineFinding,
  PipelineReview,
  PipelineAuditEntry,
} from './types/shared';

// Import types needed within this file for WizardState definition
import type {
  AppInfo as SharedAppInfo,
  Classification as SharedClassification,
  AccessLevel as SharedAccessLevel,
  SecurityGate as SharedSecurityGate,
  PipelineRun as SharedPipelineRun,
} from './types/shared';

// Re-export imported types so consumers see the same interface
export type AppInfo = SharedAppInfo;
export type Classification = SharedClassification;
export type AccessLevel = SharedAccessLevel;
export type SecurityGate = SharedSecurityGate;
export type PipelineRun = SharedPipelineRun;

// ── Wizard-specific types (not shared with portal) ──

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

export type DataType = 'public' | 'cui' | 'pii' | 'phi' | 'financial';

export type FipsLevel = 'low' | 'moderate' | 'high';

export interface SecurityCategorization {
  dataTypes: DataType[];
  confidentiality: FipsLevel;
  integrity: FipsLevel;
  availability: FipsLevel;
}

export type DeployStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AppSource {
  type: SourceType;
  gitUrl?: string;
  branch?: string;
  imageUrl?: string;
  chartRepo?: string;
  chartName?: string;
}

export interface DetectedRequirements {
  port: number | null;
  needsRoot: boolean;
  needsPrivileged: boolean;
  needsWritableFs: boolean;
  capabilities: string[];
  detectedFrom: string[];
  probeDelays?: { liveness: number; readiness: number; failureThreshold: number };
  resources?: { limits: { cpu: string; memory: string }; requests: { cpu: string; memory: string } };
  probePath?: string;
}

export interface DetectedService {
  name: string;
  image: string;
  port: number | null;
  type: 'application' | 'database' | 'cache' | 'queue' | 'proxy';
  requirements?: DetectedRequirements;
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
  detectedRequirements?: DetectedRequirements;
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
  securityCategorization: SecurityCategorization;
}
