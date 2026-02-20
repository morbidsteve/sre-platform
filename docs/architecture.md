# Claude Code Prompt: Secure Runtime Environment (SRE)

## Paste this into Claude Code as your project prompt

---

You are building a product called **Secure Runtime Environment (SRE)** — a Kubernetes-based platform that provides a hardened, compliant runtime for deploying applications. It must satisfy government compliance frameworks (ATO, CMMC, FedRAMP, NIST 800-53, DISA STIGs) while also being viable for commercial regulated industries (finance, healthcare). It must provide a simple, GitOps-driven developer experience for deploying applications to the platform.

## Architecture Overview

SRE is an Infrastructure-as-Code (IaC) platform composed of these layers:

1. **Cluster Foundation** — RKE2 Kubernetes distribution on hardened OS
2. **Platform Services** — Security, observability, networking, and policy tooling deployed via Flux CD
3. **Developer Experience** — GitOps-based app deployment with self-service templates
4. **Supply Chain Security** — Image scanning, signing, SBOM generation, and admission control

The platform is modeled after the DoD Platform One / Big Bang architecture but is independently built, 100% open-source, vendor-neutral, and opinionated toward simplicity. Every component is free to use with no special access required. When pursuing government contracts, specific components can be swapped for government-approved equivalents (e.g., Iron Bank images, Vault Enterprise, RHEL).

---

## Layer 1: Cluster Foundation

**Kubernetes Distribution: RKE2**
- Only DISA STIG-certified Kubernetes distribution
- FIPS 140-2 compliant out of the box (BoringCrypto module)
- CIS Kubernetes Benchmark passing with default configuration
- SELinux support, built-in etcd, no Docker dependency
- Supports air-gapped and edge deployments

**Base OS: Rocky Linux 9 (preferred) or Ubuntu 22.04 LTS (STIG-hardened)**
- Rocky Linux 9 is a free, binary-compatible RHEL rebuild — the same DISA STIG and CIS benchmarks for RHEL 9 apply directly
- AlmaLinux 9 is an equally valid alternative
- Apply DISA STIG or CIS Level 2 benchmark via Ansible (use `ansible-lockdown` roles)
- Enable FIPS mode at the OS level
- Enable SELinux in enforcing mode (Rocky/Alma default; configure AppArmor for Ubuntu)
- Configure auditd for NIST AU-family controls

**Provisioning: OpenTofu + Ansible**
- OpenTofu (open-source Terraform fork, fully compatible) for infrastructure (cloud VMs, networking, LBs) with modules for AWS, Azure, on-prem vSphere, and Proxmox VE
- Ansible for OS hardening and RKE2 bootstrap
- Packer for immutable, pre-hardened AMI/VM image builds (AWS, vSphere, Proxmox VE)
- Proxmox VE support enables on-premises homelabs and air-gapped environments with cloud-init based provisioning
- Note: When pursuing government contracts, swap cloud targets to AWS GovCloud / Azure Gov as needed

Create the following directory structure:
```
sre/
├── tofu/
│   ├── modules/
│   │   ├── aws/
│   │   ├── azure/
│   │   ├── vsphere/
│   │   └── proxmox/
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   ├── production/
│   │   └── proxmox-lab/
│   └── main.tf
├── ansible/
│   ├── playbooks/
│   │   ├── harden-os.yml
│   │   └── install-rke2.yml
│   ├── roles/
│   └── inventory/
├── packer/
│   ├── rocky9-hardened.pkr.hcl
│   ├── ubuntu2204-hardened.pkr.hcl
│   └── rocky-linux-9-proxmox/   # Proxmox VE template with RKE2 pre-staged
├── platform/                    # Layer 2 - Flux GitOps
│   ├── flux-system/
│   ├── core/
│   │   ├── istio/
│   │   ├── kyverno/
│   │   ├── monitoring/
│   │   ├── logging/
│   │   ├── runtime-security/
│   │   ├── cert-manager/
│   │   ├── openbao/
│   │   └── backup/
│   └── addons/
│       ├── argocd/              # Optional: for app teams who prefer Argo
│       ├── backstage/
│       ├── harbor/
│       └── keycloak/
├── apps/                        # Layer 3 - App deployment templates
│   ├── templates/
│   │   ├── web-app/
│   │   ├── api-service/
│   │   └── worker/
│   └── tenants/
├── policies/                    # Layer 2 - Kyverno policies
│   ├── baseline/
│   ├── restricted/
│   └── custom/
├── compliance/
│   ├── oscal/
│   ├── stig-checklists/
│   └── nist-800-53-mappings/
├── docs/
│   ├── developer-guide.md
│   ├── operator-guide.md
│   ├── compliance-guide.md
│   └── architecture.md
└── scripts/
    ├── bootstrap.sh
    └── validate-compliance.sh
```

