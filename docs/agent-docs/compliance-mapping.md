# Compliance Mapping for SRE

This document maps NIST 800-53 Rev 5 control families to SRE platform components. Use this when building or auditing any component to ensure compliance coverage.

## How to Use This Document

When building a component, check which NIST controls it satisfies and add the `sre.io/nist-controls` annotation to its Kyverno policies, Helm charts, and Flux manifests. When auditing, use this as a crosswalk to verify every control has at least one implementing component.

## Control Family → Component Matrix

### AC — Access Control

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| AC-2 | Account Management | Keycloak (centralized identity, group-based access, automated deprovisioning) |
| AC-3 | Access Enforcement | Kubernetes RBAC, Istio AuthorizationPolicy, Kyverno namespace isolation |
| AC-4 | Information Flow Enforcement | Istio mTLS STRICT, NetworkPolicies (default deny), Kyverno egress restrictions |
| AC-6 | Least Privilege | RBAC roles scoped to namespace, pod security contexts (non-root, drop ALL caps), ServiceAccount per workload |
| AC-6(1) | Authorize Access to Security Functions | Flux RBAC (only flux-system SA can modify platform namespaces), Kyverno policy protecting platform resources |
| AC-6(9) | Auditing Use of Privileged Functions | Kubernetes audit logging → Loki, Istio access logs |
| AC-6(10) | Prohibit Non-Privileged Users from Executing Privileged Functions | Kyverno (disallow-privileged, disallow-privilege-escalation), Pod Security Standards restricted |
| AC-14 | Permitted Actions Without Identification | Istio PeerAuthentication STRICT (no unauthenticated service-to-service communication) |
| AC-17 | Remote Access | Keycloak SSO/MFA for all management interfaces, Istio gateway TLS termination |

### AU — Audit and Accountability

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| AU-2 | Audit Events | Kubernetes API audit policy (captures auth, CRUD on all resources), Istio access logs |
| AU-3 | Content of Audit Records | Structured JSON logs with timestamp, source, user, action, resource, outcome |
| AU-4 | Audit Storage Capacity | Loki with object storage backend (S3/MinIO), configurable retention |
| AU-5 | Response to Audit Processing Failures | Prometheus alerts on Loki ingestion failures, Loki disk pressure alerts |
| AU-6 | Audit Review, Analysis, and Reporting | Grafana dashboards for audit log analysis, pre-built compliance report queries |
| AU-8 | Time Stamps | NTP enforced on all nodes via Ansible, all logs in UTC |
| AU-9 | Protection of Audit Information | Loki log storage encrypted at rest, RBAC restricts log access to audit team |
| AU-12 | Audit Generation | All platform components output structured JSON to stdout, collected by Alloy |

### CA — Assessment, Authorization, and Monitoring

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| CA-7 | Continuous Monitoring | Prometheus + Grafana (real-time metrics), NeuVector (runtime anomaly detection), Kyverno policy reports (continuous compliance) |
| CA-8 | Penetration Testing | NeuVector vulnerability scanning, Trivy image scanning in Harbor |

### CM — Configuration Management

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| CM-2 | Baseline Configuration | Git repo IS the baseline — Flux reconciles cluster to match Git state |
| CM-3 | Configuration Change Control | Git PR workflow, branch protection, conventional commits, Flux audit trail |
| CM-5 | Access Restrictions for Change | Branch protection rules, Flux RBAC, Kyverno prevents manual kubectl changes to platform resources |
| CM-6 | Configuration Settings | Ansible STIG roles (OS), RKE2 CIS benchmark profile, Kyverno policies (K8s) |
| CM-7 | Least Functionality | Kyverno restricts capabilities, volumes, host access; NeuVector blocks unexpected processes |
| CM-8 | Information System Component Inventory | Flux tracks all deployed components, Harbor maintains image inventory with SBOMs |
| CM-11 | User-Installed Software | Kyverno image registry restriction (only harbor.sre.internal allowed), image signature verification |

### IA — Identification and Authentication

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| IA-2 | Identification and Authentication (Organizational Users) | Keycloak SSO with MFA, OIDC integration with Kubernetes API |
| IA-3 | Device Identification and Authentication | Istio mTLS with SPIFFE identities for all workloads |
| IA-5 | Authenticator Management | Keycloak password policies, cert-manager certificate rotation, OpenBao secret rotation |
| IA-8 | Identification and Authentication (Non-Organizational Users) | Istio gateway enforces authentication for all external traffic |

