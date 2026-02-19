# Architecture Decision Records

This document captures key architectural decisions for the Secure Runtime Environment (SRE) platform. Each decision follows the ADR format: context, options considered, decision, and consequences.

---

## ADR-001: Kubernetes Distribution — RKE2

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** CM-2, CM-6, SC-3, SI-7

### Context

The platform requires a Kubernetes distribution that meets DISA STIG requirements, supports FIPS 140-2 cryptographic modules, runs on air-gapped networks, and has a clear path to government accreditation.

### Options Considered

1. **RKE2** — Rancher's government-focused distribution with built-in FIPS support, CIS hardening profile, and DISA STIG compliance out of the box.
2. **Kubeadm + manual hardening** — Upstream Kubernetes with custom STIG application. Maximum flexibility but significant operational overhead.
3. **OpenShift** — Red Hat's enterprise distribution. Strong government presence but requires RHEL subscription, is opinionated about tooling, and has a much larger footprint.
4. **K3s** — Lightweight Rancher distribution. Excellent for edge but lacks FIPS mode and STIG compliance focus.

### Decision

RKE2. It provides FIPS 140-2 compliance via GoBoring Go compiler, ships with a CIS 1.23 hardening profile enabled by default, has published DISA STIG benchmarks, includes an embedded etcd (no external dependency), and runs on Rocky Linux 9 which itself has a published STIG.

### Consequences

- **Positive:** FIPS and CIS compliance out of the box. Air-gap installation supported natively. Strong alignment with DoD Platform One patterns. Active DISA STIG maintained by Rancher Government.
- **Negative:** Smaller community than upstream kubeadm. Some CNI choices limited (Canal default for FIPS). Upgrade cadence tied to Rancher release cycle.

---

## ADR-002: GitOps Engine — Flux CD

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** CM-2, CM-3, CM-5, SA-10, SI-7

### Context

The platform needs a GitOps engine to continuously reconcile cluster state against a Git repository, providing auditability, drift detection, and declarative infrastructure management.

### Options Considered

1. **Flux CD** — CNCF graduated. Pull-based reconciliation, native Kubernetes CRDs (HelmRelease, Kustomization), multi-tenancy support.
2. **Argo CD** — CNCF graduated. Web UI, application-centric model, SSO integration, RBAC on applications.
3. **Fleet (Rancher)** — Bundled with Rancher. Simplifies multi-cluster but tightly coupled to Rancher ecosystem.

### Decision

Flux CD. Its CRD-native approach aligns with our "everything is a Kubernetes resource" philosophy. HelmRelease CRDs provide declarative Helm management with built-in health checks and remediation. Flux's lighter footprint and lack of a stateful UI component reduces the attack surface. Multi-tenancy is handled at the Kustomization level with service account impersonation.

### Consequences

- **Positive:** No UI to secure. CRDs are auditable via standard Kubernetes audit logging. HelmRelease provides exact version pinning and automated rollback. Native support for SOPS/Age encryption for secrets in Git.
- **Negative:** No built-in UI (operators use CLI or Grafana dashboards). Steeper learning curve for teams coming from Argo CD. Application-level visibility requires additional tooling.

---

## ADR-003: Policy Engine — Kyverno

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** AC-3, AC-6, CM-6, CM-7, SI-7

### Context

The platform needs admission control to enforce security policies, validate resource configurations, mutate resources for compliance, and verify container image signatures.

### Options Considered

1. **Kyverno** — Kubernetes-native, YAML-based policies, built-in image verification, mutation support, policy reporting CRDs.
2. **OPA Gatekeeper** — Rego language for policies, ConstraintTemplate CRDs, mature ecosystem.
3. **Kubewarden** — Wasm-based policies, language-agnostic, newer project.

### Decision

Kyverno. YAML-based policies are more accessible to the platform team than Rego (OPA) and align with our GitOps approach. Built-in Cosign image verification eliminates the need for a separate admission webhook. ClusterPolicy and Policy CRDs provide flexible scoping. PolicyReport CRDs integrate directly with monitoring for compliance dashboards.

### Consequences

- **Positive:** Policies written in YAML (same as everything else). Built-in image signature verification. PolicyReport CRDs feed compliance dashboards. Mutation policies can auto-inject security contexts and labels.
- **Negative:** Kyverno is newer than OPA/Gatekeeper with a smaller policy library. Complex logic is harder in YAML than Rego. Performance at very high admission request rates needs testing.

---

