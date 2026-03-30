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

export type SourceType = 'git' | 'container' | 'helm' | 'bundle';

export type DataType = 'public' | 'cui' | 'pii' | 'phi' | 'financial';

export type FipsLevel = 'low' | 'moderate' | 'high';

export interface SecurityCategorization {
  dataTypes: DataType[];
  confidentiality: FipsLevel;
  integrity: FipsLevel;
  availability: FipsLevel;
}

export type DeployStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BundleManifest {
  apiVersion: string;
  metadata: {
    name: string;
    version: string;
    team: string;
    created?: string;
    author?: string;
    description?: string;
  };
  spec: {
    app: {
      type: 'web-app' | 'api-service' | 'worker' | 'cronjob';
      image: string;
      port?: number;
      resources?: string;
      ingress?: string;
      probes?: { liveness?: string; readiness?: string };
    };
    components?: Array<{
      name: string;
      type: string;
      image: string;
      resources?: string;
      schedule?: string;
    }>;
    services?: {
      database?: { enabled: boolean; size?: string };
      redis?: { enabled: boolean; size?: string };
      sso?: { enabled: boolean };
      storage?: { enabled: boolean };
    };
    env?: Array<{ name: string; value?: string; secret?: string }>;
    externalApis?: string[];
    source?: { included: boolean; language?: string };
    classification?: string;
  };
}

export interface BundleUploadResult {
  uploadId: string;
  manifest: BundleManifest;
  images: Array<{ name: string; file: string; sizeMB: number }>;
  sourceIncluded: boolean;
  errors?: string[];
}

export interface AppSource {
  type: SourceType;
  gitUrl?: string;
  branch?: string;
  imageUrl?: string;
  chartRepo?: string;
  chartName?: string;
  bundleManifest?: BundleManifest;
  bundleUploadId?: string;
  bundleImages?: Array<{ name: string; file: string; sizeMB: number }>;
  bundleSourceIncluded?: boolean;
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
  mode: 'full' | 'easy' | null;
  easyConfig: EasyConfig;
  easyPrUrl: string | null;
}

export interface EasyConfig {
  appName: string;
  team: string;
  image: string;
  appType: 'web-app' | 'api-service' | 'worker' | 'cronjob';
  port: number;
  resources: 'small' | 'medium' | 'large';
  ingress: string;
  database: { enabled: boolean; size: string };
  redis: { enabled: boolean; size: string };
  sso: boolean;
  storage: boolean;
  env: Array<{ name: string; value?: string; secret?: string }>;
}
