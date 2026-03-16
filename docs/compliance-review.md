# Compliance Review: Tenant App Security Posture

This document describes the security posture that tenant applications inherit when deployed on the SRE platform. It is intended for security officers, compliance auditors, and authorizing officials evaluating the platform's suitability for hosting mission-critical or classified-capable applications.

**Audience**: Security/compliance officers, ISSOs, ISSMs, authorizing officials.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Security Architecture](#2-platform-security-architecture)
3. [Inherited Security Controls](#3-inherited-security-controls)
   - [Istio mTLS: Encrypted Pod-to-Pod Communication](#31-istio-mtls-encrypted-pod-to-pod-communication)
   - [OAuth2 Proxy: Centralized Authentication](#32-oauth2-proxy-centralized-authentication)
   - [Kyverno: Admission Control and Policy Enforcement](#33-kyverno-admission-control-and-policy-enforcement)
   - [NetworkPolicies: Network Segmentation](#34-networkpolicies-network-segmentation)
   - [Harbor + Trivy: Container Image Scanning](#35-harbor--trivy-container-image-scanning)
   - [NeuVector: Runtime Security](#36-neuvector-runtime-security)
4. [NIST 800-53 Control Mapping](#4-nist-800-53-control-mapping)
5. [Developer Responsibilities](#5-developer-responsibilities)
6. [Platform-Provided Automatic Protections](#6-platform-provided-automatic-protections)
7. [Risk Assessment for Tenant Applications](#7-risk-assessment-for-tenant-applications)
8. [Vulnerability Reporting and Remediation](#8-vulnerability-reporting-and-remediation)
9. [Audit Evidence and Artifacts](#9-audit-evidence-and-artifacts)
10. [Continuous Monitoring](#10-continuous-monitoring)
11. [Security Exception Process](#11-security-exception-process)
12. [Appendix: Control Inheritance Matrix](#appendix-control-inheritance-matrix)

---

## 1. Executive Summary

The Secure Runtime Environment (SRE) is a Kubernetes-based platform built on RKE2, hardened per DISA STIGs and NIST 800-53 Rev 5 controls. Tenant applications deployed on SRE inherit a comprehensive set of security controls without any action from the application developer.

**Key facts:**
- All pod-to-pod traffic is encrypted via Istio mTLS STRICT mode (SC-8)
- All external traffic requires Keycloak OIDC authentication via OAuth2 Proxy (IA-2, AC-3)
- All containers are scanned for vulnerabilities by Harbor/Trivy before deployment (RA-5)
- All pods are subject to admission control by Kyverno (CM-7, AC-6)
- All namespaces have default-deny network policies (SC-7, AC-4)
- All runtime behavior is monitored by NeuVector (SI-3, SI-4)
- The cluster foundation (RKE2 on Rocky Linux 9) is DISA STIG-compliant (CM-6)
- FIPS 140-2 cryptographic modules are enabled at the OS and Kubernetes level (SC-13)

### Compliance Frameworks Addressed

| Framework | Coverage Level | Notes |
|-----------|---------------|-------|
| NIST 800-53 Rev 5 | 9 control families (45+ controls) | See Section 4 |
| CMMC 2.0 Level 2 | Full coverage of 110 practices | Via NIST 800-171 crosswalk |
| DISA STIGs | RKE2 + Rocky Linux 9 | Automated validation |
| CIS Benchmarks | Kubernetes + OS Level 2 | RKE2 default profile |
| FedRAMP Moderate | Partial (platform layer) | Requires app-level SSP |

---

## 2. Platform Security Architecture

### Defense-in-Depth Model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: Infrastructure Foundation                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Rocky Linux 9 (DISA STIG hardened)                           │  │
│  │  FIPS 140-2 mode enabled                                      │  │
│  │  SELinux enforcing                                            │  │
│  │  auditd configured per NIST AU-family                         │  │
│  │  RKE2 (CIS Benchmark + DISA STIG profile)                    │  │
│  │  etcd encryption at rest                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: Network Security                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Istio mTLS STRICT (zero-trust pod-to-pod)                    │  │
│  │  NetworkPolicies (default deny ingress + egress)              │  │
│  │  Istio AuthorizationPolicies (CUSTOM ext-authz)               │  │
│  │  NeuVector network segmentation + DLP/WAF                     │  │
│  │  Istio Gateway (single ingress point, TLS termination)        │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: Workload Security                                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Kyverno admission control (baseline + restricted policies)   │  │
│  │  Pod Security Contexts (non-root, read-only rootfs, drop ALL) │  │
│  │  NeuVector runtime protection (process + file monitoring)     │  │
│  │  Resource limits enforced (prevent noisy neighbor)             │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: Supply Chain Security                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Harbor registry with Trivy vulnerability scanning            │  │
│  │  Cosign image signature verification via Kyverno              │  │
│  │  Registry restriction policy (only Harbor allowed)            │  │
│  │  SBOM generation and storage                                  │  │
│  │  No :latest tags permitted (pinned versions only)             │  │
│  └───────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  Cross-Cutting: Identity, Secrets, Audit, Monitoring                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Keycloak SSO (OIDC/SAML, MFA, LDAP federation)              │  │
│  │  OpenBao secrets management (dynamic secrets, auto-rotation)  │  │
│  │  cert-manager (automated TLS certificate lifecycle)           │  │
│  │  Prometheus + Grafana (metrics, dashboards, alerting)         │  │
│  │  Loki + Alloy (centralized logging, 90-day retention)         │  │
│  │  Tempo (distributed tracing)                                  │  │
│  │  Velero (backup and disaster recovery)                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Tenant Application Boundary

A tenant application is deployed into a dedicated Kubernetes namespace. The namespace provides:
- Resource isolation (ResourceQuota + LimitRange)
- Network isolation (default-deny NetworkPolicy)
- Identity isolation (ServiceAccount per workload)
- Policy isolation (namespace-scoped Kyverno policies)

```
┌──────────────────────────────────────┐
│  Namespace: team-alpha               │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ frontend  │  │ backend  │         │
│  │ pod       │  │ pod      │         │
│  │ + sidecar │  │ + sidecar│         │
│  └─────┬────┘  └────┬─────┘         │
│        │  mTLS       │               │
│        └──────┬──────┘               │
│               │                      │
│  NetworkPolicy: default-deny-all     │
│  ResourceQuota: cpu/mem limits       │
│  LimitRange: per-pod defaults        │
│  Kyverno: baseline + restricted      │
│  Istio: sidecar injection enabled    │
└──────────────────────────────────────┘
```

---

## 3. Inherited Security Controls

### 3.1 Istio mTLS: Encrypted Pod-to-Pod Communication

**NIST Controls**: SC-8 (Transmission Confidentiality), SC-13 (Cryptographic Protection), AC-4 (Information Flow)

**What it does:**
- Enforces mutual TLS for ALL pod-to-pod communication cluster-wide
- Uses SPIFFE identities for workload authentication
- Encrypts all in-cluster traffic with TLS 1.2+ (FIPS-approved ciphers)

**Configuration:**
```yaml
# platform/core/istio-config/peer-authentication.yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT    # No plaintext traffic permitted
```

**Evidence for auditors:**
- Run `istioctl analyze` to verify no PERMISSIVE mode exceptions exist
- Check `istio_requests_total` metric for `connection_security_policy="mutual_tls"` on all traffic
- NeuVector network map shows encrypted connections between all pods

**Impact on tenant apps:**
- Zero developer effort required. The Istio sidecar (envoy proxy) is automatically injected into every pod in namespaces labeled `istio-injection: enabled`
- Applications communicate over plain HTTP internally; the sidecar handles TLS transparently
- No application code changes needed for encrypted communication

### 3.2 OAuth2 Proxy: Centralized Authentication

**NIST Controls**: IA-2 (Identification and Authentication), AC-2 (Account Management), AC-3 (Access Enforcement), IA-8 (Non-Organizational Users)

**What it does:**
- Intercepts ALL external HTTP traffic at the Istio ingress gateway
- Authenticates users via Keycloak OIDC before forwarding requests to applications
- Injects user identity headers (`x-auth-request-*`) into authenticated requests
- Maintains session state via encrypted cookies (`_sre_oauth2`)

**What this means for tenant apps:**
- No unauthenticated user can reach any application through the ingress gateway
- Applications receive pre-authenticated requests with verified user identity
- Session management, login flows, token refresh, and logout are handled by the platform
- Multi-factor authentication (MFA) can be enforced at the Keycloak level without app changes

**Authentication chain:**
```
Browser → Istio Gateway → ext-authz → OAuth2 Proxy → Keycloak OIDC
                                          │
                                    Valid session?
                                    ┌─────┴─────┐
                                   YES          NO
                                    │            │
                             Add identity    Redirect to
                             headers         Keycloak login
                                    │
                                    ▼
                             Forward to app
```

**Excluded from authentication** (by design):
- Health check paths: `/healthz`, `/health`, `/ready`
- Keycloak itself (OIDC provider cannot authenticate against itself)
- Harbor (has its own authentication)
- NeuVector (has its own OIDC integration)

### 3.3 Kyverno: Admission Control and Policy Enforcement

**NIST Controls**: CM-7 (Least Functionality), AC-6 (Least Privilege), CM-6 (Configuration Settings), SI-7 (Software Integrity)

**What it does:**
- Validates every Kubernetes resource creation and modification against security policies
- Blocks non-compliant resources before they are created
- Mutates resources to inject security defaults (labels, annotations)
- Verifies container image signatures (Cosign)

**Active policies (Enforce mode):**

| Policy | What It Enforces | NIST |
|--------|-----------------|------|
| `disallow-privileged` | No privileged containers | AC-6 |
| `disallow-host-namespaces` | No host PID/IPC/network access | AC-6, SC-3 |
| `disallow-host-ports` | No host port binding | SC-7 |
| `disallow-latest-tag` | No `:latest` image tags | CM-2 |
| `require-istio-sidecar` | Namespace must have Istio injection label | SC-8 |
| `require-labels` | Required metadata labels on all resources | CM-8 |
| `require-network-policies` | Namespace must have default-deny NetworkPolicy | SC-7 |
| `require-resource-limits` | CPU and memory limits required | SC-5 |
| `require-security-categorization` | Classification label required | AC-16 |
| `restrict-unsafe-sysctls` | Only safe sysctls permitted | CM-7 |

**Active policies (Audit mode):**

| Policy | What It Audits | NIST |
|--------|---------------|------|
| `disallow-privilege-escalation` | No `allowPrivilegeEscalation: true` | AC-6 |
| `require-drop-all-capabilities` | Must drop ALL Linux capabilities | AC-6 |
| `require-run-as-nonroot` | Must run as non-root user | AC-6 |
| `require-security-context` | Must define security context | CM-6 |
| `restrict-image-registries` | Only approved registry allowed | CM-11 |
| `restrict-volume-types` | Only safe volume types | CM-7 |
| `verify-image-signatures` | Cosign signature required | SI-7 |

Audit-mode policies are being transitioned to Enforce as applications are remediated.

**Impact on tenant apps:**
- Developers must use non-root containers with security contexts
- Only images from the Harbor registry are permitted (when `restrict-image-registries` is Enforce)
- All images must be tagged with specific versions (no `:latest`)
- Resource requests and limits must be defined

### 3.4 NetworkPolicies: Network Segmentation

**NIST Controls**: SC-7 (Boundary Protection), AC-4 (Information Flow Enforcement)

**What it does:**
- Every tenant namespace has a default-deny NetworkPolicy blocking ALL ingress and egress
- Explicit allow rules are added for required communication paths
- Prevents lateral movement between namespaces

**Default tenant NetworkPolicy:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

**Standard allow rules for tenant namespaces:**
- Ingress from `istio-system` (gateway traffic)
- Ingress from `monitoring` (Prometheus scraping)
- Egress to `kube-system` (CoreDNS, port 53)
- Egress to pods within the same namespace (inter-service communication)

**Impact on tenant apps:**
- Apps can only receive traffic from the Istio gateway and monitoring
- Apps can only communicate with other pods in their own namespace by default
- Cross-namespace communication requires explicit NetworkPolicy rules (approved by platform admin)

### 3.5 Harbor + Trivy: Container Image Scanning

**NIST Controls**: RA-5 (Vulnerability Scanning), SI-2 (Flaw Remediation), CM-11 (User-Installed Software)

**What it does:**
- All container images are pushed to Harbor before deployment
- Trivy automatically scans every image on push for known CVEs
- Scan results include severity ratings (Critical, High, Medium, Low)
- Harbor can block image pulls for images exceeding a severity threshold

**Scan pipeline:**
```
Developer pushes image → Harbor receives → Trivy scans → Results stored
                                                              │
                                                    ┌─────────┴──────────┐
                                                    │  Severity Report   │
                                                    │  Critical: 0       │
                                                    │  High:     2       │
                                                    │  Medium:   5       │
                                                    │  Low:      12      │
                                                    └────────────────────┘
```

**Scan frequency:**
- On push: every new image is scanned immediately
- Scheduled: daily re-scan of all images against updated CVE databases

**Impact on tenant apps:**
- Developers must address Critical and High vulnerabilities before production deployment
- Vulnerability reports are visible in Harbor's web UI per image tag
- Platform admins can set project-level vulnerability gates

### 3.6 NeuVector: Runtime Security

**NIST Controls**: SI-3 (Malicious Code Protection), SI-4 (System Monitoring), IR-4 (Incident Handling), SC-7 (Boundary Protection)

**What it does:**
- Monitors all running containers for anomalous behavior
- Detects unexpected processes, file modifications, and network connections
- Provides DLP (Data Loss Prevention) sensors for sensitive data detection
- Enforces behavioral baselines after learning mode
- CIS benchmark scanning for running container configurations

**Runtime protection modes:**
1. **Discover** (learning): Records normal behavior as baseline
2. **Monitor** (alerting): Alerts on deviations from baseline
3. **Protect** (enforcing): Blocks deviations from baseline

**What NeuVector monitors per container:**
- Process execution (binary path, arguments, parent process)
- File system modifications (write/delete operations)
- Network connections (source, destination, port, protocol)
- DNS queries
- Privilege escalation attempts
- Container escape techniques

**Impact on tenant apps:**
- Zero configuration required from developers
- NeuVector learns normal app behavior automatically
- Alerts are generated for abnormal activity and forwarded to Grafana/Loki
- In Protect mode, abnormal processes are blocked at runtime

---

## 4. NIST 800-53 Control Mapping

The following table maps NIST 800-53 Rev 5 controls to their SRE implementation. Controls marked with (I) are **inherited** by tenant apps automatically.

### AC -- Access Control

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| AC-2 | Account Management | Keycloak centralized identity, group-based access, deprovisioning workflows | (I) |
| AC-3 | Access Enforcement | OAuth2 Proxy ext-authz, Istio AuthorizationPolicy, Kubernetes RBAC | (I) |
| AC-4 | Information Flow Enforcement | Istio mTLS, NetworkPolicies (default deny), Kyverno egress restrictions | (I) |
| AC-6 | Least Privilege | Pod security contexts (non-root, drop ALL caps), RBAC scoped to namespace | (I) |
| AC-6(1) | Authorize Access to Security Functions | Flux RBAC (only flux-system can modify platform namespaces) | (I) |
| AC-6(9) | Audit Use of Privileged Functions | Kubernetes audit log, Istio access logs, all forwarded to Loki | (I) |
| AC-6(10) | Prohibit Non-Privileged Users from Executing Privileged Functions | Kyverno disallow-privileged, disallow-privilege-escalation | (I) |
| AC-14 | Permitted Actions Without Identification | Istio PeerAuthentication STRICT (no unauthenticated service-to-service) | (I) |
| AC-17 | Remote Access | Keycloak SSO/MFA for all management UIs, Istio TLS gateway | (I) |

### AU -- Audit and Accountability

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| AU-2 | Audit Events | Kubernetes API audit policy, Istio access logs, OAuth2 Proxy auth events | (I) |
| AU-3 | Content of Audit Records | Structured JSON: timestamp, source, user, action, resource, outcome | (I) |
| AU-4 | Audit Storage Capacity | Loki with S3-compatible backend, configurable retention (90-day minimum) | (I) |
| AU-5 | Response to Audit Failures | Prometheus alerts on Loki ingestion failures | (I) |
| AU-6 | Audit Review and Reporting | Grafana dashboards with pre-built compliance queries | (I) |
| AU-8 | Time Stamps | NTP enforced on all nodes, all logs in UTC | (I) |
| AU-9 | Protection of Audit Information | Loki storage encrypted at rest, RBAC restricts access | (I) |
| AU-12 | Audit Generation | All pods output to stdout/stderr, collected by Alloy DaemonSet | (I) |

### CM -- Configuration Management

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| CM-2 | Baseline Configuration | Git repo is the baseline; Flux reconciles cluster to match | (I) |
| CM-3 | Configuration Change Control | Git PR workflow, branch protection, Flux audit trail | (I) |
| CM-5 | Access Restrictions for Change | Branch protection, Flux RBAC, Kyverno prevents manual kubectl changes | (I) |
| CM-6 | Configuration Settings | Ansible DISA STIG roles, RKE2 CIS profile, Kyverno policies | (I) |
| CM-7 | Least Functionality | Kyverno restricts capabilities, volumes, host access; NeuVector blocks unexpected processes | (I) |
| CM-8 | Component Inventory | Flux tracks all deployments, Harbor maintains image inventory with SBOMs | (I) |
| CM-11 | User-Installed Software | Kyverno registry restriction, image signature verification | (I) |

### IA -- Identification and Authentication

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| IA-2 | Organizational User Auth | Keycloak SSO with MFA, OIDC for all platform UIs | (I) |
| IA-3 | Device Authentication | Istio mTLS with SPIFFE workload identities | (I) |
| IA-5 | Authenticator Management | Keycloak password policies, cert-manager rotation, OpenBao rotation | (I) |
| IA-8 | Non-Organizational User Auth | Istio gateway enforces authentication on all external traffic | (I) |

### SC -- System and Communications Protection

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| SC-3 | Security Function Isolation | Namespace isolation, NetworkPolicies, Istio AuthorizationPolicy | (I) |
| SC-7 | Boundary Protection | Istio gateway (single ingress), NetworkPolicies (default deny), NeuVector | (I) |
| SC-8 | Transmission Confidentiality | Istio mTLS STRICT, TLS at gateway | (I) |
| SC-12 | Cryptographic Key Management | cert-manager lifecycle, OpenBao secret management | (I) |
| SC-13 | Cryptographic Protection | RKE2 FIPS 140-2 mode, FIPS crypto policy on Rocky Linux 9 | (I) |
| SC-28 | Protection at Rest | K8s Secrets encryption (RKE2 default), OpenBao encrypted backend | (I) |

### SI -- System and Information Integrity

| Control | Title | SRE Implementation | Inherited |
|---------|-------|-------------------|-----------|
| SI-2 | Flaw Remediation | Harbor + Trivy scanning with severity alerts | (I) |
| SI-3 | Malicious Code Protection | NeuVector runtime protection | (I) |
| SI-4 | System Monitoring | Prometheus, Loki, Tempo, NeuVector, Kyverno reports | (I) |
| SI-7 | Software Integrity | Cosign image signatures verified by Kyverno | (I) |

---

## 5. Developer Responsibilities

While the platform provides extensive inherited controls, tenant application developers are responsible for:

### 5.1 Application-Level Security

| Responsibility | Description | Compliance Impact |
|----------------|-------------|-------------------|
| **Secure coding** | Input validation, output encoding, parameterized queries | Prevents XSS, SQL injection, command injection |
| **Dependency management** | Keep dependencies updated, address Trivy findings | RA-5, SI-2 |
| **Use Harbor as registry** | Push all images to `harbor.apps.sre.example.com` | CM-11 |
| **Non-root containers** | Set `runAsNonRoot: true`, `readOnlyRootFilesystem: true` | AC-6, CM-7 |
| **Resource limits** | Define CPU/memory requests and limits | SC-5 |
| **Health probes** | Implement `/healthz` and `/readyz` endpoints | CA-7 |
| **Structured logging** | Output JSON logs to stdout/stderr | AU-3, AU-12 |
| **Pin image versions** | Use explicit tags, never `:latest` | CM-2 |
| **Respond to Trivy findings** | Remediate Critical/High CVEs within SLA | RA-5, SI-2 |
| **Classification labels** | Apply `sre.io/security-categorization` label | AC-16 |

### 5.2 Remediation SLAs

| Severity | Remediation Timeline | Escalation |
|----------|---------------------|------------|
| Critical | 72 hours | Automated alert to platform admins |
| High | 7 days | Weekly vulnerability report |
| Medium | 30 days | Monthly review |
| Low | 90 days or next release | Quarterly review |

### 5.3 Security Context Requirements

Every pod must include this security context (Kyverno enforces this):

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop:
                - ALL
```

---

## 6. Platform-Provided Automatic Protections

These protections are enforced by the platform with zero developer effort:

| Protection | How It Works | What Developers See |
|-----------|-------------|-------------------|
| **mTLS encryption** | Istio sidecar auto-injected, encrypts all traffic | Nothing -- transparent to the application |
| **Authentication** | OAuth2 Proxy intercepts traffic, authenticates via Keycloak | App receives `x-auth-request-*` headers |
| **Admission control** | Kyverno validates all resource creation | Deploy rejected if non-compliant |
| **Network isolation** | Default-deny NetworkPolicy in every namespace | Cannot communicate outside namespace by default |
| **Image scanning** | Trivy scans on push to Harbor | Vulnerability report in Harbor UI |
| **Runtime monitoring** | NeuVector monitors all containers | Alerts in Grafana for anomalous behavior |
| **Log collection** | Alloy DaemonSet collects stdout/stderr from all pods | Logs searchable in Grafana/Loki |
| **Metrics collection** | Prometheus scrapes ServiceMonitors | Metrics visible in Grafana dashboards |
| **Certificate management** | cert-manager auto-rotates TLS certificates | No manual cert renewal needed |
| **Backup** | Velero scheduled backups of all namespaces | Recovery possible in disaster scenarios |
| **Audit logging** | Kubernetes API audit + Istio access logs | Full audit trail in Loki |
| **Drift detection** | Flux reconciles cluster to Git state | Manual kubectl changes are reverted |

---

## 7. Risk Assessment for Tenant Applications

### 7.1 Residual Risks (Not Covered by Platform)

Despite the platform's extensive controls, the following risks remain at the application layer:

| Risk | Description | Mitigation Recommendation |
|------|-------------|--------------------------|
| **Application-level vulnerabilities** | XSS, CSRF, SQL injection, insecure deserialization | Secure coding training, SAST/DAST in CI pipeline |
| **Business logic flaws** | Authorization bypass, IDOR, race conditions | Code review, penetration testing |
| **Dependency vulnerabilities** | CVEs in application dependencies | Automated dependency scanning, Trivy findings remediation |
| **Secrets in code** | Hardcoded credentials, API keys in source | Use OpenBao + ESO for all secrets, pre-commit hooks |
| **Insecure API design** | Overly permissive endpoints, missing rate limiting | API security review, rate limiting at Istio level |
| **Data handling** | PII exposure, inadequate data classification | DLP policies, data classification labels |
| **Insider threat** | Authorized user performing unauthorized actions | Audit logging, behavioral monitoring, least privilege |

### 7.2 Risk Matrix

```
Impact
  ▲
  │  ┌─────────────┬─────────────┬─────────────┐
  │  │             │  App-level  │  Insider     │
H │  │             │  vulns      │  threat      │
  │  ├─────────────┼─────────────┼─────────────┤
  │  │  Dependency │  Business   │             │
M │  │  CVEs       │  logic      │             │
  │  ├─────────────┼─────────────┼─────────────┤
  │  │  Secrets    │             │             │
L │  │  in code    │             │             │
  │  └─────────────┴─────────────┴─────────────┘
  └──────────────────────────────────────────────►
           L              M              H
                    Likelihood

Platform mitigates:
  - Network-level attacks (mTLS, NetworkPolicy)
  - Unauthenticated access (OAuth2 Proxy)
  - Container escape (Kyverno, NeuVector)
  - Known CVEs in images (Harbor/Trivy)
  - Configuration drift (Flux GitOps)
```

### 7.3 Shared Responsibility Model

```
┌──────────────────────────────────────────────────────┐
│                    Shared Responsibility              │
├──────────────────────┬───────────────────────────────┤
│  Platform Provides   │  Developer Provides            │
├──────────────────────┼───────────────────────────────┤
│  mTLS encryption     │  Secure application code       │
│  Authentication      │  Input validation              │
│  Network isolation   │  Authorization logic           │
│  Image scanning      │  Dependency updates            │
│  Runtime monitoring  │  Structured logging            │
│  Audit logging       │  Health endpoints              │
│  Secrets management  │  Use secrets properly          │
│  Backup/recovery     │  Data classification           │
│  FIPS crypto         │  Respond to vuln findings      │
│  Admission control   │  Follow security contexts      │
└──────────────────────┴───────────────────────────────┘
```

---

## 8. Vulnerability Reporting and Remediation

### Where to Find Vulnerability Reports

#### Harbor: Image Vulnerability Scans

1. Navigate to `https://harbor.apps.sre.example.com`
2. Log in with admin credentials
3. Select the project (e.g., `team-alpha`)
4. Click on the repository (e.g., `team-alpha/my-app`)
5. Click on the image tag (e.g., `v1.2.3`)
6. The **Vulnerabilities** tab shows the Trivy scan results:
   - CVE ID, severity, package, installed version, fixed version
   - Filterable by severity level

#### NeuVector: Runtime Vulnerability Assessment

1. Navigate to `https://neuvector.apps.sre.example.com`
2. Log in via Keycloak SSO or local admin
3. Go to **Assets** > **Registries** for registry-level scans
4. Go to **Assets** > **Containers** for running container scans
5. The **Compliance** tab shows CIS benchmark results per container

#### Grafana: Security Dashboards

1. Navigate to `https://grafana.apps.sre.example.com`
2. Log in via Keycloak SSO
3. Navigate to **Dashboards** > **Security**:
   - **Kyverno Policy Violations**: Shows policy violations by namespace, policy, severity
   - **NeuVector Alerts**: Runtime security events
   - **Harbor Vulnerabilities**: Image scan summary across all projects

#### Kyverno Policy Reports

```bash
# View all policy violations cluster-wide
kubectl get clusterpolicyreport -o yaml

# View policy violations in a specific namespace
kubectl get policyreport -n team-alpha -o yaml

# Count violations by policy
kubectl get policyreport -A -o json | \
  jq '[.items[].results[] | select(.result=="fail")] | group_by(.policy) | map({policy: .[0].policy, count: length})'
```

---

## 9. Audit Evidence and Artifacts

### For ATO/cATO Packages

The platform generates the following evidence artifacts:

| Artifact | Location | Format | Frequency |
|----------|----------|--------|-----------|
| Kubernetes audit logs | Grafana/Loki | JSON | Continuous |
| Istio access logs | Grafana/Loki | JSON | Continuous |
| Kyverno policy reports | `kubectl get policyreport` | Kubernetes CRD | Real-time |
| Trivy scan results | Harbor UI per image | JSON/HTML | On push + daily |
| NeuVector security events | NeuVector UI | JSON | Continuous |
| OSCAL SSP | `compliance/oscal/` | JSON | Per release |
| DISA STIG checklists | `compliance/stig-checklists/` | XCCDF | Per assessment |
| CIS benchmark results | NeuVector | HTML/JSON | On demand |
| Flux reconciliation log | `flux logs` | Text | Continuous |
| Certificate inventory | cert-manager | Kubernetes CRD | Real-time |

### Collecting Evidence for an Assessment

```bash
# Export Kyverno policy reports
kubectl get policyreport -A -o json > evidence/kyverno-policy-reports.json
kubectl get clusterpolicyreport -o json > evidence/kyverno-cluster-reports.json

# Export Flux reconciliation state
flux get all -A > evidence/flux-state.txt

# Export running container security contexts
kubectl get pods -A -o json | jq '.items[] | {
  namespace: .metadata.namespace,
  name: .metadata.name,
  securityContext: .spec.securityContext,
  containerSecurityContexts: [.spec.containers[].securityContext]
}' > evidence/pod-security-contexts.json

# Export NetworkPolicies
kubectl get networkpolicies -A -o yaml > evidence/network-policies.yaml

# Export certificate inventory
kubectl get certificates -A -o yaml > evidence/certificates.yaml
```

---

## 10. Continuous Monitoring

The platform implements Continuous Monitoring per NIST SP 800-137:

### Real-Time Monitoring

| Monitor | Tool | Alert Threshold |
|---------|------|----------------|
| Pod security violations | Kyverno + Prometheus | Immediate on Enforce block |
| Runtime anomalies | NeuVector | Immediate on process/network anomaly |
| Certificate expiry | cert-manager + Prometheus | 30 days before expiry |
| Image vulnerability | Harbor + Trivy | Critical: immediate, High: daily digest |
| Configuration drift | Flux | Immediate on reconciliation failure |
| Authentication failures | OAuth2 Proxy + Loki | 10+ failures in 5 minutes |
| Resource exhaustion | Prometheus | 80% CPU/memory utilization |

### Compliance Dashboard

The Grafana **SRE Compliance** dashboard provides a single-pane view of:
- Kyverno policy compliance percentage by namespace
- Open vulnerability count by severity across all images
- NeuVector runtime protection status (Discover/Monitor/Protect)
- Certificate health and expiry timeline
- Flux reconciliation status for all components

---

## 11. Security Exception Process

Some platform components require security exceptions from standard policies:

### Documented Exceptions

| Component | Exception | Justification | Compensating Control |
|-----------|-----------|---------------|---------------------|
| NeuVector | Privileged DaemonSet | Requires host access for runtime monitoring | Kyverno policy exempts `neuvector` namespace; NeuVector monitors itself |
| Velero | Privileged for volume snapshots | Requires host PV access for backup | Kyverno exempts `velero` namespace; limited to backup operations |
| Istio init container | NET_ADMIN capability | Required for iptables rules (traffic redirect) | Istio CNI plugin eliminates this requirement in hardened deployments |

### Requesting an Exception

1. Document the requirement in the `compliance/exceptions/` directory
2. Include: what control is affected, why the exception is needed, compensating controls
3. Get approval from the ISSO
4. Add a Kyverno exception rule scoped to the specific namespace/workload
5. Log the exception in the risk register

---

## Appendix: Control Inheritance Matrix

Summary of which NIST 800-53 controls are fully inherited (I), partially inherited (P), or the responsibility of the application developer (D):

```
Control  Status  Notes
───────  ──────  ─────
AC-2     (I)     Keycloak manages all accounts
AC-3     (I)     OAuth2 Proxy + Istio enforce access
AC-4     (I)     mTLS + NetworkPolicies enforce flow
AC-6     (I/P)   Platform enforces pod-level; app handles business logic
AU-2     (I)     All events captured by platform logging
AU-3     (I)     Structured JSON logs collected automatically
AU-12    (I)     Alloy DaemonSet collects all pod output
CM-2     (I)     GitOps baseline
CM-3     (I)     Git PR workflow
CM-6     (I)     STIG + Kyverno enforcement
CM-7     (I)     Kyverno + NeuVector least functionality
IA-2     (I)     Keycloak SSO/MFA
IA-3     (I)     Istio SPIFFE identities
RA-5     (I/P)   Platform scans images; app must remediate findings (D)
SC-7     (I)     Default-deny NetworkPolicies + Istio gateway
SC-8     (I)     Istio mTLS STRICT
SC-13    (I)     FIPS 140-2 at OS and K8s level
SI-2     (P)     Platform scans; developer remediates (D)
SI-3     (I)     NeuVector runtime protection
SI-4     (I)     Full observability stack
SI-7     (I)     Cosign + Kyverno image verification
```

**(I)** = Fully inherited. No developer action required.
**(P)** = Partially inherited. Developer has residual responsibilities.
**(D)** = Developer responsibility. Platform provides tooling but developer must act.