## ADR-004: Secrets Management — OpenBao + External Secrets Operator

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** IA-5, SC-12, SC-13, SC-28

### Context

The platform needs centralized secrets management with dynamic secret generation, automatic rotation, encryption at rest, and Kubernetes-native secret delivery.

### Options Considered

1. **OpenBao + ESO** — OpenBao (open-source Vault fork) for secrets storage + External Secrets Operator for Kubernetes delivery.
2. **HashiCorp Vault + VSO** — HashiCorp Vault with Vault Secrets Operator. Industry standard but BSL-licensed since 2023.
3. **Sealed Secrets** — Bitnami's encryption-based approach. Simple but no dynamic secrets, no rotation.
4. **AWS Secrets Manager + ESO** — Cloud-native but creates cloud provider lock-in.

### Decision

OpenBao + ESO. OpenBao is the community fork of HashiCorp Vault created after the BSL license change, maintaining API compatibility while being truly open-source (MPL-2.0). ESO syncs secrets from OpenBao into native Kubernetes Secrets, which applications consume without code changes. This avoids both vendor lock-in (HashiCorp BSL) and cloud lock-in (AWS-only).

### Consequences

- **Positive:** Fully open-source. API-compatible with existing Vault tooling and documentation. Dynamic secrets (database credentials, PKI certificates) with automatic rotation. ESO is cloud-agnostic. Strong encryption at rest with auto-unseal via KMS.
- **Negative:** OpenBao is newer than Vault with a smaller community. Operational overhead of running a stateful HA service. ESO adds a sync delay between secret update and pod availability.

---

## ADR-005: Service Mesh — Istio

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** AC-4, SC-7, SC-8, SC-13, AU-2

### Context

The platform needs encrypted service-to-service communication (mTLS), traffic management, observability (distributed tracing), and fine-grained authorization policies.

### Options Considered

1. **Istio** — CNCF graduated. Full-featured mesh with mTLS, traffic management, observability, authorization. Largest community and ecosystem.
2. **Linkerd** — CNCF graduated. Lighter weight, Rust data plane, simpler operational model. No built-in authorization policies.
3. **Cilium Service Mesh** — eBPF-based, no sidecar, integrated with Cilium CNI. Newer mesh implementation.

### Decision

Istio. It provides STRICT mTLS enforcement (satisfying SC-8 encryption in transit), AuthorizationPolicy CRDs for fine-grained access control (AC-4), and RequestAuthentication for JWT validation. Istio's telemetry integration provides automatic metrics, traces, and access logs for all mesh traffic (AU-2). The large ecosystem means better government adoption references and more available expertise.

### Consequences

- **Positive:** STRICT mTLS encrypts all in-cluster traffic without application changes. AuthorizationPolicy provides zero-trust network segmentation. Built-in telemetry feeds Prometheus, Grafana, and Tempo. Wide government adoption (DoD Platform One uses Istio).
- **Negative:** Significant resource overhead (sidecar per pod + istiod control plane). Complexity in debugging mesh networking issues. Sidecar injection requires namespace labels and creates init container dependencies.

---

## ADR-006: Container Registry — Harbor

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** CM-2, SI-3, SI-7, SA-11, RA-5

### Context

The platform needs a container registry that provides image storage, vulnerability scanning, image signing/verification, replication from upstream registries, and RBAC for multi-tenant access.

### Options Considered

1. **Harbor** — CNCF graduated. Full-featured registry with built-in Trivy scanning, Cosign/Notation signing, replication, RBAC, robot accounts.
2. **Distribution (Docker Registry)** — Minimal, open-source. No scanning, no signing, no RBAC beyond basic auth.
3. **Quay** — Red Hat's registry. Feature-rich but smaller community outside Red Hat ecosystem.

### Decision

Harbor. It provides integrated Trivy vulnerability scanning (RA-5), Cosign signature verification (SI-7), replication policies for pulling from upstream registries into the air-gapped environment, project-based RBAC for multi-tenant isolation, and robot accounts for CI/CD automation.

### Consequences

- **Positive:** All-in-one registry solution. Trivy scanning runs automatically on push. Cosign integration enables the full supply chain security story with Kyverno verification. Replication simplifies air-gap image management.
- **Negative:** Harbor is a stateful application (PostgreSQL + Redis + storage backend) requiring operational care. Storage costs grow with image retention. HA deployment requires shared storage.

---

## ADR-007: Runtime Security — NeuVector

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** SI-3, SI-4, IR-4, IR-5, SC-7

