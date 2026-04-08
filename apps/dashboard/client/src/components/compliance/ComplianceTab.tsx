import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield,
  CheckCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  X,
  Search,
  FileText,
  Download,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { SkeletonCard } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { AuditFilters } from '../audit/AuditFilters';
import { AuditTable } from '../audit/AuditTable';
import { fetchAuditEvents } from '../../api/audit';
import { fetchHealth } from '../../api/health';
import { fetchComplianceScore, generateComplianceReport, type ComplianceReport } from '../../api/compliance';
import { useConfig } from '../../context/ConfigContext';
import { deepLink } from '../../utils/deepLinks';
import { Skeleton } from '../ui/Skeleton';
import type { AuditEvent, HelmRelease, ComplianceScore } from '../../types/api';

// URL placeholder tokens resolved at render time via resolveUrl()
// Grafana dashboards
const SVC_GRAFANA_CLUSTER_OVERVIEW    = '{{grafana:cluster-overview}}';
const SVC_GRAFANA_KYVERNO             = '{{grafana:kyverno-violations}}';
const SVC_GRAFANA_ISTIO               = '{{grafana:istio-mesh}}';
const SVC_GRAFANA_CERT_MANAGER        = '{{grafana:cert-manager}}';
const SVC_GRAFANA_FLUX                = '{{grafana:flux-reconciliation}}';
const SVC_GRAFANA_HARBOR              = '{{grafana:harbor}}';
const SVC_GRAFANA_KEYCLOAK            = '{{grafana:keycloak}}';
const SVC_GRAFANA_NEUVECTOR           = '{{grafana:neuvector}}';
const SVC_GRAFANA_OPENBAO             = '{{grafana:openbao}}';
const SVC_GRAFANA_COMPLIANCE_TREND    = '{{grafana:compliance-trend}}';
const SVC_GRAFANA_NAMESPACE_RESOURCES = '{{grafana:namespace-resources}}';
const SVC_GRAFANA_PV_USAGE            = '{{grafana:pv-usage}}';
const SVC_GRAFANA_AUDIT               = '{{grafana:loki-audit-logs}}';
const SVC_GRAFANA_ALERTS              = '{{grafana:alerts}}';
// Harbor
const SVC_HARBOR                      = '{{harbor:projects}}';
const SVC_HARBOR_SCANS                = '{{harbor:scan-results}}';
// NeuVector
const SVC_NEUVECTOR_RUNTIME           = '{{neuvector:runtime-security}}';
const SVC_NEUVECTOR_VULNS             = '{{neuvector:vulnerabilities}}';
const SVC_NEUVECTOR_NETWORK           = '{{neuvector:network-activity}}';
const SVC_NEUVECTOR_COMPLIANCE        = '{{neuvector:compliance}}';
// Keycloak
const SVC_KEYCLOAK_USERS              = '{{keycloak:users}}';
const SVC_KEYCLOAK_GROUPS             = '{{keycloak:groups}}';
const SVC_KEYCLOAK_SESSIONS           = '{{keycloak:sessions}}';

// ── Individual Control definitions from compliance-mapping.md ───────────────

type ControlStatus = 'implemented' | 'partial' | 'not-started';

interface Control {
  id: string;
  name: string;
  status: ControlStatus;
  implementation: string;
  evidenceSources?: { name: string; url: string }[];
  /** HelmRelease names or namespace prefixes used to determine real-time health */
  healthKeys?: string[];
}

interface ControlFamily {
  id: string;
  name: string;
  description: string;
  controls: Control[];
}

