# NIST 800-53 Control Inheritance Matrix

This document categorizes each NIST 800-53 control implemented by the SRE platform into one of three responsibility categories. This is critical for ATO documentation and assessor review.

## Responsibility Categories

| Category | Definition | Example |
|----------|-----------|---------|
| **Platform-Inherited** | Fully provided by the SRE platform. Tenant teams get this for free. | Istio mTLS encryption (SC-8) |
| **Shared** | Platform provides the mechanism, but tenant teams must configure or use it. | Resource limits -- platform enforces the policy, tenant sets the values (CM-6) |
| **Tenant-Owned** | Tenant team is fully responsible. Platform does not implement this. | Application-level input validation (SI-10) |

## Control Matrix

### AC -- Access Control

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| AC-2 | Account Management | **Shared** | Keycloak provides centralized identity management with group-based RBAC | Tenant manages their team members in Keycloak groups |
| AC-3 | Access Enforcement | **Shared** | Kubernetes RBAC + Istio AuthorizationPolicy + Kyverno namespace isolation | Tenant defines fine-grained AuthorizationPolicies for their services |
| AC-4 | Information Flow Enforcement | **Platform-Inherited** | Istio mTLS STRICT + NetworkPolicies (default deny) applied automatically | None -- all traffic is encrypted and restricted by default |
| AC-6 | Least Privilege | **Shared** | Kyverno enforces non-root, drop ALL caps, read-only rootfs | Tenant must set appropriate runAsUser and not request unnecessary capabilities |
| AC-6(1) | Authorize Access to Security Functions | **Platform-Inherited** | Flux RBAC restricts platform namespace modifications | None |
| AC-6(9) | Auditing Use of Privileged Functions | **Platform-Inherited** | Kubernetes audit logging captures all privileged operations to Loki | None |
| AC-6(10) | Prohibit Non-Privileged Users from Executing Privileged Functions | **Platform-Inherited** | Kyverno policies (disallow-privileged, disallow-privilege-escalation) | None |
| AC-14 | Permitted Actions Without Identification | **Platform-Inherited** | Istio PeerAuthentication STRICT prevents unauthenticated service communication | None |
| AC-17 | Remote Access | **Platform-Inherited** | Keycloak SSO/MFA for all management interfaces, Istio gateway TLS | None |

### AU -- Audit and Accountability

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| AU-2 | Audit Events | **Shared** | Kubernetes API audit policy + Istio access logs + Alloy collection | Tenant applications must log to stdout/stderr in structured JSON |
| AU-3 | Content of Audit Records | **Shared** | Platform components output structured JSON with timestamp, source, action | Tenant applications must include user, action, and outcome in their logs |
| AU-4 | Audit Storage Capacity | **Platform-Inherited** | Loki with configurable retention (30d default, 90d for audit) | None |
| AU-5 | Response to Audit Processing Failures | **Platform-Inherited** | Prometheus alerts on Loki ingestion failures | None |
| AU-6 | Audit Review, Analysis, Reporting | **Shared** | Grafana dashboards for log analysis | Tenant may create custom dashboards for their application logs |
| AU-8 | Time Stamps | **Platform-Inherited** | NTP enforced on all nodes via Ansible, UTC timestamps | None |
| AU-9 | Protection of Audit Information | **Platform-Inherited** | Loki storage encrypted at rest, RBAC restricts log access | None |
| AU-12 | Audit Generation | **Shared** | Alloy collects all stdout/stderr from pods | Tenant applications must output meaningful log events |

### CA -- Assessment, Authorization, and Monitoring

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| CA-7 | Continuous Monitoring | **Platform-Inherited** | Prometheus + Grafana + NeuVector + Kyverno policy reports | None |
| CA-8 | Penetration Testing | **Shared** | NeuVector runtime scanning + Harbor/Trivy image scanning | Tenant responsible for application-level security testing |

### CM -- Configuration Management

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| CM-2 | Baseline Configuration | **Platform-Inherited** | Git repo is the baseline, Flux reconciles cluster to match | None |
| CM-3 | Configuration Change Control | **Platform-Inherited** | Git PR workflow, Flux audit trail | None |
| CM-5 | Access Restrictions for Change | **Platform-Inherited** | Branch protection rules, Flux RBAC | None |
| CM-6 | Configuration Settings | **Shared** | Kyverno policies enforce standards | Tenant must configure their Helm values to comply |
| CM-7 | Least Functionality | **Platform-Inherited** | Kyverno restricts capabilities, volumes, host access | None |
| CM-8 | System Component Inventory | **Shared** | Flux tracks platform components, Harbor maintains image inventory | Tenant must register their components in the Git repo |
| CM-11 | User-Installed Software | **Platform-Inherited** | Kyverno restricts image registries to Harbor only, signature verification | None |

