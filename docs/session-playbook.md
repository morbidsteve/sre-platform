# SRE Build Playbook — Session-by-Session Guide

This is your reference during implementation. One session per component, one concern per session.

## How to Use This

Before each session:
1. Open Claude Code in the `sre/` repo
2. Create a feature branch: `git checkout -b feat/<component>`
3. Copy the opening prompt below into Claude Code
4. Follow the Plan → Review → Execute → Validate → Document → Commit pattern
5. When context gets large, type `/compact`

---

## Session 1: Project Scaffold

**Branch:** `feat/scaffold`

**Opening prompt:**
```
Read @docs/architecture.md. This is our full spec. Create the complete
directory structure for the SRE platform, including all directories
referenced in the architecture doc. Create placeholder README.md files
in each major directory explaining its purpose. Verify the structure
matches CLAUDE.md's Project Structure section. Don't create any actual
manifests yet — just the skeleton.
```

**Expected output:** Full directory tree, placeholder READMEs, `.gitignore`, `.yamllint.yml`

---

## Session 2: OpenTofu Modules

**Branch:** `feat/tofu-modules`

**Opening prompt:**
```
Read @docs/agent-docs/tofu-patterns.md. Create the OpenTofu module
structure under infrastructure/tofu/. Start with these modules:
1. modules/vpc — VPC with public/private subnets, NAT gateway, flow logs
2. modules/compute — EC2/VM instances for RKE2 nodes (server + agent pools)
3. modules/load-balancer — NLB for K8s API and Istio ingress
4. environments/dev/ — Dev environment composing these modules
Include variables.tf with validations, outputs.tf with descriptions,
versions.tf with exact provider pins, and README.md for each module.
```

**Expected output:** 3 modules + 1 environment, all with standard structure

---

## Session 3: Ansible Roles

**Branch:** `feat/ansible-roles`

**Opening prompt:**
```
Read @docs/agent-docs/ansible-patterns.md. Create these Ansible roles
under infrastructure/ansible/:
1. roles/os-hardening — Rocky Linux 9 STIG hardening (sshd, auditd,
   sysctl, filesystem permissions, PAM, FIPS mode)
2. roles/rke2-server — RKE2 server node installation and configuration
3. roles/rke2-agent — RKE2 agent node join
4. site.yml — Main playbook composing all roles
5. inventory/dev/ — Dev inventory with host groups
Use FQCN for all modules. All tasks must be idempotent.
```

**Expected output:** 3 roles with full task files, handlers, defaults, templates

---

## Session 4: Packer Images

**Branch:** `feat/packer-images`

**Opening prompt:**
```
Read @docs/architecture.md for the image pipeline section. Create Packer
templates under infrastructure/packer/ for:
1. rocky-linux-9-base/ — Base Rocky Linux 9 image with os-hardening
   role pre-applied, FIPS enabled, CIS benchmark Level 1
2. rocky-linux-9-rke2/ — Extends base with RKE2 binary pre-staged,
   container images pre-pulled for air-gap support
Include variables.pkr.hcl, build.pkr.hcl, and README.md for each.
Support both AWS AMI and vSphere template builders.
```

**Expected output:** 2 Packer templates with dual builder support

---

## Session 5: Flux Bootstrap

**Branch:** `feat/flux-bootstrap`

**Opening prompt:**
```
Read @docs/agent-docs/flux-patterns.md. Create the Flux CD bootstrap
manifests under platform/flux-system/:
1. gotk-components.yaml — Flux toolkit components
2. gotk-sync.yaml — Root GitRepository + Kustomization pointing at platform/
3. platform/core/kustomization.yaml — Root Flux Kustomization that
   includes all core components in dependency order
4. platform/addons/kustomization.yaml — Root for optional addons
Set up the HelmRepository sources for all charts we'll use (Istio,
Kyverno, Prometheus, Grafana, Loki, cert-manager, Harbor, NeuVector,
Keycloak, Velero, Tempo).
```

**Expected output:** Flux bootstrap files + all HelmRepository sources

---

## Session 6: Istio

**Branch:** `feat/istio`

**Opening prompt:**
```
/new-component istio

After scaffolding, also create:
1. PeerAuthentication for STRICT mTLS cluster-wide
2. Istio Gateway for external ingress
3. AuthorizationPolicy defaults
4. Kyverno policy requiring sidecar injection labels on namespaces
Make sure the HelmRelease has no dependsOn (Istio is first in the chain).
```

**Expected output:** Complete Istio component + mTLS + gateway + policy

---

## Session 7: cert-manager

**Branch:** `feat/cert-manager`

**Opening prompt:**
```
/new-component cert-manager

After scaffolding, also create:
1. ClusterIssuer for internal CA (self-signed root → intermediate)
2. ClusterIssuer for Let's Encrypt staging (for dev)
3. Certificate resource for Istio ingress gateway
HelmRelease must dependsOn istio.
```

**Expected output:** cert-manager component + ClusterIssuers + gateway cert

---

## Session 8: Kyverno

**Branch:** `feat/kyverno`