const CONTROL_FAMILIES: ControlFamily[] = [
  {
    id: 'AC',
    name: 'Access Control',
    description: 'Access management, RBAC, and network segmentation',
    controls: [
      {
        id: 'AC-2', name: 'Account Management', status: 'implemented',
        implementation: 'Keycloak (centralized identity, group-based access, automated deprovisioning)',
        healthKeys: ['keycloak'],
        evidenceSources: [
          { name: 'Keycloak Users', url: SVC_KEYCLOAK_USERS },
          { name: 'Keycloak Groups', url: SVC_KEYCLOAK_GROUPS },
        ],
      },
      {
        id: 'AC-3', name: 'Access Enforcement', status: 'implemented',
        implementation: 'Kubernetes RBAC, Istio AuthorizationPolicy, Kyverno namespace isolation',
        healthKeys: ['kyverno', 'istiod'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
      {
        id: 'AC-4', name: 'Information Flow Enforcement', status: 'implemented',
        implementation: 'Istio mTLS STRICT, NetworkPolicies (default deny), Kyverno egress restrictions',
        healthKeys: ['istiod', 'kyverno'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
          { name: 'NeuVector Network Activity', url: SVC_NEUVECTOR_NETWORK },
        ],
      },
      {
        id: 'AC-6', name: 'Least Privilege', status: 'implemented',
        implementation: 'RBAC roles scoped to namespace, pod security contexts (non-root, drop ALL caps), ServiceAccount per workload',
        healthKeys: ['kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'AC-6(1)', name: 'Authorize Access to Security Functions', status: 'implemented',
        implementation: 'Flux RBAC (only flux-system SA can modify platform namespaces), Kyverno policy protecting platform resources',
        healthKeys: ['kyverno', 'source-controller'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'AC-6(9)', name: 'Auditing Use of Privileged Functions', status: 'implemented',
        implementation: 'Kubernetes audit logging to Loki, Istio access logs',
        healthKeys: ['loki'],
        evidenceSources: [
          { name: 'Loki Audit Logs', url: SVC_GRAFANA_AUDIT },
        ],
      },
      {
        id: 'AC-6(10)', name: 'Prohibit Non-Privileged Users from Executing Privileged Functions', status: 'implemented',
        implementation: 'Kyverno (disallow-privileged, disallow-privilege-escalation), Pod Security Standards restricted',
        healthKeys: ['kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'AC-14', name: 'Permitted Actions Without Identification', status: 'implemented',
        implementation: 'Istio PeerAuthentication STRICT (no unauthenticated service-to-service communication)',
        healthKeys: ['istiod'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
      {
        id: 'AC-17', name: 'Remote Access', status: 'implemented',
        implementation: 'Keycloak SSO/MFA for all management interfaces, Istio gateway TLS termination',
        healthKeys: ['keycloak', 'istiod'],
        evidenceSources: [
          { name: 'Keycloak Sessions', url: SVC_KEYCLOAK_SESSIONS },
          { name: 'Certificate Overview', url: SVC_GRAFANA_CERT_MANAGER },
        ],
      },
    ],
  },
  {
    id: 'AU',
    name: 'Audit & Accountability',
    description: 'Logging, audit trails, and monitoring',
    controls: [
      {
        id: 'AU-2', name: 'Audit Events', status: 'implemented',
        implementation: 'Kubernetes API audit policy (captures auth, CRUD on all resources), Istio access logs',
        healthKeys: ['istiod'],
        evidenceSources: [
          { name: 'Loki Audit Logs', url: SVC_GRAFANA_AUDIT },
        ],
      },
      {
        id: 'AU-3', name: 'Content of Audit Records', status: 'implemented',
        implementation: 'Structured JSON logs with timestamp, source, user, action, resource, outcome',
        evidenceSources: [
          { name: 'Loki Audit Logs', url: SVC_GRAFANA_AUDIT },
        ],
      },
      {
        id: 'AU-4', name: 'Audit Storage Capacity', status: 'implemented',
        implementation: 'Loki with object storage backend (S3/MinIO), configurable retention',
        healthKeys: ['loki'],
        evidenceSources: [
          { name: 'Namespace Resources', url: SVC_GRAFANA_NAMESPACE_RESOURCES },
        ],
      },
      {
        id: 'AU-5', name: 'Response to Audit Processing Failures', status: 'implemented',
        implementation: 'Prometheus alerts on Loki ingestion failures, Loki disk pressure alerts',
        healthKeys: ['kube-prometheus-stack', 'loki'],
        evidenceSources: [
          { name: 'Grafana Alerts', url: SVC_GRAFANA_ALERTS },
        ],
      },
      {
        id: 'AU-6', name: 'Audit Review, Analysis, and Reporting', status: 'implemented',
        implementation: 'Grafana dashboards for audit log analysis, pre-built compliance report queries',
        healthKeys: ['kube-prometheus-stack'],
        evidenceSources: [
          { name: 'Loki Audit Logs', url: SVC_GRAFANA_AUDIT },
          { name: 'Compliance Trend', url: SVC_GRAFANA_COMPLIANCE_TREND },
        ],
      },
      {
        id: 'AU-8', name: 'Time Stamps', status: 'implemented',
        implementation: 'NTP enforced on all nodes via Ansible, all logs in UTC',
        evidenceSources: [
          { name: 'Cluster Overview', url: SVC_GRAFANA_CLUSTER_OVERVIEW },
        ],
      },
      {
        id: 'AU-9', name: 'Protection of Audit Information', status: 'implemented',
        implementation: 'Loki log storage encrypted at rest, RBAC restricts log access to audit team',
        healthKeys: ['loki'],
        evidenceSources: [
          { name: 'Loki Audit Logs', url: SVC_GRAFANA_AUDIT },
        ],
      },
      {
        id: 'AU-12', name: 'Audit Generation', status: 'implemented',
        implementation: 'All platform components output structured JSON to stdout/stderr, collected by Alloy',
        healthKeys: ['alloy'],
        evidenceSources: [
          { name: 'Loki Logs', url: SVC_GRAFANA_AUDIT },
        ],
      },
    ],
  },
  {
    id: 'CA',
    name: 'Assessment & Authorization',
    description: 'Continuous monitoring and vulnerability scanning',
    controls: [
      {
        id: 'CA-7', name: 'Continuous Monitoring', status: 'implemented',
        implementation: 'Prometheus + Grafana (real-time metrics), NeuVector (runtime anomaly detection), Kyverno policy reports (continuous compliance)',
        healthKeys: ['kube-prometheus-stack', 'neuvector', 'kyverno'],
        evidenceSources: [
          { name: 'Compliance Trend', url: SVC_GRAFANA_COMPLIANCE_TREND },
          { name: 'NeuVector Compliance', url: SVC_NEUVECTOR_COMPLIANCE },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'CA-8', name: 'Penetration Testing', status: 'implemented',
        implementation: 'NeuVector vulnerability scanning, Trivy image scanning in Harbor',
        healthKeys: ['neuvector', 'harbor'],
        evidenceSources: [
          { name: 'NeuVector Vulnerabilities', url: SVC_NEUVECTOR_VULNS },
          { name: 'Harbor Scan Results', url: SVC_HARBOR_SCANS },
        ],
      },
    ],
  },
  {
    id: 'CM',
    name: 'Configuration Management',
    description: 'GitOps baseline, drift detection, policy enforcement',
    controls: [
      {
        id: 'CM-2', name: 'Baseline Configuration', status: 'implemented',
        implementation: 'Git repo IS the baseline -- Flux reconciles cluster to match Git state',
        healthKeys: ['source-controller', 'kustomize-controller'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
        ],
      },
      {
        id: 'CM-3', name: 'Configuration Change Control', status: 'implemented',
        implementation: 'Git PR workflow, branch protection, conventional commits, Flux audit trail',
        healthKeys: ['source-controller'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
        ],
      },
      {
        id: 'CM-5', name: 'Access Restrictions for Change', status: 'implemented',
        implementation: 'Branch protection rules, Flux RBAC, Kyverno prevents manual kubectl changes to platform resources',
        healthKeys: ['kyverno', 'source-controller'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'CM-6', name: 'Configuration Settings', status: 'implemented',
        implementation: 'Ansible STIG roles (OS), RKE2 CIS benchmark profile, Kyverno policies (K8s)',
        healthKeys: ['kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'Cluster Overview', url: SVC_GRAFANA_CLUSTER_OVERVIEW },
        ],
      },
      {
        id: 'CM-7', name: 'Least Functionality', status: 'implemented',
        implementation: 'Kyverno restricts capabilities, volumes, host access; NeuVector blocks unexpected processes',
        healthKeys: ['kyverno', 'neuvector'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'NeuVector Runtime', url: SVC_NEUVECTOR_RUNTIME },
        ],
      },
      {
        id: 'CM-8', name: 'Information System Component Inventory', status: 'implemented',
        implementation: 'Flux tracks all deployed components, Harbor maintains image inventory with SBOMs',
        healthKeys: ['source-controller', 'harbor'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
          { name: 'Harbor Projects', url: SVC_HARBOR },
        ],
      },
      {
        id: 'CM-11', name: 'User-Installed Software', status: 'implemented',
        implementation: 'Kyverno image registry restriction (only harbor.sre.internal allowed), image signature verification',
        healthKeys: ['kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
    ],
  },
  {
    id: 'IA',
    name: 'Identification & Authentication',
    description: 'SSO, mTLS, certificate management',
    controls: [
      {
        id: 'IA-2', name: 'Identification and Authentication (Organizational Users)', status: 'implemented',
        implementation: 'Keycloak SSO with MFA, OIDC integration with Kubernetes API',
        healthKeys: ['keycloak'],
        evidenceSources: [
          { name: 'Keycloak Dashboard', url: SVC_GRAFANA_KEYCLOAK },
        ],
      },
      {
        id: 'IA-3', name: 'Device Identification and Authentication', status: 'implemented',
        implementation: 'Istio mTLS with SPIFFE identities for all workloads',
        healthKeys: ['istiod'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
      {
        id: 'IA-5', name: 'Authenticator Management', status: 'implemented',
        implementation: 'Keycloak password policies, cert-manager certificate rotation, OpenBao secret rotation',
        healthKeys: ['keycloak', 'cert-manager', 'openbao'],
        evidenceSources: [
          { name: 'Keycloak Dashboard', url: SVC_GRAFANA_KEYCLOAK },
          { name: 'Certificate Overview', url: SVC_GRAFANA_CERT_MANAGER },
          { name: 'OpenBao Dashboard', url: SVC_GRAFANA_OPENBAO },
        ],
      },
      {
        id: 'IA-8', name: 'Identification and Authentication (Non-Organizational Users)', status: 'implemented',
        implementation: 'Istio gateway enforces authentication for all external traffic',
        healthKeys: ['istiod'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
    ],
  },
  {
    id: 'IR',
    name: 'Incident Response',
    description: 'Alerting, monitoring, and incident handling',
    controls: [
      {
        id: 'IR-4', name: 'Incident Handling', status: 'implemented',
        implementation: 'NeuVector alerts to Prometheus to Grafana alerting pipeline, runbooks linked from alerts',
        healthKeys: ['neuvector', 'kube-prometheus-stack'],
        evidenceSources: [
          { name: 'NeuVector Runtime', url: SVC_NEUVECTOR_RUNTIME },
          { name: 'Grafana Alerts', url: SVC_GRAFANA_ALERTS },
        ],
      },
      {
        id: 'IR-5', name: 'Incident Monitoring', status: 'implemented',
        implementation: 'NeuVector runtime security events, Kyverno policy violations, Prometheus alert history',
        healthKeys: ['neuvector', 'kyverno', 'kube-prometheus-stack'],
        evidenceSources: [
          { name: 'NeuVector Runtime', url: SVC_NEUVECTOR_RUNTIME },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'Grafana Alerts', url: SVC_GRAFANA_ALERTS },
        ],
      },
      {
        id: 'IR-6', name: 'Incident Reporting', status: 'implemented',
        implementation: 'Grafana dashboards with exportable incident reports',
        healthKeys: ['kube-prometheus-stack'],
        evidenceSources: [
          { name: 'Compliance Trend', url: SVC_GRAFANA_COMPLIANCE_TREND },
        ],
      },
    ],
  },
  {
    id: 'MP',
    name: 'Media Protection',
    description: 'Secrets encryption and data protection',
    controls: [
      {
        id: 'MP-2', name: 'Media Access', status: 'implemented',
        implementation: 'OpenBao access policies, Kubernetes Secrets encrypted at rest (RKE2 default)',
        healthKeys: ['openbao'],
        evidenceSources: [
          { name: 'OpenBao Dashboard', url: SVC_GRAFANA_OPENBAO },
        ],
      },
    ],
  },
  {
    id: 'RA',
    name: 'Risk Assessment',
    description: 'Vulnerability scanning and CIS benchmarks',
    controls: [
      {
        id: 'RA-5', name: 'Vulnerability Scanning', status: 'implemented',
        implementation: 'Harbor + Trivy (image scanning), NeuVector (runtime scanning), CIS benchmark scanning',
        healthKeys: ['harbor', 'neuvector'],
        evidenceSources: [
          { name: 'Harbor Scan Results', url: SVC_HARBOR_SCANS },
          { name: 'NeuVector Vulnerabilities', url: SVC_NEUVECTOR_VULNS },
        ],
      },
    ],
  },
  {
    id: 'SA',
    name: 'System & Services Acquisition',
    description: 'Developer configuration management and testing',
    controls: [
      {
        id: 'SA-10', name: 'Developer Configuration Management', status: 'implemented',
        implementation: 'GitOps workflow (all changes via Git), Flux reconciliation audit trail',
        healthKeys: ['source-controller'],
        evidenceSources: [
          { name: 'Flux GitOps', url: SVC_GRAFANA_FLUX },
        ],
      },
      {
        id: 'SA-11', name: 'Developer Testing and Evaluation', status: 'implemented',
        implementation: 'Kyverno policy tests, Helm chart tests, infrastructure validation pipeline',
        healthKeys: ['kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
    ],
  },
  {
    id: 'SC',
    name: 'System & Communications Protection',
    description: 'mTLS, encryption, FIPS, network segmentation',
    controls: [
      {
        id: 'SC-3', name: 'Security Function Isolation', status: 'implemented',
        implementation: 'Namespace isolation, NetworkPolicies, Istio AuthorizationPolicy',
        healthKeys: ['istiod', 'kyverno'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'Namespace Resources', url: SVC_GRAFANA_NAMESPACE_RESOURCES },
        ],
      },
      {
        id: 'SC-7', name: 'Boundary Protection', status: 'implemented',
        implementation: 'Istio gateway (single ingress point), NetworkPolicies (default deny egress), NeuVector network segmentation',
        healthKeys: ['istiod', 'neuvector'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
          { name: 'NeuVector Network Activity', url: SVC_NEUVECTOR_NETWORK },
        ],
      },
      {
        id: 'SC-8', name: 'Transmission Confidentiality and Integrity', status: 'implemented',
        implementation: 'Istio mTLS STRICT (all in-cluster traffic encrypted), TLS termination at gateway',
        healthKeys: ['istiod'],
        evidenceSources: [
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
      {
        id: 'SC-12', name: 'Cryptographic Key Establishment and Management', status: 'implemented',
        implementation: 'cert-manager (automated certificate lifecycle), OpenBao (secret management and rotation)',
        healthKeys: ['cert-manager', 'openbao'],
        evidenceSources: [
          { name: 'Certificate Overview', url: SVC_GRAFANA_CERT_MANAGER },
          { name: 'OpenBao Dashboard', url: SVC_GRAFANA_OPENBAO },
        ],
      },
      {
        id: 'SC-13', name: 'Cryptographic Protection', status: 'implemented',
        implementation: 'RKE2 FIPS 140-2 mode, FIPS crypto policy on Rocky Linux 9',
        evidenceSources: [
          { name: 'Cluster Overview', url: SVC_GRAFANA_CLUSTER_OVERVIEW },
        ],
      },
      {
        id: 'SC-28', name: 'Protection of Information at Rest', status: 'implemented',
        implementation: 'Kubernetes Secrets encryption (RKE2), OpenBao encrypted storage backend, Loki encrypted object storage',
        healthKeys: ['openbao', 'loki'],
        evidenceSources: [
          { name: 'OpenBao Dashboard', url: SVC_GRAFANA_OPENBAO },
          { name: 'PV Usage', url: SVC_GRAFANA_PV_USAGE },
        ],
      },
    ],
  },
  {
    id: 'SI',
    name: 'System & Information Integrity',
    description: 'Image signing, runtime protection, vulnerability remediation',
    controls: [
      {
        id: 'SI-2', name: 'Flaw Remediation', status: 'implemented',
        implementation: 'Harbor + Trivy scanning with severity-based alerts, image update automation via Flux',
        healthKeys: ['harbor', 'source-controller'],
        evidenceSources: [
          { name: 'Harbor Dashboard', url: SVC_GRAFANA_HARBOR },
          { name: 'Grafana Alerts', url: SVC_GRAFANA_ALERTS },
        ],
      },
      {
        id: 'SI-3', name: 'Malicious Code Protection', status: 'implemented',
        implementation: 'NeuVector runtime protection (process blocking, file system monitoring)',
        healthKeys: ['neuvector'],
        evidenceSources: [
          { name: 'NeuVector Runtime', url: SVC_NEUVECTOR_RUNTIME },
        ],
      },
      {
        id: 'SI-4', name: 'System Monitoring', status: 'implemented',
        implementation: 'Prometheus metrics, Loki logs, Tempo traces, NeuVector runtime events, Kyverno policy reports',
        healthKeys: ['kube-prometheus-stack', 'loki', 'tempo', 'neuvector', 'kyverno'],
        evidenceSources: [
          { name: 'Cluster Overview', url: SVC_GRAFANA_CLUSTER_OVERVIEW },
          { name: 'NeuVector Dashboard', url: SVC_GRAFANA_NEUVECTOR },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'SI-5', name: 'Security Alerts, Advisories, and Directives', status: 'implemented',
        implementation: 'Grafana alerting to Slack/email, NeuVector CVE alerts',
        healthKeys: ['kube-prometheus-stack', 'neuvector'],
        evidenceSources: [
          { name: 'Grafana Alerts', url: SVC_GRAFANA_ALERTS },
          { name: 'NeuVector Dashboard', url: SVC_GRAFANA_NEUVECTOR },
        ],
      },
      {
        id: 'SI-6', name: 'Security Function Verification', status: 'implemented',
        implementation: 'NeuVector CIS benchmark scanning, Kyverno background policy scanning',
        healthKeys: ['neuvector', 'kyverno'],
        evidenceSources: [
          { name: 'NeuVector Compliance', url: SVC_NEUVECTOR_COMPLIANCE },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'SI-7', name: 'Software, Firmware, and Information Integrity', status: 'implemented',
        implementation: 'Cosign image signatures verified by Kyverno, SBOM generation in Harbor',
        healthKeys: ['kyverno', 'harbor'],
        evidenceSources: [
          { name: 'Harbor Dashboard', url: SVC_GRAFANA_HARBOR },
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
        ],
      },
      {
        id: 'SI-10', name: 'Information Input Validation', status: 'implemented',
        implementation: 'Kyverno admission control validates all resource specs, Istio request validation',
        healthKeys: ['kyverno', 'istiod'],
        evidenceSources: [
          { name: 'Kyverno Compliance', url: SVC_GRAFANA_KYVERNO },
          { name: 'Istio Mesh', url: SVC_GRAFANA_ISTIO },
        ],
      },
    ],
  },
];

const EVIDENCE_SOURCES = [
  {
    name: 'Grafana Audit Logs',
    description: 'Audit log evidence for AU, IR, and SI controls via Loki',
    url: SVC_GRAFANA_AUDIT,
    controls: ['AU-2', 'AU-3', 'AU-6', 'AU-9', 'AU-12', 'IR-4', 'SI-4'],
  },
  {
    name: 'Kyverno Compliance Dashboard',
    description: 'Policy compliance status for CM, AC, SA, and SI controls',
    url: SVC_GRAFANA_KYVERNO,
    controls: ['CM-6', 'CM-7', 'CM-11', 'AC-3', 'AC-6', 'AC-6(10)', 'SA-11', 'SI-6', 'SI-7'],
  },
  {
    name: 'NeuVector Runtime Security',
    description: 'Runtime security events and CIS benchmark results',
    url: SVC_NEUVECTOR_RUNTIME,
    controls: ['SI-3', 'SI-4', 'SC-7', 'IR-4', 'IR-5', 'CM-7'],
  },
  {
    name: 'Harbor Scan Results',
    description: 'Container image vulnerability scan results and SBOM artifacts',
    url: SVC_HARBOR_SCANS,
    controls: ['RA-5', 'CA-8', 'SI-2', 'SI-7'],
  },
  {
    name: 'Compliance Trend',
    description: 'Control status over time for continuous monitoring evidence',
    url: SVC_GRAFANA_COMPLIANCE_TREND,
    controls: ['CA-7', 'AU-6', 'IR-6'],
  },
  {
    name: 'Istio Mesh Dashboard',
    description: 'mTLS status, service traffic, and AuthorizationPolicy evidence',
    url: SVC_GRAFANA_ISTIO,
    controls: ['AC-3', 'AC-4', 'AC-14', 'IA-3', 'IA-8', 'SC-7', 'SC-8'],
  },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 0] as const; // 0 = All

interface ComplianceTabProps {
  active: boolean;
}

export function ComplianceTab({ active }: ComplianceTabProps) {
  const config = useConfig();

  // Resolve placeholder URL tokens to real service URLs with deep-link paths
  const resolveUrl = useCallback((url: string): string => {
    // Grafana dashboards
    if (url === SVC_GRAFANA_CLUSTER_OVERVIEW)    return deepLink(config, 'grafana:cluster-overview');
    if (url === SVC_GRAFANA_KYVERNO)             return deepLink(config, 'grafana:kyverno-violations');
    if (url === SVC_GRAFANA_ISTIO)               return deepLink(config, 'grafana:istio-mesh');
    if (url === SVC_GRAFANA_CERT_MANAGER)        return deepLink(config, 'grafana:cert-manager');
    if (url === SVC_GRAFANA_FLUX)                return deepLink(config, 'grafana:flux-reconciliation');
    if (url === SVC_GRAFANA_HARBOR)              return deepLink(config, 'grafana:harbor');
    if (url === SVC_GRAFANA_KEYCLOAK)            return deepLink(config, 'grafana:keycloak');
    if (url === SVC_GRAFANA_NEUVECTOR)           return deepLink(config, 'grafana:neuvector');
    if (url === SVC_GRAFANA_OPENBAO)             return deepLink(config, 'grafana:openbao');
    if (url === SVC_GRAFANA_COMPLIANCE_TREND)    return deepLink(config, 'grafana:compliance-trend');
    if (url === SVC_GRAFANA_NAMESPACE_RESOURCES) return deepLink(config, 'grafana:namespace-resources');
    if (url === SVC_GRAFANA_PV_USAGE)            return deepLink(config, 'grafana:pv-usage');
    if (url === SVC_GRAFANA_AUDIT)               return deepLink(config, 'grafana:loki-audit-logs');
    if (url === SVC_GRAFANA_ALERTS)              return deepLink(config, 'grafana:alerts');
    // Harbor
    if (url === SVC_HARBOR)                      return deepLink(config, 'harbor:projects');
    if (url === SVC_HARBOR_SCANS)                return deepLink(config, 'harbor:scan-results');
    // NeuVector
    if (url === SVC_NEUVECTOR_RUNTIME)           return deepLink(config, 'neuvector:runtime-security');
    if (url === SVC_NEUVECTOR_VULNS)             return deepLink(config, 'neuvector:vulnerabilities');
    if (url === SVC_NEUVECTOR_NETWORK)           return deepLink(config, 'neuvector:network-activity');
    if (url === SVC_NEUVECTOR_COMPLIANCE)        return deepLink(config, 'neuvector:compliance');
    // Keycloak
    if (url === SVC_KEYCLOAK_USERS)              return deepLink(config, 'keycloak:users');
    if (url === SVC_KEYCLOAK_GROUPS)             return deepLink(config, 'keycloak:groups');
    if (url === SVC_KEYCLOAK_SESSIONS)           return deepLink(config, 'keycloak:sessions');
    return url;
  }, [config]);

  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

  // Audit trail state
  const [allEvents, setAllEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [nsFilter, setNsFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  // Health data for real-time status
  const [helmReleases, setHelmReleases] = useState<HelmRelease[]>([]);

  // Compliance score from API
  const [complianceScore, setComplianceScore] = useState<ComplianceScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);

  // Subtab navigation
  const [activeSubtab, setActiveSubtab] = useState<'controls' | 'live-report' | 'documents'>('controls');

  // Document download states
  const [sspDownloading, setSspDownloading] = useState(false);
  const [atoDownloading, setAtoDownloading] = useState(false);

  // Live compliance report
  const [reportData, setReportData] = useState<ComplianceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedReportFamily, setExpandedReportFamily] = useState<string | null>(null);

  // Section refs for scrolling
  const controlFamilySectionRef = useRef<HTMLDivElement>(null);
  const auditSectionRef = useRef<HTMLDivElement>(null);

  const loadAudit = useCallback(async () => {
    if (!active) return;
    try {
      setError(null);
      const data = await fetchAuditEvents();
      setAllEvents(data);
    } catch {
      setError('Failed to load audit data');
    } finally {
      setAuditLoading(false);
    }
  }, [active]);

  const loadHealth = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchHealth();
      setHelmReleases(data.helmReleases);
    } catch {
      // keep existing data
    }
  }, [active]);

  const loadScore = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchComplianceScore();
      setComplianceScore(data);
    } catch {
      // keep existing data
    } finally {
      setScoreLoading(false);
    }
  }, [active]);

  const handleGenerateReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const result = await generateComplianceReport();
      setReportData(result.report);
    } catch {
      setReportError('Failed to load compliance report');
    } finally {
      setReportLoading(false);
    }
  }, []);

  const downloadFile = useCallback(async (url: string, filename: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadReportHtml = useCallback(() => {
    if (!reportData) return;
    const statusColor = (s: string) => s === 'PASS' ? '#22c55e' : s === 'PARTIAL' ? '#eab308' : '#ef4444';
    const rows = reportData.controls.map(c =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #333;font-family:monospace">${c.control}</td><td style="padding:6px 12px;border-bottom:1px solid #333">${c.family}</td><td style="padding:6px 12px;border-bottom:1px solid #333">${c.description}</td><td style="padding:6px 12px;border-bottom:1px solid #333"><span style="color:${statusColor(c.status)};font-weight:bold">${c.status}</span></td><td style="padding:6px 12px;border-bottom:1px solid #333;font-size:12px">${c.evidence}</td></tr>`
    ).join('\n');
    const html = `<!DOCTYPE html><html><head><title>${reportData.title}</title><style>body{font-family:system-ui,sans-serif;background:#1a1a2e;color:#e0e0e0;padding:40px;margin:0}h1{color:#fff;font-size:24px}h2{color:#888;font-size:14px;text-transform:uppercase;letter-spacing:1px}.summary{display:flex;gap:24px;margin:24px 0}.card{background:#16213e;border:1px solid #333;border-radius:8px;padding:16px 24px}.card .label{font-size:12px;color:#888;text-transform:uppercase}.card .value{font-size:28px;font-weight:bold;font-family:monospace}table{width:100%;border-collapse:collapse;background:#16213e;border:1px solid #333;border-radius:8px;overflow:hidden}th{text-align:left;padding:8px 12px;background:#0f3460;color:#888;font-size:12px;text-transform:uppercase}td{font-size:13px}</style></head><body><h1>${reportData.title}</h1><p>Generated: ${new Date(reportData.scanDate).toLocaleString()}</p><div class="summary"><div class="card"><div class="label">Pass</div><div class="value" style="color:#22c55e">${reportData.summary.pass}</div></div><div class="card"><div class="label">Partial</div><div class="value" style="color:#eab308">${reportData.summary.partial}</div></div><div class="card"><div class="label">Fail</div><div class="value" style="color:#ef4444">${reportData.summary.fail}</div></div><div class="card"><div class="label">Compliance</div><div class="value" style="color:#3b82f6">${reportData.summary.compliancePercentage}%</div></div></div><h2>Control Assessment</h2><table><thead><tr><th>Control</th><th>Family</th><th>Description</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportData]);

  useEffect(() => {
    if (!active) return;
    loadAudit();
    loadHealth();
    loadScore();
    const auditId = setInterval(loadAudit, 30000);
    const healthId = setInterval(loadHealth, 15000);
    const scoreId = setInterval(loadScore, 30000);
    return () => {
      clearInterval(auditId);
      clearInterval(healthId);
      clearInterval(scoreId);
    };
  }, [active, loadAudit, loadHealth, loadScore]);

  // Auto-load compliance report when Live Report subtab becomes active
  useEffect(() => {
    if (!active || activeSubtab !== 'live-report') return;
    if (!reportData && !reportLoading) {
      handleGenerateReport();
    }
  }, [active, activeSubtab, reportData, reportLoading, handleGenerateReport]);

  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    allEvents.forEach((e) => { if (e.namespace) nsSet.add(e.namespace); });
    return Array.from(nsSet).sort();
  }, [allEvents]);

  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (nsFilter && e.namespace !== nsFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const haystack = [e.namespace, e.kind, e.name, e.reason, e.message, e.type, e.timestamp]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allEvents, typeFilter, nsFilter, searchText]);

  const effectivePageSize = pageSize === 0 ? filtered.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / (effectivePageSize || 1)));
  const pageEvents = pageSize === 0
    ? filtered
    : filtered.slice(page * effectivePageSize, (page + 1) * effectivePageSize);

  // Build a lookup: helmRelease name -> healthy boolean
  const helmHealthMap = useMemo(() => {
    const m = new Map<string, boolean>();
    helmReleases.forEach((hr) => {
      m.set(hr.name, hr.ready);
    });
    return m;
  }, [helmReleases]);

  /** Check if a specific control's implementing services are healthy */
  const getControlHealth = useCallback((ctrl: Control): 'healthy' | 'degraded' | 'unknown' => {
    if (!ctrl.healthKeys || ctrl.healthKeys.length === 0) return 'unknown';
    if (helmReleases.length === 0) return 'unknown';
    let hasAny = false;
    let allHealthy = true;
    for (const key of ctrl.healthKeys) {
      const found = helmHealthMap.get(key);
      if (found !== undefined) {
        hasAny = true;
        if (!found) allHealthy = false;
      }
    }
    if (!hasAny) return 'unknown';
    return allHealthy ? 'healthy' : 'degraded';
  }, [helmReleases.length, helmHealthMap]);

  /** Get aggregated health for a control family */
  const getFamilyHealth = useCallback((family: ControlFamily): 'healthy' | 'degraded' | 'unknown' => {
    const statuses = family.controls.map(getControlHealth);
    if (statuses.some((s) => s === 'degraded')) return 'degraded';
    if (statuses.every((s) => s === 'unknown')) return 'unknown';
    return 'healthy';
  }, [getControlHealth]);

  // Summary metrics
  const totalControls = CONTROL_FAMILIES.reduce((sum, f) => sum + f.controls.length, 0);
  const implementedControls = CONTROL_FAMILIES.reduce(
    (sum, f) => sum + f.controls.filter((c) => c.status === 'implemented').length,
    0,
  );
  const partialControls = CONTROL_FAMILIES.reduce(
    (sum, f) => sum + f.controls.filter((c) => c.status === 'partial').length,
    0,
  );
  const coveredFamilies = CONTROL_FAMILIES.filter(
    (f) => f.controls.some((c) => c.status !== 'not-started'),
  ).length;
  const progressPct = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;

  const toggleFamily = (id: string) => {
    setExpandedFamily(expandedFamily === id ? null : id);
  };

  const scrollToAndExpand = (target: 'controls' | 'audit', familyId?: string) => {
    if (target === 'controls' && controlFamilySectionRef.current) {
      controlFamilySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (familyId) {
        // small delay so scroll finishes before expand
        setTimeout(() => setExpandedFamily(familyId), 300);
      }
    } else if (target === 'audit' && auditSectionRef.current) {
      auditSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const statusDotColor = (s: ControlStatus) => {
    if (s === 'implemented') return 'bg-green';
    if (s === 'partial') return 'bg-yellow';
    return 'bg-text-dim';
  };

  const statusLabel = (s: ControlStatus) => {
    if (s === 'implemented') return 'Implemented';
    if (s === 'partial') return 'Partial';
    return 'Not Started';
  };

  const statusBadgeClass = (s: ControlStatus) => {
    if (s === 'implemented') return 'bg-green/15 text-green';
    if (s === 'partial') return 'bg-yellow/15 text-yellow';
    return 'bg-text-dim/15 text-text-dim';
  };

  const healthDotColor = (h: 'healthy' | 'degraded' | 'unknown') => {
    if (h === 'healthy') return 'bg-green';
    if (h === 'degraded') return 'bg-red';
    return 'bg-text-dim';
  };

  return (
    <div>
      {/* Error Banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded border text-sm"
             style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--red)' }}>
          {error} -- <button className="underline" onClick={loadAudit}>Retry</button>
        </div>
      )}

      {/* Compliance Score Header */}
      <div className="mb-6 bg-card border border-border rounded-[var(--radius)] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              {scoreLoading ? (
                <Skeleton className="h-12 w-20" />
              ) : complianceScore ? (
                <span
                  className={`text-4xl font-bold font-mono ${
                    complianceScore.score >= 90
                      ? 'text-green'
                      : complianceScore.score >= 70
                      ? 'text-yellow'
                      : 'text-red'
                  }`}
                >
                  {Math.round(complianceScore.score)}%
                </span>
              ) : (
                <span className="text-4xl font-bold font-mono text-text-dim">--</span>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-bright">Compliance Score</h2>
              {complianceScore ? (
                <p className="text-xs text-text-dim mt-0.5">
                  <span className="text-green">{complianceScore.controls.passing} passing</span>
                  {complianceScore.controls.partial > 0 && (
                    <span className="text-yellow"> / {complianceScore.controls.partial} partial</span>
                  )}
                  {complianceScore.controls.failing > 0 && (
                    <span className="text-red"> / {complianceScore.controls.failing} failing</span>
                  )}
                  <span className="text-text-dim"> of {complianceScore.controls.total} controls</span>
                </p>
              ) : (
                <p className="text-xs text-text-dim mt-0.5">NIST 800-53 Rev 5 Moderate Baseline</p>
              )}
            </div>
          </div>
          {complianceScore && (
            <div className="text-xs text-text-dim">
              Trend: <span className="font-medium text-text-primary">{complianceScore.trend}</span>
            </div>
          )}
        </div>
      </div>

      {/* Subtab Navigation */}
      <div className="mb-6 flex items-center gap-1 border-b border-border">
        <button
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeSubtab === 'controls'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-dim hover:text-text-primary'
          }`}
          onClick={() => setActiveSubtab('controls')}
        >
          <span className="inline-flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Controls
          </span>
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeSubtab === 'live-report'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-dim hover:text-text-primary'
          }`}
          onClick={() => setActiveSubtab('live-report')}
        >
          <span className="inline-flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Live Report
          </span>
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeSubtab === 'documents'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-dim hover:text-text-primary'
          }`}
          onClick={() => setActiveSubtab('documents')}
        >
          <span className="inline-flex items-center gap-2">
            <Download className="w-4 h-4" />
            Documents
          </span>
        </button>
      </div>

      {activeSubtab === 'controls' && (<>
      {/* Section 1: Compliance Summary Cards -- clickable */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Compliance Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Controls Implemented */}
          <button
            type="button"
            className="bg-card border border-border rounded-[var(--radius)] p-5 text-left hover:border-accent transition-colors cursor-pointer"
            onClick={() => scrollToAndExpand('controls')}
          >
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Controls Implemented
            </h3>
            <div className="text-2xl font-bold font-mono text-green">
              {implementedControls}/{totalControls}
            </div>
            <div className="mt-2 w-full h-2 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-green rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[11px] text-text-dim mt-1">{progressPct}% complete</div>
          </button>

          {/* NIST Families Covered */}
          <button
            type="button"
            className="bg-card border border-border rounded-[var(--radius)] p-5 text-left hover:border-accent transition-colors cursor-pointer"
            onClick={() => scrollToAndExpand('controls')}
          >
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              NIST Families Covered
            </h3>
            <div className="text-2xl font-bold font-mono text-green">
              {coveredFamilies}/11
            </div>
            <div className="text-[11px] text-text-dim mt-1">of 11 applicable families</div>
          </button>

          {/* Framework */}
          <button
            type="button"
            className="bg-card border border-border rounded-[var(--radius)] p-5 text-left hover:border-accent transition-colors cursor-pointer"
            onClick={() => scrollToAndExpand('controls')}
          >
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Framework
            </h3>
            <div className="text-lg font-bold font-mono text-accent">NIST 800-53 r5</div>
            <div className="text-[11px] text-text-dim mt-1">+ CMMC 2.0 Level 2</div>
          </button>

          {/* Platform Status */}
          <button
            type="button"
            className="bg-card border border-border rounded-[var(--radius)] p-5 text-left hover:border-accent transition-colors cursor-pointer"
            onClick={() => scrollToAndExpand('audit')}
          >
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Platform Status
            </h3>
            {partialControls > 0 ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow" />
                <span className="text-lg font-bold text-yellow">Partial</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green" />
                <span className="text-lg font-bold text-green">Operational</span>
              </div>
            )}
            <div className="text-[11px] text-text-dim mt-1">
              {partialControls > 0 ? `${partialControls} partial controls` : 'All controls active'}
            </div>
          </button>
        </div>
      </div>

      {/* Section 2: Control Family Status */}
      <div className="mb-6" ref={controlFamilySectionRef}>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Control Family Status
        </h2>
        <div className="space-y-2">
          {CONTROL_FAMILIES.map((family) => {
            const isExpanded = expandedFamily === family.id;
            const familyImplemented = family.controls.filter((c) => c.status === 'implemented').length;
            const allImplemented = familyImplemented === family.controls.length;
            const familyHealth = getFamilyHealth(family);

            return (
              <div
                key={family.id}
                className="bg-card border border-border rounded-[var(--radius)] overflow-hidden"
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface/50 transition-colors"
                  onClick={() => toggleFamily(family.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${allImplemented ? 'bg-green' : 'bg-yellow'}`} />
                    <div>
                      <span className="text-sm font-semibold text-text-bright">
                        {family.id} -- {family.name}
                      </span>
                      <span className="text-xs text-text-dim ml-2">{family.description}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Real-time health dot */}
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${healthDotColor(familyHealth)}`}
                      title={`Service health: ${familyHealth}`}
                    />
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                      allImplemented ? 'bg-green/15 text-green' : 'bg-yellow/15 text-yellow'
                    }`}>
                      {familyImplemented}/{family.controls.length} controls
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-dim" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-dim" />
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-border bg-surface/30">
                    {/* Individual controls table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th className="py-2 px-4 text-text-dim font-medium w-[90px]">Control</th>
                            <th className="py-2 px-4 text-text-dim font-medium w-[200px]">Name</th>
                            <th className="py-2 px-4 text-text-dim font-medium w-[100px]">Status</th>
                            <th className="py-2 px-4 text-text-dim font-medium w-[60px]">Health</th>
                            <th className="py-2 px-4 text-text-dim font-medium">Implementation</th>
                            <th className="py-2 px-4 text-text-dim font-medium w-[120px]">Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {family.controls.map((ctrl) => {
                            const ctrlHealth = getControlHealth(ctrl);
                            return (
                              <tr key={ctrl.id} className="border-b border-border/50 hover:bg-surface/50">
                                <td className="py-2.5 px-4 font-mono font-semibold text-text-bright">
                                  {ctrl.id}
                                </td>
                                <td className="py-2.5 px-4 text-text-primary truncate" title={ctrl.name}>
                                  {ctrl.name}
                                </td>
                                <td className="py-2.5 px-4">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotColor(ctrl.status)}`} />
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusBadgeClass(ctrl.status)}`}>
                                      {statusLabel(ctrl.status)}
                                    </span>
                                  </span>
                                </td>
                                <td className="py-2.5 px-4">
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${healthDotColor(ctrlHealth)}`}
                                    title={ctrlHealth === 'healthy' ? 'Services healthy' : ctrlHealth === 'degraded' ? 'Services degraded' : 'No health data'}
                                  />
                                </td>
                                <td className="py-2.5 px-4 text-text-dim truncate" title={ctrl.implementation}>
                                  {ctrl.implementation}
                                </td>
                                <td className="py-2.5 px-4">
                                  {ctrl.evidenceSources && ctrl.evidenceSources.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {ctrl.evidenceSources.map((es) =>
                                        es.url ? (
                                          <a
                                            key={es.name}
                                            href={resolveUrl(es.url)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline"
                                            title={es.name}
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                            <span className="truncate max-w-[80px]">{es.name.split(' ')[0]}</span>
                                          </a>
                                        ) : (
                                          <span
                                            key={es.name}
                                            className="text-[10px] text-text-dim"
                                            title={es.name}
                                          >
                                            {es.name.split(' ')[0]}
                                          </span>
                                        ),
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-text-dim">--</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Audit Trail */}
      <div className="mb-6" ref={auditSectionRef}>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Audit Trail
        </h2>
        {auditLoading && allEvents.length === 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="card-base overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Kubernetes Events</h3>
              <div className="flex flex-wrap items-center gap-2">
                <AuditFilters
                  typeFilter={typeFilter}
                  nsFilter={nsFilter}
                  searchText={searchText}
                  namespaces={namespaces}
                  onTypeChange={(t) => { setTypeFilter(t); setPage(0); }}
                  onNsChange={(n) => { setNsFilter(n); setPage(0); }}
                  onSearchChange={(s) => { setSearchText(s); setPage(0); }}
                />
              </div>
            </div>
            <AuditTable events={pageEvents} onRowClick={setSelectedEvent} />
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs">
              <div className="flex items-center gap-3">
                <span className="text-text-dim">
                  {filtered.length} event{filtered.length !== 1 ? 's' : ''}
                </span>
                <select
                  className="form-input !mb-0 text-xs py-1 px-2 min-w-[70px]"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === 0 ? 'All' : opt}
                    </option>
                  ))}
                </select>
              </div>
              {pageSize !== 0 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                    Prev
                  </Button>
                  <span className="text-text-dim px-2">{page + 1} / {totalPages}</span>
                  <Button size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Evidence Collection */}
      <div>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Evidence Sources
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EVIDENCE_SOURCES.map((source) => (
            <div
              key={source.name}
              className="bg-card border border-border rounded-[var(--radius)] p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-bright">{source.name}</h3>
                {source.url && (
                  <a
                    href={resolveUrl(source.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-dim hover:text-accent transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              <p className="text-xs text-text-dim mb-2">{source.description}</p>
              <div className="flex flex-wrap gap-1">
                {source.controls.map((ctrl) => (
                  <span
                    key={ctrl}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent"
                  >
                    {ctrl}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      </>)}

      {activeSubtab === 'live-report' && (
        <div>
          {/* Report Header with Refresh and Download */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Live Compliance Report
              </h2>
              {reportData && (
                <span className="inline-flex items-center gap-1.5 text-xs text-text-dim">
                  <Clock className="w-3 h-3" />
                  Last scanned: {new Date(reportData.scanDate).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn text-sm inline-flex items-center gap-2"
                onClick={() => { setReportData(null); handleGenerateReport(); }}
                disabled={reportLoading}
              >
                <RefreshCw className={`w-4 h-4 ${reportLoading ? 'animate-spin' : ''}`} />
                {reportLoading ? 'Scanning...' : 'Refresh'}
              </button>
              {reportData && (
                <button
                  className="btn text-sm inline-flex items-center gap-2"
                  onClick={downloadReportHtml}
                >
                  <Download className="w-4 h-4" />
                  Download as HTML
                </button>
              )}
            </div>
          </div>

          {/* Error Banner */}
          {reportError && (
            <div className="mb-4 px-4 py-3 rounded border text-sm"
                 style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--red)' }}>
              {reportError} --{' '}
              <button className="underline" onClick={handleGenerateReport}>Retry</button>
            </div>
          )}

          {/* Loading state */}
          {reportLoading && !reportData && (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-[var(--radius)] p-8 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-sm text-text-dim">Scanning platform compliance...</p>
                </div>
              </div>
            </div>
          )}

          {/* Report Content */}
          {reportData && (
            <>
              {/* Compliance Score Circle */}
              <div className="mb-6 bg-card border border-border rounded-[var(--radius)] p-6">
                <div className="flex items-center gap-8">
                  {/* Score circle */}
                  <div className="relative flex-shrink-0">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle
                        cx="60" cy="60" r="52"
                        fill="none"
                        stroke="var(--border)"
                        strokeWidth="8"
                      />
                      <circle
                        cx="60" cy="60" r="52"
                        fill="none"
                        stroke={
                          reportData.summary.compliancePercentage >= 90 ? 'var(--green)' :
                          reportData.summary.compliancePercentage >= 70 ? 'var(--yellow)' : 'var(--red)'
                        }
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${(reportData.summary.compliancePercentage / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                        transform="rotate(-90 60 60)"
                        className="transition-all duration-700"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span
                        className="text-2xl font-bold font-mono"
                        style={{
                          color: reportData.summary.compliancePercentage >= 90 ? 'var(--green)' :
                                 reportData.summary.compliancePercentage >= 70 ? 'var(--yellow)' : 'var(--red)',
                        }}
                      >
                        {reportData.summary.compliancePercentage}%
                      </span>
                      <span className="text-[10px] text-text-dim uppercase tracking-wider">Compliant</span>
                    </div>
                  </div>

                  {/* Summary cards */}
                  <div className="flex-1 grid grid-cols-3 gap-4">
                    <div className="bg-surface border border-border rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold font-mono text-green">{reportData.summary.pass}</div>
                      <div className="text-[11px] text-text-dim uppercase tracking-wider mt-1">Pass</div>
                    </div>
                    <div className="bg-surface border border-border rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold font-mono text-yellow">{reportData.summary.partial}</div>
                      <div className="text-[11px] text-text-dim uppercase tracking-wider mt-1">Partial</div>
                    </div>
                    <div className="bg-surface border border-border rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold font-mono text-red">{reportData.summary.fail}</div>
                      <div className="text-[11px] text-text-dim uppercase tracking-wider mt-1">Fail</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-xs text-text-dim text-center">
                  {reportData.summary.total} total controls assessed -- {reportData.title}
                </div>
              </div>

              {/* Controls grouped by family in expandable sections */}
              <div className="space-y-2">
                {(() => {
                  const families = new Map<string, typeof reportData.controls>();
                  reportData.controls.forEach(c => {
                    if (!families.has(c.family)) families.set(c.family, []);
                    families.get(c.family)!.push(c);
                  });
                  return Array.from(families.entries()).map(([family, controls]) => {
                    const passCount = controls.filter(c => c.status === 'PASS').length;
                    const partialCount = controls.filter(c => c.status === 'PARTIAL').length;
                    const failCount = controls.filter(c => c.status === 'FAIL').length;
                    const allPass = passCount === controls.length;
                    const isExpanded = expandedReportFamily === family;

                    return (
                      <div
                        key={family}
                        className="bg-card border border-border rounded-[var(--radius)] overflow-hidden"
                      >
                        <div
                          className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface/50 transition-colors"
                          onClick={() => setExpandedReportFamily(isExpanded ? null : family)}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                              allPass ? 'bg-green' : failCount > 0 ? 'bg-red' : 'bg-yellow'
                            }`} />
                            <span className="text-sm font-semibold text-text-bright">{family}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {passCount > 0 && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/15 text-green">
                                {passCount} pass
                              </span>
                            )}
                            {partialCount > 0 && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow/15 text-yellow">
                                {partialCount} partial
                              </span>
                            )}
                            {failCount > 0 && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red/15 text-red">
                                {failCount} fail
                              </span>
                            )}
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-text-dim" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-text-dim" />
                            )}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border bg-surface/30">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                                <thead>
                                  <tr className="border-b border-border text-left">
                                    <th className="py-2 px-4 text-text-dim font-medium w-[90px]">Control</th>
                                    <th className="py-2 px-4 text-text-dim font-medium w-[200px]">Description</th>
                                    <th className="py-2 px-4 text-text-dim font-medium w-[80px]">Status</th>
                                    <th className="py-2 px-4 text-text-dim font-medium">Evidence</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {controls.map(c => (
                                    <tr key={c.control} className="border-b border-border/50 hover:bg-surface/50">
                                      <td className="py-2.5 px-4 font-mono font-semibold text-text-bright">{c.control}</td>
                                      <td className="py-2.5 px-4 text-text-primary">{c.description}</td>
                                      <td className="py-2.5 px-4">
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                          c.status === 'PASS' ? 'bg-green/15 text-green' :
                                          c.status === 'PARTIAL' ? 'bg-yellow/15 text-yellow' :
                                          'bg-red/15 text-red'
                                        }`}>
                                          {c.status}
                                        </span>
                                      </td>
                                      <td className="py-2.5 px-4 text-text-dim">{c.evidence}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {activeSubtab === 'documents' && (
        <div>
          <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-4 flex items-center gap-2">
            <Download className="w-4 h-4" />
            Compliance Documents
          </h2>
          <p className="text-xs text-text-dim mb-6">
            Download machine-readable compliance artifacts for your ATO package. These are generated from live platform state.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* SSP Download Card */}
            <div className="bg-card border border-border rounded-[var(--radius)] p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-accent/10">
                  <FileText className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-bright">System Security Plan (SSP)</h3>
                  <p className="text-xs text-text-dim mt-1">
                    OSCAL-format SSP covering all NIST 800-53 controls implemented by the platform.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text-dim mb-4">
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">JSON</span>
                <span>NIST 800-53 Rev 5</span>
              </div>
              <button
                className="btn btn-primary text-sm w-full inline-flex items-center justify-center gap-2"
                onClick={() => downloadFile(
                  '/api/compliance/ssp?download=true',
                  `ssp-${new Date().toISOString().slice(0, 10)}.json`,
                  setSspDownloading,
                )}
                disabled={sspDownloading}
              >
                <Download className={`w-4 h-4 ${sspDownloading ? 'animate-pulse' : ''}`} />
                {sspDownloading ? 'Downloading...' : 'Download SSP (JSON)'}
              </button>
            </div>

            {/* ATO Package Download Card */}
            <div className="bg-card border border-border rounded-[var(--radius)] p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-green/10">
                  <Shield className="w-5 h-5 text-green" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-bright">ATO Package</h3>
                  <p className="text-xs text-text-dim mt-1">
                    Complete ATO package with SSP, control assessments, and platform evidence summary.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text-dim mb-4">
                <span className="px-1.5 py-0.5 rounded bg-green/10 text-green font-mono">JSON</span>
                <span>FedRAMP / CMMC 2.0</span>
              </div>
              <button
                className="btn btn-primary text-sm w-full inline-flex items-center justify-center gap-2"
                onClick={() => downloadFile(
                  '/api/compliance/ato-package?download=true',
                  `ato-package-${new Date().toISOString().slice(0, 10)}.json`,
                  setAtoDownloading,
                )}
                disabled={atoDownloading}
              >
                <Download className={`w-4 h-4 ${atoDownloading ? 'animate-pulse' : ''}`} />
                {atoDownloading ? 'Downloading...' : 'Download ATO Package (JSON)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      <Modal open={selectedEvent !== null} onClose={() => setSelectedEvent(null)} className="max-w-xl w-full">
        {selectedEvent && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-text-bright">Event Detail</h3>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-text-dim hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Type</span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                  selectedEvent.type === 'Warning'
                    ? 'bg-yellow/15 text-yellow'
                    : selectedEvent.type === 'Error'
                      ? 'bg-red/15 text-red'
                      : 'bg-green/15 text-green'
                }`}>
                  {selectedEvent.type}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Time</span>
                <span className="text-text-primary">
                  {selectedEvent.timestamp ? new Date(selectedEvent.timestamp).toLocaleString() : 'N/A'}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Namespace</span>
                <span className="text-text-primary">{selectedEvent.namespace || 'N/A'}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Resource</span>
                <span className="text-text-primary font-mono text-xs">
                  {selectedEvent.kind}/{selectedEvent.name}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Reason</span>
                <span className="text-text-primary">{selectedEvent.reason}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-text-dim font-mono w-24 flex-shrink-0">Message</span>
                <span className="text-text-primary break-words whitespace-pre-wrap">{selectedEvent.message}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