### IA -- Identification and Authentication

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| IA-2 | Identification and Authentication (Users) | **Platform-Inherited** | Keycloak SSO with MFA | None |
| IA-3 | Device Identification and Authentication | **Platform-Inherited** | Istio mTLS with SPIFFE identities | None |
| IA-5 | Authenticator Management | **Shared** | cert-manager + OpenBao for certificate and secret rotation | Tenant must use ExternalSecrets for their application secrets |
| IA-8 | Non-Organizational User Auth | **Platform-Inherited** | Istio gateway enforces authentication for all external traffic | None |

### IR -- Incident Response

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| IR-4 | Incident Handling | **Shared** | AlertManager + NeuVector alerting pipeline, runbooks | Tenant must respond to application-specific alerts |
| IR-5 | Incident Monitoring | **Platform-Inherited** | NeuVector runtime events + Kyverno violations + Prometheus history | None |
| IR-6 | Incident Reporting | **Shared** | Grafana dashboards with exportable reports | Tenant must document application-specific incidents |

### RA -- Risk Assessment

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| RA-5 | Vulnerability Scanning | **Shared** | Harbor/Trivy scans images on push, NeuVector runtime scanning | Tenant must remediate vulnerabilities in their application images |

### SA -- System and Services Acquisition

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| SA-10 | Developer Configuration Management | **Platform-Inherited** | GitOps workflow via Flux CD | None |
| SA-11 | Developer Testing and Evaluation | **Shared** | Kyverno policy tests, Helm chart tests | Tenant must write tests for their application |

### SC -- System and Communications Protection

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| SC-3 | Security Function Isolation | **Platform-Inherited** | Namespace isolation + NetworkPolicies + Istio AuthorizationPolicy | None |
| SC-7 | Boundary Protection | **Platform-Inherited** | Istio gateway (single ingress) + NetworkPolicies (default deny egress) | None |
| SC-8 | Transmission Confidentiality/Integrity | **Platform-Inherited** | Istio mTLS STRICT for all in-cluster traffic | None |
| SC-12 | Cryptographic Key Management | **Platform-Inherited** | cert-manager + OpenBao | None |
| SC-13 | Cryptographic Protection | **Platform-Inherited** | RKE2 FIPS 140-2 BoringCrypto + Rocky Linux FIPS policy | None |
| SC-28 | Protection of Information at Rest | **Shared** | Kubernetes Secrets encrypted at rest, OpenBao encrypted storage | Tenant must use ExternalSecrets (not plaintext ConfigMaps) for sensitive data |

### SI -- System and Information Integrity

| Control | Title | Responsibility | Platform Implementation | Tenant Responsibility |
|---------|-------|---------------|------------------------|----------------------|
| SI-2 | Flaw Remediation | **Shared** | Harbor/Trivy scanning with severity alerts | Tenant must update their images when vulnerabilities are found |
| SI-3 | Malicious Code Protection | **Platform-Inherited** | NeuVector runtime protection | None |
| SI-4 | System Monitoring | **Platform-Inherited** | Prometheus + Loki + Tempo + NeuVector + Kyverno reports | None |
| SI-5 | Security Alerts and Advisories | **Platform-Inherited** | Grafana alerting to Slack/email | None |
| SI-6 | Security Function Verification | **Platform-Inherited** | NeuVector CIS benchmarks + Kyverno background scanning | None |
| SI-7 | Software/Information Integrity | **Platform-Inherited** | Cosign image signatures verified by Kyverno | None |
| SI-10 | Information Input Validation | **Tenant-Owned** | Not implemented at platform level | Tenant must validate all input in their application code |

## Summary

| Category | Count | Percentage |
|----------|-------|-----------|
| Platform-Inherited | 30 | 65% |
| Shared | 14 | 30% |
| Tenant-Owned | 1 | 2% |
| Not Applicable | 1 | 2% |

The SRE platform inherits approximately 65% of NIST 800-53 controls automatically. Tenant teams are responsible for configuring their applications to comply with the remaining shared controls, primarily around logging, resource limits, secret management, and vulnerability remediation.

## For ATO Assessors

When reviewing a tenant application for ATO:

1. **Platform-Inherited controls** require no additional evidence from the tenant -- the platform SSP covers them
2. **Shared controls** require the tenant to demonstrate their side of the responsibility (e.g., structured logging, resource limits in their Helm values, ExternalSecret usage)
3. **Tenant-Owned controls** require full evidence from the tenant (e.g., input validation test results)

Use `scripts/compliance-report.sh` to generate live evidence for all platform-inherited controls. Use `scripts/generate-ssp.sh` for the full OSCAL SSP.