---

## Layer 2: Platform Services

Deploy all platform services via **Flux CD** (the GitOps engine Big Bang uses). Every component is defined as a HelmRelease or Kustomization in the `platform/` directory. Use a Kustomization hierarchy:

```
platform/flux-system/gotk-sync.yaml → platform/core/ → each service
```

### Service Mesh: Istio
- mTLS STRICT mode cluster-wide (zero-trust pod-to-pod)
- Istio ingress/egress gateways for all north-south traffic
- AuthorizationPolicies for fine-grained service-to-service access
- Kiali for service mesh observability
- PeerAuthentication CRD set to STRICT by default

### Policy Enforcement: Kyverno
- Preferred over OPA Gatekeeper for readability and Kubernetes-native CRDs
- Deploy kyverno-policies for Pod Security Standards (Baseline + Restricted)
- Deploy kyverno-reporter for Prometheus metrics and violation reporting
- Key policies to implement:
  - `disallow-privileged-containers`
  - `require-run-as-nonroot`
  - `restrict-host-path-mount`
  - `require-resource-limits`
  - `require-labels` (app, owner, environment, classification)
  - `restrict-image-registries` (only allow from your Harbor instance)
  - `verify-image-signatures` (Cosign verification via Kyverno imageVerify)
  - `disallow-default-namespace`
  - `require-network-policies`

### Monitoring: Prometheus + Grafana
- kube-prometheus-stack (Prometheus Operator, Grafana, AlertManager)
- Pre-built dashboards for: cluster health, namespace resource usage, Istio traffic, Kyverno violations, NeuVector alerts
- AlertManager configured with PagerDuty/Slack/email receivers
- ServiceMonitors for all platform components
- Retention: 15 days in-cluster, long-term to S3-compatible storage via Thanos sidecar