### IR — Incident Response

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| IR-4 | Incident Handling | NeuVector alerts → Prometheus → Grafana alerting pipeline, runbooks linked from alerts |
| IR-5 | Incident Monitoring | NeuVector runtime security events, Kyverno policy violations, Prometheus alert history |
| IR-6 | Incident Reporting | Grafana dashboards with exportable incident reports |

### MP — Media Protection

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| MP-2 | Media Access | OpenBao access policies, Kubernetes Secrets encrypted at rest (RKE2 default) |

### RA — Risk Assessment

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| RA-5 | Vulnerability Scanning | Harbor + Trivy (image scanning), NeuVector (runtime scanning), CIS benchmark scanning |

### SA — System and Services Acquisition

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| SA-10 | Developer Configuration Management | GitOps workflow (all changes via Git), Flux reconciliation audit trail |
| SA-11 | Developer Testing and Evaluation | Kyverno policy tests, Helm chart tests, infrastructure validation pipeline |

### SC — System and Communications Protection

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| SC-3 | Security Function Isolation | Namespace isolation, NetworkPolicies, Istio AuthorizationPolicy |
| SC-7 | Boundary Protection | Istio gateway (single ingress point), NetworkPolicies (default deny egress), NeuVector network segmentation |
| SC-8 | Transmission Confidentiality and Integrity | Istio mTLS STRICT (all in-cluster traffic encrypted), TLS termination at gateway |
| SC-12 | Cryptographic Key Establishment and Management | cert-manager (automated certificate lifecycle), OpenBao (secret management and rotation) |
| SC-13 | Cryptographic Protection | RKE2 FIPS 140-2 mode, FIPS crypto policy on Rocky Linux 9 |
| SC-28 | Protection of Information at Rest | Kubernetes Secrets encryption (RKE2), OpenBao encrypted storage backend, Loki encrypted object storage |

### SI — System and Information Integrity

| Control | Description | SRE Implementation |
|---------|-------------|-------------------|
| SI-2 | Flaw Remediation | Harbor + Trivy scanning with severity-based alerts, image update automation via Flux |
| SI-3 | Malicious Code Protection | NeuVector runtime protection (process blocking, file system monitoring) |
| SI-4 | System Monitoring | Prometheus metrics, Loki logs, Tempo traces, NeuVector runtime events, Kyverno policy reports |
| SI-5 | Security Alerts, Advisories, and Directives | Grafana alerting to Slack/email, NeuVector CVE alerts |
| SI-6 | Security Function Verification | NeuVector CIS benchmark scanning, Kyverno background policy scanning |
| SI-7 | Software, Firmware, and Information Integrity | Cosign image signatures verified by Kyverno, SBOM generation in Harbor |

## CMMC 2.0 Level 2 Coverage

CMMC 2.0 Level 2 maps directly to a subset of NIST 800-53 controls. The SRE platform covers:

- **Access Control (AC)**: Full coverage via Keycloak + RBAC + Istio + Kyverno
- **Audit & Accountability (AU)**: Full coverage via Loki + Prometheus + Grafana
- **Configuration Management (CM)**: Full coverage via GitOps + Ansible STIGs + Kyverno
- **Identification & Authentication (IA)**: Full coverage via Keycloak + Istio mTLS + cert-manager
- **System & Communications Protection (SC)**: Full coverage via Istio + NetworkPolicies + FIPS

## How to Add Compliance Annotations

### Kyverno policies

```yaml
metadata:
  annotations:
    sre.io/nist-controls: "CM-7, AC-6(10)"
```

### Helm charts

```yaml
metadata:
  labels:
    sre.io/compliance: "nist-800-53"
  annotations:
    sre.io/nist-controls: "SC-8, IA-3"
```

### Flux Kustomizations

```yaml
metadata:
  annotations:
    sre.io/nist-controls: "CM-2, CM-3, SA-10"
```

## Generating Compliance Artifacts

The platform generates machine-readable compliance artifacts in OSCAL (Open Security Controls Assessment Language) format:

```bash
task compliance-report        # Generates OSCAL SSP from live cluster state
task compliance-gaps          # Shows controls without implementing components
```

These artifacts feed directly into the ATO package for assessors.