### Context

The platform needs runtime security monitoring that detects anomalous container behavior, enforces network microsegmentation at Layer 7, provides DLP/WAF capabilities, and integrates with the incident response workflow.

### Options Considered

1. **NeuVector** — SUSE open-source. Full lifecycle container security: vulnerability scanning, runtime protection, network DLP/WAF, behavioral learning.
2. **Falco** — CNCF graduated. Runtime threat detection via system call monitoring. Alert-only (no enforcement).
3. **KubeArmor** — CNCF sandbox. eBPF/LSM-based enforcement. Newer with smaller community.

### Decision

NeuVector. It provides both detection AND enforcement (Falco is detect-only). Network microsegmentation with DLP/WAF satisfies SI-4 and SC-7. Behavioral learning mode creates baselines that automatically become enforcement rules. Integration with SYSLOG feeds alerts to Alloy/Loki for centralized incident response.

### Consequences

- **Positive:** Detect + enforce in one tool. Network DLP catches sensitive data exfiltration. Behavioral learning reduces manual policy creation. Open-source since SUSE acquisition.
- **Negative:** Requires privileged DaemonSet (documented security exception). Resource overhead on every node. Learning mode requires careful promotion to enforcement to avoid blocking legitimate traffic.

---

## ADR-008: Infrastructure as Code — OpenTofu

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** CM-2, CM-3, SA-10

### Context

The platform infrastructure (VPCs, compute, load balancers, DNS, storage) needs to be managed declaratively with state tracking, planning, and drift detection.

### Options Considered

1. **OpenTofu** — Open-source fork of Terraform (MPL-2.0), maintaining full HCL compatibility and provider ecosystem.
2. **Terraform** — HashiCorp's original IaC tool. BSL-licensed since 2023.
3. **Pulumi** — Multi-language IaC. TypeScript/Python/Go support. Smaller ecosystem for government infrastructure.
4. **AWS CDK / Azure Bicep** — Cloud-specific IaC. Locks to a single provider.

### Decision

OpenTofu. It's the community fork of Terraform created after the BSL license change, maintaining full compatibility with the HCL language, provider ecosystem, and existing Terraform modules. This aligns with our open-source-only policy and avoids BSL license concerns for government deployment.

### Consequences

- **Positive:** Fully open-source. Drop-in compatible with Terraform providers, modules, and state files. Active community and Linux Foundation governance. No licensing concerns for government procurement.
- **Negative:** Newer project, though backed by Linux Foundation. Some enterprise features (Terraform Cloud) have no equivalent. Slight lag behind Terraform for newest provider features.

---

## ADR-009: Operating System — Rocky Linux 9

**Date:** 2025-02-19
**Status:** Accepted
**NIST Controls:** CM-6, SI-2

### Context

The platform needs a base operating system that has a published DISA STIG, supports FIPS 140-2/3 mode, provides long-term support, and is freely available without subscription.

### Options Considered

1. **Rocky Linux 9** — CentOS successor, RHEL binary-compatible, free, has DISA STIG.
2. **RHEL 9** — Red Hat Enterprise Linux. Gold standard for government but requires subscription.
3. **Ubuntu 22.04** — Canonical LTS. Popular but DISA STIG trails RHEL-based distros.
4. **Amazon Linux 2023** — AWS-optimized. No DISA STIG, AWS lock-in.

### Decision

Rocky Linux 9. It's binary-compatible with RHEL 9 (same STIG applies), freely available without subscription, supports FIPS mode, and has a 10-year support lifecycle. The STIG is published and actively maintained by DISA.

### Consequences

- **Positive:** Free. Uses the same DISA STIG as RHEL 9. FIPS 140-2 validated modules available. 10-year lifecycle. Large community and package ecosystem.
- **Negative:** No vendor support contract (mitigated by community + optional CIQ/OpenLogic support). Slight delay in security patches vs RHEL (typically hours, not days).

---

## How to Add New ADRs

Use the `/generate-adr` slash command in Claude Code:

```
/generate-adr Should we add Backstage as a developer portal
```

This will research the decision, create a new ADR entry, and maintain this index.

### ADR Numbering

- ADR-001 through ADR-009: Foundation decisions (above)
- ADR-010+: Decisions made during implementation (added via /generate-adr)

### Status Values

- **Proposed** — Under discussion
- **Accepted** — Decision made, implementation in progress or complete
- **Superseded by ADR-XXX** — Replaced by a newer decision
- **Deprecated** — No longer applicable