### Logging: Grafana Loki + Alloy
- Alloy (Grafana's collector, replaces Promtail) for log collection from all pods
- Loki for log aggregation and querying
- Grafana as unified UI for logs + metrics + traces
- Ensure audit logs from K8s API server are captured
- Retention: 90 days minimum (configurable per compliance requirement)

### Distributed Tracing: Tempo
- Grafana Tempo for trace storage
- OpenTelemetry Collector for trace ingestion from Istio and app instrumentation
- Integrated into Grafana for unified observability

### Runtime Security: NeuVector (open source)
- Container runtime scanning and behavioral monitoring
- Network segmentation visualization
- CIS benchmark scanning for running containers
- Admission control for vulnerability thresholds
- Process and file activity monitoring
- Alternative: Twistlock/Prisma Cloud Compute (if customer has license)

### Secrets Management: OpenBao + External Secrets Operator
- OpenBao (open-source Vault fork under Linux Foundation, fully compatible APIs) deployed in HA mode with auto-unseal (cloud KMS or transit seal)
- Alternative: HashiCorp Vault community edition (free to use but BSL licensed — swap in for government contracts if customer requires it)
- External Secrets Operator (ESO) to sync OpenBao secrets → Kubernetes Secrets
- Kubernetes auth method (pods authenticate to OpenBao via ServiceAccount)
- Secret rotation policies for all credentials
- Audit logging enabled and forwarded to Loki

### Certificate Management: cert-manager
- cert-manager with Let's Encrypt (staging/prod) or internal CA
- Istio integration for workload certificate issuance
- Certificate rotation automation
- Support for DoD PKI / CAC certificate chains in government deployments

### Identity & Access: Keycloak
- SSO/OIDC provider for all platform UIs (Grafana, Kiali, ArgoCD, Backstage, NeuVector)
- SAML/LDAP federation for Active Directory / DoD JEDI integration
- RBAC groups mapped to Kubernetes ClusterRoles
- MFA enforcement

### Container Registry: Harbor
- Internal registry with Trivy vulnerability scanning on push
- Image replication from upstream public registries (Docker Hub, GitHub Container Registry, Chainguard free images)
- When pursuing government ATO, add Iron Bank (registry1.dso.mil) as an upstream source
- Cosign signature verification on pull
- SBOM attachment storage (SPDX + CycloneDX formats)
- Robot accounts for CI/CD pipelines
- Quota and retention policies per project
- Acts as your own "Iron Bank" — all images must pass Trivy scan gate before deployment

### Backup: Velero
- Cluster state and PV backup to S3-compatible storage
- Scheduled backups with configurable retention
- Disaster recovery runbooks

---

## Layer 3: Developer Experience

The goal: a developer should be able to go from "I have a container image" to "my app is running securely in production" with minimal platform knowledge.

### GitOps App Deployment via Flux CD
- Each tenant/team gets a namespace with:
  - ResourceQuota and LimitRange
  - NetworkPolicy (deny-all default with explicit allows)
  - Kyverno policies scoped to namespace
  - Istio sidecar injection enabled
- Apps are deployed by adding a HelmRelease or Kustomization to the `apps/tenants/<team>/` directory
- Flux watches the Git repo and reconciles automatically

### App Templates (Helm Charts)
Provide standardized Helm chart templates in `apps/templates/` that bake in all compliance requirements:

**`sre-web-app` chart** — for HTTP services:
- Deployment with security context (non-root, read-only rootfs, drop all capabilities)
- HPA for autoscaling
- PodDisruptionBudget
- Service + Istio VirtualService
- NetworkPolicy (ingress from istio-gateway only, egress to specific services)
- ServiceMonitor for Prometheus
- Liveness/readiness probes (configurable)

**`sre-api-service` chart** — for internal APIs:
- Same as web-app but with Istio AuthorizationPolicy for caller restrictions
- mTLS peer authentication

**`sre-worker` chart** — for background processors:
- Same security context
- No ingress, egress only to required services
- Optional CronJob support

Each template accepts a simple `values.yaml`:
```yaml
app:
  name: my-service
  team: alpha
  image: harbor.sre.internal/alpha/my-service:v1.2.3
  port: 8080
  replicas: 2
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 512Mi }
  env:
    - name: DATABASE_URL
      secretRef: my-service-db  # Pulled from OpenBao via ESO
  ingress:
    enabled: true
    host: my-service.apps.sre.example.com
```

### Developer Portal: Backstage (optional addon)
- Software catalog for all deployed services
- Software Templates for scaffolding new services (creates repo, Helm values, Flux config)
- TechDocs for team documentation
- Integration with Harbor, Grafana, ArgoCD

### CI/CD Pipeline Templates
Provide reference CI pipeline definitions (GitLab CI, GitHub Actions) that:
1. Build container image from Dockerfile
2. Scan with Trivy (fail on CRITICAL/HIGH)
3. Generate SBOM with Syft (SPDX + CycloneDX)
4. Sign image with Cosign
5. Push to Harbor
6. Update Helm values in GitOps repo (image tag bump)
7. Flux auto-deploys from there

---

## Layer 4: Supply Chain Security

### Image Pipeline
- All base images sourced from trusted public registries and scanned/hardened in Harbor via Trivy
- Prefer minimal base images: Chainguard (free tier), distroless, or Alpine
- For government deployments, source from Iron Bank (registry1.dso.mil) when available
- Kyverno `imageVerify` policy enforces Cosign signature on all pods
- Kyverno policy restricts image sources to approved registries only (your Harbor instance)
- SBOM generated at build time and attached as Cosign attestation

### Admission Control Chain
Request flow: `API Server → Kyverno (mutate/validate) → NeuVector admission → Pod created → Istio sidecar injected`

### Software Bill of Materials
- Syft generates SBOM during CI
- Stored in Harbor as OCI artifact alongside image
- Queryable for CVE response (e.g., "which apps use log4j?")

---

## Compliance Mapping

### NIST 800-53 Rev 5 Control Families Addressed
| Control Family | Implementation |
|---|---|
| AC (Access Control) | Keycloak SSO + RBAC + Istio AuthorizationPolicy + NetworkPolicy |
| AU (Audit) | Loki + auditd + OpenBao audit log + K8s audit log |
| CA (Assessment) | Kyverno policy reports + NeuVector CIS benchmarks + OSCAL |
| CM (Configuration Mgmt) | GitOps (Flux) + Kyverno policies + immutable infrastructure |
| IA (Identification/Auth) | Keycloak MFA + OpenBao auth + Istio mTLS + cert-manager |
| IR (Incident Response) | AlertManager + NeuVector alerts + Grafana dashboards |
| RA (Risk Assessment) | Trivy scanning + NeuVector runtime + Kyverno violation reports |
| SA (System Acquisition) | SBOM + Cosign + Harbor scan gates + Chainguard/distroless base images |
| SC (System Comms) | Istio mTLS STRICT + TLS everywhere + FIPS crypto |
| SI (System Integrity) | Image signing + admission control + drift detection via Flux |

### CMMC 2.0 Level 2 (NIST 800-171)
The platform directly addresses the 110 controls through the same mechanisms above. The `compliance/nist-800-53-mappings/` directory should contain a crosswalk from 800-53 → 800-171 → platform implementation.

### DISA STIGs Covered
- RKE2 Kubernetes STIG (automated via `scripts/validate-compliance.sh` using `compliance-as-code`)
- RHEL 9 STIG (applied via Ansible — compatible with Rocky Linux 9 / AlmaLinux 9)
- Istio STIG (manual checklist in `compliance/stig-checklists/`)

### OSCAL / cATO Support
- Generate machine-readable compliance artifacts in OSCAL format
- System Security Plan (SSP) template in `compliance/oscal/`
- Enables Continuous Authority to Operate (cATO) through automated evidence collection

---

## Key Design Decisions

1. **Flux CD over ArgoCD as the primary GitOps engine** — Flux is what Big Bang uses, is more Kubernetes-native, and better suited for platform-level orchestration. ArgoCD is available as an optional addon for app teams who prefer its UI.

2. **Kyverno over OPA Gatekeeper** — Kyverno policies are written in YAML (not Rego), making them auditable by non-developers and compliance officers. Kyverno also natively supports image verification.

3. **RKE2 over vanilla K8s or OpenShift** — RKE2 is the only distribution with a published DISA STIG, FIPS compliance, and CIS benchmark alignment out of the box. OpenShift is an alternative but introduces vendor lock-in and significant cost.

4. **Grafana stack (Loki/Tempo/Prometheus) over EFK** — Unified observability UI, lower resource footprint than Elasticsearch, and better integration with Istio.

5. **NeuVector over Falco** — NeuVector provides both runtime security AND network segmentation AND CIS scanning AND admission control in one tool. Falco only covers runtime detection.

6. **External Secrets Operator over direct Vault/OpenBao injection** — ESO produces standard Kubernetes Secrets, which works with any application without SDK changes. Apps remain portable. ESO supports both OpenBao and Vault backends interchangeably.

7. **OpenTofu over Terraform** — Fully open-source (MPL 2.0) fork of Terraform with identical HCL syntax and provider compatibility. Avoids HashiCorp BSL licensing concerns.

8. **OpenBao over HashiCorp Vault** — Linux Foundation open-source fork with compatible APIs. For government contracts where Vault is explicitly required, swap in Vault community edition (the ESO and Kubernetes auth configs are identical).

9. **Harbor as your own hardened registry** — Instead of depending on Iron Bank access (which requires Platform One registration), run Harbor with Trivy scanning and Cosign verification. This gives you the same security posture. Add Iron Bank as an upstream replication source later when pursuing ATO.

---

## Implementation Order

Build the platform in this order:

1. **OpenTofu + Ansible**: Provision VMs, harden OS, install RKE2
2. **Flux CD bootstrap**: Install Flux, set up Git repo sync
3. **Istio**: Service mesh with mTLS
4. **cert-manager**: TLS certificates
5. **Kyverno + policies**: Policy enforcement baseline
6. **Monitoring stack**: Prometheus + Grafana
7. **Logging stack**: Loki + Alloy
8. **OpenBao + ESO**: Secrets management
9. **Harbor**: Container registry
10. **NeuVector**: Runtime security
11. **Keycloak**: SSO for all UIs
12. **Tempo**: Distributed tracing
13. **Velero**: Backup
14. **App templates**: Helm charts for developers
15. **Backstage**: Developer portal (optional)
16. **Compliance artifacts**: OSCAL, STIG checklists, documentation

---

## What to Build Now

Start with steps 1-6. For each component:
- Write the OpenTofu modules and Ansible playbooks/roles
- Write the Flux HelmRelease or Kustomization manifests
- Write the Kyverno policies
- Write a comprehensive README in `docs/`
- Include a `Makefile` or `Taskfile.yml` with commands like:
  - `make infra-plan ENV=dev`
  - `make infra-apply ENV=dev`
  - `make bootstrap-flux`
  - `make validate-compliance`

Focus on making each component production-ready, well-documented, and testable in isolation. Use semantic versioning for the platform Helm charts. Pin all image versions explicitly — no `:latest` tags.
