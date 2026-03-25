# System Security Plan (SSP) -- Control Implementation Narratives

**System Name:** Secure Runtime Environment (SRE)
**Framework:** NIST SP 800-53 Rev 5
**Baseline:** Moderate
**Generated:** 2026-03-25T22:03:35Z
**Total Controls:** 47
**Implemented:** 47

---

## Table of Contents

- [Access Control](#access-control) (AC-14, AC-17, AC-2, AC-3, AC-4, AC-6, AC-6(1), AC-6(10), AC-6(9))
- [Assessment, Authorization, and Monitoring](#assessment-authorization-and-monitoring) (CA-7, CA-8)
- [Audit and Accountability](#audit-and-accountability) (AU-12, AU-2, AU-3, AU-4, AU-5, AU-6, AU-8, AU-9)
- [Configuration Management](#configuration-management) (CM-11, CM-2, CM-3, CM-5, CM-6, CM-7, CM-8)
- [Identification and Authentication](#identification-and-authentication) (IA-2, IA-3, IA-5, IA-8)
- [Incident Response](#incident-response) (IR-4, IR-5, IR-6)
- [Media Protection](#media-protection) (MP-2)
- [Risk Assessment](#risk-assessment) (RA-5)
- [System and Communications Protection](#system-and-communications-protection) (SC-12, SC-13, SC-28, SC-3, SC-7, SC-8)
- [System and Information Integrity](#system-and-information-integrity) (SI-2, SI-3, SI-4, SI-5, SI-6, SI-7)
- [System and Services Acquisition](#system-and-services-acquisition) (SA-10, SA-11)

---

## Access Control

### AC-14: Permitted Actions Without Identification

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Istio PeerAuthentication set to STRICT mode cluster-wide prevents any unauthenticated service-to-service communication. All mesh traffic requires valid mTLS certificates. Non-mesh traffic is blocked by default via Kyverno policies requiring Istio sidecar injection labels on all tenant namespaces.

**Responsible Components:** Istio Service Mesh

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-istiod.yaml (PeerAuthentication configured in HelmRelease values)`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio telemetry reports mTLS status for all connections. Prometheus metrics track non-mTLS connection attempts.

---

### AC-17: Remote Access

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

All remote access to management interfaces (Grafana, Harbor, NeuVector, Kiali) is routed through Keycloak SSO with MFA enforcement. Istio ingress gateway provides TLS termination for all external traffic. SSH access to cluster nodes is hardened via Ansible STIG role (key-only auth, restricted ciphers, login banners, session timeouts).

**Responsible Components:** Keycloak Identity and Access Management, Istio Service Mesh, Ansible OS Hardening Automation

**Evidence Artifacts:**

- `platform/addons/keycloak/helmrelease.yaml`
- `platform/core/istio/helmrelease-gateway.yaml`
- `infrastructure/ansible/roles/os-hardening/tasks/sshd.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Keycloak authentication logs forwarded to Loki. SSH login attempts logged via auditd and forwarded to Loki.

---

### AC-2: Account Management

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Keycloak provides centralized identity management with SSO/OIDC for all platform UIs. User accounts are managed through Keycloak realms with group-based access control. Account provisioning, modification, and deprovisioning are tracked via Keycloak audit events. Supports LDAP/AD federation for enterprise identity integration. Inactive accounts are automatically disabled based on configurable session and account policies.

**Responsible Components:** Keycloak Identity and Access Management

**Evidence Artifacts:**

- `platform/addons/keycloak/helmrelease.yaml (realm configured in HelmRelease values)`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Keycloak audit events forwarded to Loki via Alloy. Grafana dashboards show account lifecycle events.

---

### AC-3: Access Enforcement

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Access enforcement operates at three layers: (1) Kubernetes RBAC with namespace-scoped Roles and ClusterRoles mapped to Keycloak groups via OIDC, (2) Istio AuthorizationPolicy CRDs controlling service-to-service communication based on SPIFFE identity, namespace, and request attributes, (3) Kyverno policies isolating tenant namespaces and preventing cross-tenant resource creation or modification.

**Responsible Components:** Kyverno Policy Engine, Istio Service Mesh, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `platform/core/kyverno/helmrelease.yaml`
- `platform/core/istio/helmrelease-istiod.yaml (AuthorizationPolicy configured in HelmRelease values)`
- `apps/tenants/_base/rbac.yaml`
- `apps/tenants/_base/kustomization.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kubernetes audit logs capture all RBAC decisions. Istio access logs record all AuthorizationPolicy evaluations. Kyverno PolicyReports track policy enforcement actions.

---

### AC-4: Information Flow Enforcement

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Information flow is controlled through: (1) Istio mTLS STRICT mode encrypting and authenticating all in-cluster traffic, (2) Kubernetes NetworkPolicies with default-deny in all namespaces and explicit allow rules for required traffic paths, (3) Kyverno policies requiring NetworkPolicies in every namespace and restricting egress to approved destinations, (4) NeuVector Layer 7 DLP sensors detecting and blocking sensitive data patterns in network traffic.

**Responsible Components:** Istio Service Mesh, Kyverno Policy Engine, NeuVector Runtime Security

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-istiod.yaml (PeerAuthentication configured in HelmRelease values)`
- `apps/tenants/_base/network-policies/default-deny.yaml`
- `apps/tenants/_base/network-policies/allow-base.yaml`
- `policies/custom/require-network-policies.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio telemetry tracks all traffic flows. NeuVector visualizes network connections and alerts on policy violations. Kyverno background scanning reports namespaces without NetworkPolicies.

---

### AC-6: Least Privilege

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Least privilege is enforced at every layer: (1) RBAC roles scoped to individual namespaces, (2) Pod security contexts enforce runAsNonRoot, readOnlyRootFilesystem, drop ALL capabilities, and seccompProfile RuntimeDefault, (3) automountServiceAccountToken set to false by default, (4) Each workload uses a dedicated ServiceAccount, (5) Kyverno ClusterPolicies enforce these requirements on all pods in tenant namespaces.

**Responsible Components:** Kyverno Policy Engine, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `policies/custom/require-security-context.yaml`
- `policies/restricted/require-run-as-nonroot.yaml`
- `policies/restricted/require-drop-all-capabilities.yaml`
- `apps/tenants/_base/rbac.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno PolicyReports flag pods not meeting least privilege requirements. Background scanning reports existing non-compliant workloads.

---

### AC-6(1): Authorize Access to Security Functions

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Flux RBAC restricts platform namespace modifications to the flux-system ServiceAccount only. Kyverno policies protect platform resources (namespaces, CRDs, system configurations) from unauthorized modification by tenant users. Only the GitOps pipeline can modify platform-level resources.

**Responsible Components:** Flux CD GitOps Engine, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`
- `policies/custom/require-labels.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kubernetes audit logs capture all attempts to modify platform resources. Kyverno violations are reported as PolicyReport entries.

---

### AC-6(10): Prohibit Non-Privileged Users from Executing Privileged Functions

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Kyverno enforces Pod Security Standards restricted profile: disallow-privileged-containers prevents running as privileged, disallow-privilege-escalation blocks allowPrivilegeEscalation, require-run-as-nonroot enforces non-root execution, and require-drop-all-capabilities ensures no Linux capabilities are granted.

**Responsible Components:** Kyverno Policy Engine

**Evidence Artifacts:**

- `policies/baseline/disallow-privileged.yaml`
- `policies/restricted/disallow-privilege-escalation.yaml`
- `policies/restricted/require-run-as-nonroot.yaml`
- `policies/restricted/require-drop-all-capabilities.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno PolicyReports and background scanning continuously validate all workloads against restricted profile.

---

### AC-6(9): Auditing Use of Privileged Functions

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

All privileged operations are logged: (1) Kubernetes API audit policy captures authentication, authorization, and CRUD on all resources with user identity, (2) Istio access logs record all service mesh traffic with source/destination SPIFFE identity, (3) OS-level auditd captures privileged command execution and file access on all nodes.

**Responsible Components:** Loki/Alloy Logging Stack, Istio Service Mesh

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-alloy.yaml`
- `platform/core/istio/helmrelease-istiod.yaml`
- `infrastructure/ansible/roles/os-hardening/tasks/auditd.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Grafana dashboards show privileged operation activity. Prometheus alerts on unusual privileged access patterns.

---

## Assessment, Authorization, and Monitoring

### CA-7: Continuous Monitoring

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Continuous monitoring is provided by: (1) Prometheus + Grafana for real-time infrastructure and application metrics, (2) NeuVector for runtime anomaly detection and behavioral monitoring, (3) Kyverno PolicyReports for continuous compliance assessment against security policies, (4) Loki for centralized log analysis, (5) Tempo for distributed tracing. All monitoring data feeds Grafana dashboards for unified visibility.

**Responsible Components:** Prometheus/Grafana Monitoring Stack, NeuVector Runtime Security, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/core/monitoring/helmrelease.yaml`
- `platform/core/runtime-security/helmrelease.yaml`
- `platform/core/kyverno/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Self-monitoring: Prometheus monitors its own health and the health of all monitoring components.

---

### CA-8: Penetration Testing

**Priority:** P2 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Automated security testing is provided by: (1) NeuVector vulnerability scanning of running containers identifying known CVEs, (2) Trivy image scanning in Harbor detecting vulnerabilities before deployment, (3) NeuVector CIS benchmark scanning validating node and container configurations against security standards.

**Responsible Components:** NeuVector Runtime Security, Harbor Container Registry

**Evidence Artifacts:**

- `platform/core/runtime-security/helmrelease.yaml`
- `platform/addons/harbor/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Scan results reported via NeuVector dashboard and Prometheus metrics.

---

## Audit and Accountability

### AU-12: Audit Generation

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Audit generation is implemented at every layer: (1) All platform components output structured JSON logs to stdout/stderr, (2) Alloy DaemonSet runs on every node to collect container logs and node journals, (3) Kubernetes API server audit logging enabled by default in RKE2 with comprehensive audit policy, (4) OS-level auditd configured via Ansible with rules for privileged operations, (5) Istio sidecar proxies generate access logs for all mesh traffic.

**Responsible Components:** Loki/Alloy Logging Stack, Ansible OS Hardening Automation

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-alloy.yaml`
- `infrastructure/ansible/roles/os-hardening/tasks/auditd.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Prometheus monitors Alloy DaemonSet health and log ingestion rates. Alerts fire when audit generation stops.

---

### AU-2: Audit Events

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Audit events are generated from multiple sources: (1) Kubernetes API server audit policy captures all authentication, authorization, resource create/read/update/delete, and admission decisions, (2) Istio access logs capture all HTTP/gRPC traffic with full request metadata, (3) OS-level auditd captures privileged command execution, file access, and system calls on all nodes, (4) OpenBao audit logs capture all secrets access and management operations.

**Responsible Components:** Loki/Alloy Logging Stack, Istio Service Mesh, Ansible OS Hardening Automation

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-alloy.yaml`
- `infrastructure/ansible/roles/os-hardening/tasks/auditd.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Prometheus alerts on audit log collection failures. Grafana dashboards show audit event volume and types.

---

### AU-3: Content of Audit Records

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

All audit records contain structured JSON with: timestamp (UTC ISO 8601), source component, user/service identity, action performed (HTTP method, K8s verb), target resource (URI, K8s resource), outcome (HTTP status, allow/deny), source IP address, and request ID for correlation. Kubernetes audit logs follow the k8s.io audit/v1 schema. Istio access logs follow Envoy access log format with SPIFFE identity fields.

**Responsible Components:** Loki/Alloy Logging Stack

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-alloy.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Log format validation via Alloy pipeline stages. Alerts on malformed audit records.

---

### AU-4: Audit Storage Capacity

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Loki provides scalable log storage with S3-compatible object storage backend (MinIO for dev, S3 for production). Storage capacity scales with the object store. Configurable retention policies: 30 days default, 90 days for audit-classified logs. Prometheus alerts on storage capacity thresholds.

**Responsible Components:** Loki/Alloy Logging Stack

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-loki.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Prometheus metrics track Loki storage usage. AlertManager fires on storage approaching capacity thresholds.

---

### AU-5: Response to Audit Processing Failures

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Prometheus alerts are configured for: Loki ingestion rate drops, Alloy DaemonSet pod failures, Loki disk pressure, audit log pipeline errors, and auditd service failures on nodes. AlertManager routes these critical alerts to platform administrators via configured receivers (Slack, email, PagerDuty).

**Responsible Components:** Prometheus/Grafana Monitoring Stack, Loki/Alloy Logging Stack

**Evidence Artifacts:**

- `platform/core/monitoring/sre-alerting-rules.yaml`
- `platform/core/logging/helmrelease-loki.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Prometheus continuously monitors audit pipeline health. AlertManager provides multi-channel notification.

---

### AU-6: Audit Review, Analysis, and Reporting

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Grafana provides centralized audit review with pre-built dashboards for: Kubernetes API audit log analysis, Istio traffic patterns, authentication failures, privilege escalation attempts, Kyverno policy violations, and NeuVector security events. LogQL queries enable ad-hoc investigation. Dashboards are exportable as PDF/PNG for compliance reporting.

**Responsible Components:** Prometheus/Grafana Monitoring Stack

**Evidence Artifacts:**

- `platform/core/monitoring/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Dashboards are continuously updated with real-time data. Scheduled reports can be configured via Grafana reporting.

---

### AU-8: Time Stamps

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

NTP (chronyd) is configured on all cluster nodes via Ansible os-hardening role, synchronizing to approved time sources. All logs use UTC timestamps in ISO 8601 format. Kubernetes, Istio, and all platform components output timestamps in UTC.

**Responsible Components:** Ansible OS Hardening Automation

**Evidence Artifacts:**

- `infrastructure/ansible/roles/os-hardening/tasks/main.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** NTP synchronization status monitored via node_exporter metrics in Prometheus.

---

### AU-9: Protection of Audit Information

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Audit log integrity is protected through: (1) Loki log storage encrypted at rest via object storage encryption, (2) RBAC restricts Loki/Grafana access to authorized audit team members via Keycloak groups, (3) Kubernetes RBAC prevents tenant users from accessing logging namespace resources, (4) Retention policies prevent premature deletion of audit records.

**Responsible Components:** Loki/Alloy Logging Stack

**Evidence Artifacts:**

- `platform/core/logging/helmrelease-loki.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Access to logging namespace monitored via Kubernetes audit logs. Storage encryption verified via cloud provider controls.

---

## Configuration Management

### CM-11: User-Installed Software

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

User-installed software is controlled through: (1) Kyverno restrict-image-registries policy only allows images from harbor.sre.internal, blocking all other registries, (2) Kyverno verify-image-signatures policy enforces Cosign signature verification on all pod images, (3) Harbor Trivy scanning prevents deployment of images with unacceptable vulnerability levels.

**Responsible Components:** Kyverno Policy Engine, Harbor Container Registry

**Evidence Artifacts:**

- `policies/custom/restrict-image-registries.yaml`
- `policies/custom/verify-image-signatures.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno PolicyReports flag attempts to use unauthorized registries. Harbor scan reports track vulnerability status of all images.

---

### CM-2: Baseline Configuration

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

The Git repository is the authoritative baseline configuration for the entire platform. Flux CD continuously reconciles cluster state to match Git, providing automated drift detection and remediation. Every component version is pinned in HelmRelease manifests. The complete baseline is version-controlled with full Git history.

**Responsible Components:** Flux CD GitOps Engine

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`
- `platform/core/kustomization.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Flux reconciliation status reported via Prometheus metrics. Alerts fire on reconciliation failures or sustained drift.

---

### CM-3: Configuration Change Control

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

All configuration changes follow the Git PR workflow: (1) Changes proposed as feature branches, (2) Peer review required for merge, (3) CI validates changes (linting, policy tests, compliance checks), (4) Conventional commits provide structured change descriptions, (5) Flux CD automatically applies merged changes, (6) Complete change audit trail in Git history with author, timestamp, and approval.

**Responsible Components:** Flux CD GitOps Engine

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Git commit history provides complete change record. Flux events logged to Loki.

---

### CM-5: Access Restrictions for Change

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Change restrictions are enforced through: (1) Git branch protection rules requiring review before merge, (2) Flux RBAC restricting reconciliation to flux-system ServiceAccount, (3) Kyverno policies preventing manual kubectl changes to platform resources, (4) Kubernetes RBAC restricting direct API access to platform namespaces.

**Responsible Components:** Flux CD GitOps Engine, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`
- `policies/custom/require-labels.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kubernetes audit logs capture all API access attempts. Kyverno violations logged for unauthorized change attempts.

---

### CM-6: Configuration Settings

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Configuration settings are enforced at three layers: (1) Ansible STIG roles apply DISA STIG for Rocky Linux 9 covering SSH, auditd, PAM, filesystem permissions, kernel parameters, FIPS mode, SELinux, and crypto policy, (2) RKE2 CIS 1.23 benchmark profile enabled by default hardening the Kubernetes control plane and kubelet, (3) Kyverno policies enforce workload configuration including security contexts, resource limits, labels, and image restrictions.

**Responsible Components:** Ansible OS Hardening Automation, Kyverno Policy Engine, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `infrastructure/ansible/roles/os-hardening/tasks/main.yml`
- `infrastructure/ansible/roles/os-hardening/tasks/sshd.yml`
- `infrastructure/ansible/roles/os-hardening/tasks/auditd.yml`
- `infrastructure/ansible/roles/os-hardening/tasks/crypto-policy.yml`
- `policies/custom/require-security-context.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno background scanning reports non-compliant configurations. NeuVector CIS benchmark scanning validates runtime configuration.

---

### CM-7: Least Functionality

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Least functionality is enforced through: (1) Kyverno policies restricting capabilities (drop ALL), disallowing privileged containers, restricting volume types (no hostPath), preventing host namespace access, and blocking host ports, (2) NeuVector behavioral learning creates process whitelists and blocks unexpected processes in protect mode, (3) SELinux enforcing mode restricts process capabilities at the OS level.

**Responsible Components:** Kyverno Policy Engine, NeuVector Runtime Security

**Evidence Artifacts:**

- `policies/custom/require-security-context.yaml`
- `policies/baseline/disallow-privileged.yaml`
- `policies/restricted/restrict-volume-types.yaml`
- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno PolicyReports track policy enforcement. NeuVector alerts on blocked processes and unexpected behavior.

---

### CM-8: Information System Component Inventory

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Component inventory is maintained through: (1) Flux CD tracks all deployed platform components with exact version pinning in HelmRelease manifests, (2) Harbor maintains a complete image inventory with vulnerability scan results and SBOMs for every container image, (3) Git repository provides the authoritative list of all infrastructure and platform components.

**Responsible Components:** Flux CD GitOps Engine, Harbor Container Registry

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`
- `platform/core/kustomization.yaml`
- `platform/addons/harbor/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Flux reports all deployed component versions. Harbor tracks all image versions with scan status.

---

## Identification and Authentication

### IA-2: Identification and Authentication (Organizational Users)

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

All organizational users authenticate via Keycloak SSO with OIDC integration. Keycloak provides: MFA enforcement for all users, password policies (complexity, expiration, history), session management with configurable timeouts, LDAP/AD federation for enterprise identity, and SAML support for government identity systems (CAC/PIV).

**Responsible Components:** Keycloak Identity and Access Management

**Evidence Artifacts:**

- `platform/addons/keycloak/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Authentication events logged and forwarded to Loki. Failed login attempts trigger Prometheus alerts.

---

### IA-3: Device Identification and Authentication

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Workload (device) identity is provided by Istio mTLS with SPIFFE identities. Every workload receives a cryptographic X.509 certificate with identity spiffe://cluster.local/ns/<namespace>/sa/<serviceaccount>. Mutual authentication is enforced for all mesh communication via PeerAuthentication STRICT mode.

**Responsible Components:** Istio Service Mesh

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-istiod.yaml (PeerAuthentication configured in HelmRelease values)`
- `platform/core/istio/helmrelease-istiod.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio telemetry reports mTLS connection status. Certificate issuance and rotation tracked via istiod metrics.

---

### IA-5: Authenticator Management

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Authenticator lifecycle management: (1) Keycloak enforces password policies including complexity requirements, expiration, and history, (2) cert-manager automates TLS certificate issuance, renewal, and revocation with configurable lifetimes, (3) OpenBao provides dynamic secret generation and automatic rotation for database credentials and API keys, (4) Istio workload certificates are automatically rotated by istiod with configurable TTL.

**Responsible Components:** Keycloak Identity and Access Management, cert-manager Certificate Management, OpenBao Secrets Management

**Evidence Artifacts:**

- `platform/core/cert-manager/helmrelease.yaml`
- `platform/core/openbao/helmrelease.yaml`
- `platform/addons/keycloak/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** cert-manager metrics track certificate expiry. OpenBao audit log tracks secret access and rotation. Prometheus alerts on certificates approaching expiry.

---

### IA-8: Identification and Authentication (Non-Organizational Users)

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

All external traffic enters through the Istio ingress gateway which enforces authentication via RequestAuthentication (JWT validation) and AuthorizationPolicy. No unauthenticated access is permitted to platform services. External API consumers must present valid JWT tokens issued by Keycloak.

**Responsible Components:** Istio Service Mesh

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-gateway.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio access logs capture all authentication decisions at the gateway. Failed authentication attempts trigger alerts.

---

## Incident Response

### IR-4: Incident Handling

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Incident handling workflow: (1) NeuVector detects runtime security events (process anomalies, network violations, file system modifications), (2) Events are forwarded to Prometheus via SYSLOG/Alloy, (3) AlertManager evaluates alert rules and routes to configured receivers (Slack, email, PagerDuty), (4) Grafana dashboards provide incident investigation with correlated metrics, logs, and traces, (5) Runbooks linked from alerts guide incident response procedures.

**Responsible Components:** NeuVector Runtime Security, Prometheus/Grafana Monitoring Stack

**Evidence Artifacts:**

- `platform/core/runtime-security/helmrelease.yaml`
- `platform/core/monitoring/sre-alerting-rules.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** AlertManager tracks alert history. NeuVector maintains security event timeline.

---

### IR-5: Incident Monitoring

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Incident monitoring sources: (1) NeuVector runtime security events for process, network, and file system anomalies, (2) Kyverno policy violation events for security policy breaches, (3) Prometheus alert history for infrastructure and application incidents, (4) Loki log queries for historical investigation, (5) Tempo distributed traces for request-level analysis.

**Responsible Components:** NeuVector Runtime Security, Kyverno Policy Engine, Prometheus/Grafana Monitoring Stack

**Evidence Artifacts:**

- `platform/core/runtime-security/helmrelease.yaml`
- `platform/core/monitoring/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Grafana dashboards provide real-time incident monitoring. Historical data retained per configured retention policies.

---

### IR-6: Incident Reporting

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Grafana dashboards provide exportable incident reports with timeline views, affected resources, alert history, and remediation status. Reports can be exported as PDF/PNG for formal incident documentation. Kyverno PolicyReports provide compliance violation history for security incident correlation.

**Responsible Components:** Prometheus/Grafana Monitoring Stack

**Evidence Artifacts:**

- `platform/core/monitoring/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Grafana reporting can be scheduled for periodic compliance and incident summary reports.

---

## Media Protection

### MP-2: Media Access

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Media access protection: (1) OpenBao access policies restrict secret retrieval to authorized workloads authenticated via Kubernetes ServiceAccount tokens, (2) Kubernetes Secrets are encrypted at rest using RKE2 default encryption configuration, (3) Persistent volume data protected by storage-level encryption.

**Responsible Components:** OpenBao Secrets Management, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `platform/core/openbao/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** OpenBao audit logs track all secret access. Encryption-at-rest status verified via RKE2 configuration.

---

## Risk Assessment

### RA-5: Vulnerability Scanning

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Vulnerability scanning at multiple stages: (1) Harbor + Trivy scans all container images automatically on push with configurable severity thresholds, (2) NeuVector performs runtime vulnerability scanning of running containers detecting newly published CVEs, (3) NeuVector CIS benchmark scanning validates node and container configurations, (4) Kyverno prevents deployment of images that fail scan gates.

**Responsible Components:** Harbor Container Registry, NeuVector Runtime Security

**Evidence Artifacts:**

- `platform/addons/harbor/helmrelease.yaml`
- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Harbor scan results available via API and UI. NeuVector vulnerability dashboard shows runtime CVE status. Prometheus alerts on critical vulnerability discoveries.

---

## System and Communications Protection

### SC-12: Cryptographic Key Establishment and Management

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Cryptographic key management: (1) cert-manager automates TLS certificate lifecycle with ClusterIssuers for internal CA and Let's Encrypt, (2) OpenBao PKI secrets engine issues and rotates internal certificates, (3) OpenBao auto-unseal uses cloud KMS for master key protection, (4) Istio istiod automatically issues and rotates workload certificates, (5) All cryptographic operations use FIPS 140-2 validated modules.

**Responsible Components:** cert-manager Certificate Management, OpenBao Secrets Management

**Evidence Artifacts:**

- `platform/core/cert-manager/helmrelease.yaml`
- `platform/core/openbao/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** cert-manager metrics track certificate lifecycle. OpenBao audit log tracks key usage. Prometheus alerts on expiring certificates.

---

### SC-13: Cryptographic Protection

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

FIPS 140-2 validated cryptography: (1) RKE2 compiled with GoBoring Go compiler providing FIPS 140-2 validated cryptographic module for all control plane and data plane operations, (2) Rocky Linux 9 configured with system-wide FIPS crypto policy via Ansible restricting all OS-level cryptography to FIPS-approved algorithms, (3) TLS 1.2+ enforced for all communications with FIPS-compliant cipher suites only.

**Responsible Components:** RKE2 Kubernetes Distribution, Ansible OS Hardening Automation

**Evidence Artifacts:**

- `infrastructure/ansible/roles/os-hardening/tasks/crypto-policy.yml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** FIPS mode status verified on nodes via Ansible facts. Crypto policy compliance checked by STIG validation scripts.

---

### SC-28: Protection of Information at Rest

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Data at rest encryption: (1) Kubernetes Secrets encrypted at rest via RKE2 default encryption configuration using AES-CBC, (2) OpenBao uses an encrypted storage backend with seal/unseal protection via KMS, (3) Loki log storage encrypted at rest via S3-compatible object storage encryption, (4) Persistent volumes can be encrypted via storage class configuration.

**Responsible Components:** OpenBao Secrets Management, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `platform/core/openbao/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Encryption status verified via RKE2 configuration audits. OpenBao seal status monitored via Prometheus.

---

### SC-3: Security Function Isolation

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Security function isolation: (1) Kubernetes namespaces provide resource isolation between platform components and tenants, (2) NetworkPolicies enforce default-deny communication between namespaces with explicit allow rules, (3) Istio AuthorizationPolicies provide service-level access control within and across namespaces, (4) Platform namespaces are protected from tenant modification by Kyverno policies.

**Responsible Components:** Istio Service Mesh, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-istiod.yaml (AuthorizationPolicy configured in HelmRelease values)`
- `apps/tenants/_base/network-policies/default-deny.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio telemetry tracks cross-namespace traffic. Kyverno reports unauthorized access attempts.

---

### SC-7: Boundary Protection

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Boundary protection layers: (1) Istio ingress gateway as the single entry point for all external traffic with TLS termination and traffic routing, (2) Istio egress gateway controlling all outbound cluster traffic, (3) Kubernetes NetworkPolicies with default-deny in all namespaces restricting both ingress and egress, (4) NeuVector network microsegmentation with Layer 7 DLP/WAF capabilities, (5) Cloud-level security groups (managed by OpenTofu) restricting node-level access.

**Responsible Components:** Istio Service Mesh, NeuVector Runtime Security

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-gateway.yaml`
- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio gateway metrics track ingress/egress traffic. NeuVector visualizes network boundaries and alerts on violations.

---

### SC-8: Transmission Confidentiality and Integrity

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

All data in transit is encrypted: (1) Istio mTLS STRICT mode encrypts all pod-to-pod traffic with TLS 1.2+ using FIPS-compliant cipher suites, (2) External traffic TLS-terminated at Istio ingress gateway with certificates from cert-manager, (3) RKE2 control plane uses mTLS for etcd, API server, and kubelet communication, (4) SSH connections to nodes use approved ciphers configured by Ansible.

**Responsible Components:** Istio Service Mesh, RKE2 Kubernetes Distribution

**Evidence Artifacts:**

- `platform/core/istio/helmrelease-istiod.yaml (PeerAuthentication configured in HelmRelease values)`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Istio reports mTLS status for all connections. Prometheus metrics track non-mTLS connection attempts.

---

## System and Information Integrity

### SI-2: Flaw Remediation

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Flaw remediation workflow: (1) Harbor + Trivy scanning identifies CVEs in container images with severity-based alerts, (2) Prometheus alerts notify teams of CRITICAL/HIGH vulnerabilities, (3) Flux CD GitOps enables automated image tag updates when patched versions are published, (4) Ansible playbooks apply OS-level security patches to cluster nodes, (5) NeuVector runtime scanning detects newly published CVEs in running workloads.

**Responsible Components:** Harbor Container Registry, Flux CD GitOps Engine, Ansible OS Hardening Automation

**Evidence Artifacts:**

- `platform/addons/harbor/helmrelease.yaml`
- `platform/flux-system/gotk-sync.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Harbor scan results continuously updated. NeuVector tracks runtime CVE status. Prometheus alerts on new critical findings.

---

### SI-3: Malicious Code Protection

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Runtime malicious code protection: (1) NeuVector process monitoring detects and blocks unauthorized processes based on behavioral learning baselines, (2) File system integrity monitoring detects unexpected file modifications including web shell injection, (3) Network DLP sensors detect sensitive data patterns (PII, credentials) in network traffic, (4) Behavioral anomaly detection alerts on deviations from learned application behavior profiles.

**Responsible Components:** NeuVector Runtime Security

**Evidence Artifacts:**

- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** NeuVector continuously monitors all container processes and network traffic. Security events forwarded to Loki via SYSLOG.

---

### SI-4: System Monitoring

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Comprehensive system monitoring: (1) Prometheus for infrastructure and application metrics with 15-day in-cluster retention, (2) Loki for centralized log aggregation with 30-90 day retention, (3) Tempo for distributed tracing of service calls, (4) NeuVector for runtime security events and behavioral monitoring, (5) Kyverno PolicyReports for continuous compliance assessment, (6) Grafana provides unified visualization across all monitoring sources.

**Responsible Components:** Prometheus/Grafana Monitoring Stack, Loki/Alloy Logging Stack, NeuVector Runtime Security, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/core/monitoring/helmrelease.yaml`
- `platform/core/logging/helmrelease-loki.yaml`
- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** All monitoring components have ServiceMonitors for self-monitoring. AlertManager provides multi-channel alerting.

---

### SI-5: Security Alerts, Advisories, and Directives

**Priority:** P1 | **Baseline:** Low | **Status:** Fully implemented and operational

**Implementation Description:**

Security alerting pipeline: (1) Grafana AlertManager routes alerts to Slack, email, and PagerDuty based on severity, (2) NeuVector CVE alerts notify teams of newly discovered vulnerabilities in running containers, (3) PrometheusRules define SRE-specific alerts for pod security violations, certificate expiry, Flux reconciliation failures, and NeuVector security events.

**Responsible Components:** Prometheus/Grafana Monitoring Stack, NeuVector Runtime Security

**Evidence Artifacts:**

- `platform/core/monitoring/sre-alerting-rules.yaml`
- `platform/core/runtime-security/helmrelease.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** AlertManager tracks alert history with silencing and inhibition rules. NeuVector provides CVE feed integration.

---

### SI-6: Security Function Verification

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Security function verification: (1) NeuVector CIS benchmark scanning validates runtime security configurations against published benchmarks, (2) Kyverno background policy scanning continuously reports on existing non-compliant resources via PolicyReport CRDs, (3) STIG validation scripts check OS and Kubernetes configuration compliance, (4) Flux CD drift detection verifies deployed state matches intended configuration.

**Responsible Components:** NeuVector Runtime Security, Kyverno Policy Engine

**Evidence Artifacts:**

- `platform/core/runtime-security/helmrelease.yaml`
- `policies/custom/`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** NeuVector CIS scan results available on-demand. Kyverno background scanning runs continuously.

---

### SI-7: Software, Firmware, and Information Integrity

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Software integrity assurance: (1) Cosign image signatures verified by Kyverno imageVerify ClusterPolicy on all pod admissions, (2) SBOM (Software Bill of Materials) generated at build time in SPDX + CycloneDX formats and stored in Harbor as OCI artifacts, (3) Flux CD drift detection and remediation ensures deployed state matches Git source of truth, (4) Kyverno restrict-image-registries policy limits images to the approved Harbor registry.

**Responsible Components:** Kyverno Policy Engine, Harbor Container Registry, Flux CD GitOps Engine

**Evidence Artifacts:**

- `policies/custom/verify-image-signatures.yaml`
- `policies/custom/restrict-image-registries.yaml`
- `platform/flux-system/gotk-sync.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Kyverno reports image signature verification results. Flux reports drift detection status. Harbor tracks SBOM and signature status.

---

## System and Services Acquisition

### SA-10: Developer Configuration Management

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

All platform and application configurations are managed via GitOps: (1) Git repository is the single source of truth, (2) All changes tracked with author attribution and timestamps, (3) Flux CD reconciliation provides a complete audit trail of applied configurations, (4) Branch protection and PR workflow enforce review before deployment.

**Responsible Components:** Flux CD GitOps Engine

**Evidence Artifacts:**

- `platform/flux-system/gotk-sync.yaml`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** Flux reconciliation events logged. Git history provides complete change audit trail.

---

### SA-11: Developer Testing and Evaluation

**Priority:** P1 | **Baseline:** Moderate | **Status:** Fully implemented and operational

**Implementation Description:**

Developer testing and evaluation: (1) Kyverno policy tests validate all security enforcement rules with pass/fail test cases, (2) Helm chart tests verify deployment correctness, (3) Infrastructure validation pipeline (task lint, task validate) checks compliance before merge, (4) JSON schema validation on all Helm chart values.

**Responsible Components:** Kyverno Policy Engine, Flux CD GitOps Engine

**Evidence Artifacts:**

- `policies/tests/`
- `apps/templates/`

**Automation:** This control is automatically enforced and continuously validated by the platform.

**Continuous Monitoring:** CI pipeline runs tests on every PR. Validation failures block merge.

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total controls | 49 |
| Fully implemented | 49 |
| Partially implemented | 0 |
| Planned | 0 |
| Automated enforcement | 49 |
| Manual/procedural | 0 |

**Overall Implementation Rate:** 100.0%

---

*This document was auto-generated by `scripts/generate-ssp-narrative.sh` on 2026-03-25T22:03:35Z.*
*Source data: `compliance/nist-800-53-mappings/control-mapping.json`*