**Opening prompt:**
```
/new-component kyverno

After scaffolding, create the baseline policy set under policies/:
1. require-labels — Enforce standard labels on all resources
2. require-security-context — Enforce pod security context
3. restrict-image-registries — Only allow harbor.sre.internal
4. disallow-latest-tag — Block :latest image tags
5. require-network-policies — Ensure every namespace has a default deny
6. verify-image-signatures — Cosign verification from Harbor

For each policy, use /new-policy to generate it with full test suites.
HelmRelease must dependsOn istio and cert-manager.
```

**Expected output:** Kyverno component + 6 policies + 6 test suites

---

## Session 9: Monitoring

**Branch:** `feat/monitoring`

**Opening prompt:**
```
/new-component monitoring

Use the kube-prometheus-stack chart. Configure:
1. Prometheus with 15d retention, persistent storage
2. Grafana with Istio, Flux, Kyverno, and node dashboards
3. Alertmanager with placeholder webhook receiver
4. ServiceMonitors for Istio, Kyverno, cert-manager, and Flux
5. PrometheusRule for SRE-specific alerts (pod security violations,
   certificate expiry, Flux reconciliation failures)
HelmRelease must dependsOn istio, kyverno.
```

**Expected output:** Full monitoring stack with dashboards and alerts

---

## Session 10: Logging

**Branch:** `feat/logging`

**Opening prompt:**
```
/new-component logging

Deploy Loki (simple scalable mode) + Alloy as the log collector.
Configure:
1. Alloy DaemonSet collecting from all node journals and container logs
2. Loki with S3-compatible backend (MinIO for dev, S3 for prod)
3. Grafana datasource for Loki (add to monitoring's Grafana)
4. Retention policy: 30d default, 90d for audit namespace
HelmRelease must dependsOn istio, monitoring.
```

**Expected output:** Loki + Alloy + Grafana integration

---

## Session 11: OpenBao + ESO

**Branch:** `feat/secrets`

**Opening prompt:**
```
/new-component openbao

Deploy OpenBao in HA mode with Raft storage. Configure:
1. Auto-unseal (AWS KMS for prod, dev key for dev)
2. Kubernetes auth method
3. PKI secrets engine for internal certificates
4. KV v2 secrets engine for application secrets
5. Policies for platform-admin and tenant-reader roles

Then: /new-component external-secrets

Deploy External Secrets Operator configured to sync from OpenBao.
Create ClusterSecretStore pointing to OpenBao.
Create example ExternalSecret showing the pattern for tenants.
OpenBao dependsOn istio, monitoring. ESO dependsOn openbao.
```

**Expected output:** OpenBao + ESO + ClusterSecretStore + example

---

## Session 12: Harbor

**Branch:** `feat/harbor`

**Opening prompt:**
```
/new-component harbor

Deploy Harbor with:
1. Trivy scanner enabled for automatic vulnerability scanning
2. Robot accounts for CI/CD image push
3. Replication policy structure (for pulling from upstream registries)
4. Garbage collection CronJob
5. Cosign/Notation integration for image signing
6. Storage backend: S3-compatible (MinIO for dev)
7. Kyverno policy to verify images are signed by Harbor's key
HelmRelease must dependsOn istio, cert-manager, monitoring.
```

**Expected output:** Harbor component + image signing + replication

---

## Session 13: NeuVector

**Branch:** `feat/neuvector`

**Opening prompt:**
```
/new-component neuvector

Deploy NeuVector for runtime security:
1. Scanner in all namespaces
2. Network rules from Discover mode baseline
3. Process profile rules (whitelist mode)
4. DLP/WAF sensors for PII detection
5. SYSLOG integration to Alloy for centralized logging
6. Admission control webhook (complement to Kyverno)
HelmRelease must dependsOn istio, monitoring. Note: NeuVector needs
privileged access — use the documented security exception.
```

**Expected output:** NeuVector component with security exception documented

---

## Session 14: Keycloak

**Branch:** `feat/keycloak`

**Opening prompt:**
```
/new-component keycloak

Deploy Keycloak for identity and SSO:
1. SRE realm with OIDC clients for Grafana, Harbor, and OpenBao
2. Group-based RBAC mapping (platform-admins, developers, viewers)
3. Istio RequestAuthentication + AuthorizationPolicy for JWT validation
4. External database (PostgreSQL via OpenBao dynamic credentials)
5. Custom theme placeholder
HelmRelease must dependsOn istio, cert-manager, openbao, monitoring.
```

**Expected output:** Keycloak + realm config + OIDC clients + Istio auth

---

## Session 15: Tempo

**Branch:** `feat/tempo`

**Opening prompt:**
```
/new-component tempo

Deploy Tempo for distributed tracing:
1. Receive traces from Istio (OpenTelemetry/Zipkin)
2. S3-compatible storage backend
3. Grafana datasource (add to monitoring's Grafana)
4. Alloy trace pipeline configuration
HelmRelease must dependsOn istio, monitoring.
```

**Expected output:** Tempo + Grafana datasource + Alloy trace config

