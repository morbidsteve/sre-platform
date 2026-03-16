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
}

export interface User {
  name: string;
  email: string;
  groups: string[];
}