---

## Session 16: Velero

**Branch:** `feat/velero`

**Opening prompt:**
```
/new-component velero

Deploy Velero for backup and disaster recovery:
1. S3 backup storage location
2. Volume snapshots via CSI
3. Scheduled backups: daily (retain 7), weekly (retain 4), monthly (retain 3)
4. Backup of all namespaces except kube-system, flux-system
5. Restore testing CronJob (restores to test namespace, validates, cleans up)
HelmRelease must dependsOn istio, monitoring.
Note: Velero needs privileged access — use the documented security exception.
```

**Expected output:** Velero + schedules + restore test

---

## Session 17: App Templates

**Branch:** `feat/app-templates`

**Opening prompt:**
```
Read @docs/agent-docs/helm-conventions.md. Create the SRE standard
Helm chart templates under apps/templates/:
1. sre-web-app — Generic web application (Deployment, Service,
   VirtualService, HPA, PDB, ServiceMonitor, NetworkPolicy)
2. sre-worker — Background worker (Deployment, no Service, HPA,
   PDB, ServiceMonitor, NetworkPolicy)
3. sre-cronjob — Scheduled job (CronJob, NetworkPolicy, ServiceMonitor)
Each chart must include values.schema.json enforcing harbor.sre.internal
registry and blocking :latest tags. Include chart tests and NOTES.txt.
```

**Expected output:** 3 Helm charts with full security contexts + schemas

---

## Session 18: Tenant Onboarding

**Branch:** `feat/tenant-onboarding`

**Opening prompt:**
```
Create a reference tenant to demonstrate the onboarding pattern:

/new-tenant team-alpha

Then create a second tenant to prove the pattern is repeatable:

/new-tenant team-beta

After both are created, verify:
1. Both tenants have identical structure (just different names/groups)
2. NetworkPolicies allow inter-pod communication within namespace
3. NetworkPolicies allow traffic from istio-system, monitoring, kube-dns
4. ResourceQuotas and LimitRanges are set
5. RBAC maps to Keycloak groups
```

**Expected output:** 2 complete tenant namespaces demonstrating the pattern

---

## Session 19: Compliance Artifacts

**Branch:** `feat/compliance`

**Opening prompt:**
```
Read @docs/agent-docs/compliance-mapping.md. Create compliance
artifacts under compliance/:
1. oscal/ — OSCAL System Security Plan (SSP) in JSON format covering
   all NIST 800-53 controls implemented by the platform
2. stig-checklists/ — DISA STIG checklist files for Rocky Linux 9
   and Kubernetes, pre-filled with SRE implementation status
3. nist-mapping/ — Machine-readable NIST 800-53 → component mapping
   (JSON format) that can be used for automated compliance reporting
4. cmmc/ — CMMC 2.0 Level 2 self-assessment worksheet

Run /compliance-check on 3 components (istio, kyverno, monitoring)
to verify annotation coverage.
```

**Expected output:** OSCAL SSP + STIG checklists + NIST mapping + CMMC worksheet

---

## Session 20: Documentation

**Branch:** `feat/documentation`

**Opening prompt:**
```
Create the final documentation set under docs/:
1. developer-guide.md — How to deploy an app on SRE (from zero to
   running), using the sre-web-app Helm chart template
2. operator-guide.md — Day-2 operations: monitoring, alerting,
   upgrades, backup/restore, certificate rotation, secret rotation
3. security-guide.md — Security architecture overview, threat model,
   incident response procedures
4. onboarding-guide.md — How to request a new tenant namespace,
   get credentials, deploy your first app
5. Update the root README.md with a project overview, quick start,
   and links to all documentation

Run @security-reviewer on the entire platform/ directory for a
final security review. Fix any findings.
```

**Expected output:** Complete docs + clean security review

---

## Post-Build Checklist

After all 20 sessions:

- [ ] `task test` passes clean
- [ ] `task compliance-gaps` shows zero gaps
- [ ] All components have README.md
- [ ] All Kyverno policies have test suites
- [ ] All Helm charts have values.schema.json
- [ ] Every namespace has a default-deny NetworkPolicy
- [ ] `@compliance-auditor` audit of full platform passes
- [ ] `@security-reviewer` review of full platform passes
- [ ] `@manifest-validator` cross-validation passes
- [ ] All 4 subagents run clean on the complete repo
- [ ] Git history has clean conventional commits
- [ ] Architecture decisions documented in docs/decisions.md

---

## Tips

- **If a session runs long**, use `/compact` to free context. Claude preserves the current component, modified files, and any errors.
- **If Claude drifts from patterns**, point it to the relevant agent-doc: `Read @docs/agent-docs/flux-patterns.md and fix the HelmRelease to match.`
- **If validation fails**, don't fix it yourself — have Claude fix it: `task lint failed with this output: <paste>. Fix the issues.`
- **If you need to resume a session**, use `claude --resume` to pick up where you left off.
- **If a component depends on another that doesn't exist yet**, Claude will scaffold the references anyway — Flux will reconcile once dependencies deploy.
