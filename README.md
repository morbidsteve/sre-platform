# Secure Runtime Environment (SRE)

A hardened, compliance-ready Kubernetes platform for deploying applications in regulated environments.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![OpenTofu](https://img.shields.io/badge/IaC-OpenTofu-purple.svg)](https://opentofu.org)
[![RKE2](https://img.shields.io/badge/K8s-RKE2-blue.svg)](https://docs.rke2.io)
[![Flux CD](https://img.shields.io/badge/GitOps-Flux_CD-blue.svg)](https://fluxcd.io)

---

## Overview

Secure Runtime Environment (SRE) is an open-source, Infrastructure-as-Code platform that provides a hardened Kubernetes runtime for deploying applications. It is designed to satisfy government compliance frameworks -- including ATO, CMMC 2.0 Level 2, FedRAMP, NIST 800-53 Rev 5, and DISA STIGs -- while remaining practical for commercial regulated industries such as finance and healthcare.

The platform is built on RKE2 (the only DISA STIG-certified Kubernetes distribution), managed entirely through GitOps via Flux CD, and composed exclusively of open-source CNCF ecosystem components. Every tool in the stack is free to use with no special access or licensing required. When pursuing government contracts, specific components can be swapped for government-approved equivalents (e.g., Iron Bank images, Vault Enterprise, RHEL subscriptions) without altering the architecture.

SRE is modeled after the DoD Platform One / Big Bang architecture but is independently built, vendor-neutral, and opinionated toward simplicity. It provides a complete platform from bare infrastructure through OS hardening, Kubernetes deployment, security policy enforcement, full observability, and self-service application deployment -- all driven by Git as the single source of truth.

## Key Features

- **Hardened Kubernetes (RKE2)** -- DISA STIG-certified distribution with FIPS 140-2 cryptographic compliance, CIS Kubernetes Benchmark alignment, and SELinux support out of the box
- **Hardened Operating System (Rocky Linux 9)** -- DISA STIG and CIS Level 2 benchmarks applied via Ansible automation with FIPS mode enabled at the OS level
- **Zero-Trust Service Mesh (Istio)** -- Cluster-wide mTLS STRICT mode for encrypted pod-to-pod communication, AuthorizationPolicies for fine-grained access control, and ingress/egress gateways for all north-south traffic
- **Policy Enforcement (Kyverno)** -- Kubernetes-native YAML-based policies enforcing Pod Security Standards, image registry restrictions, image signature verification, resource labeling requirements, and network policy mandates
- **Full Observability Stack** -- Prometheus and Grafana for metrics and dashboards, Loki and Alloy for centralized logging, Tempo for distributed tracing -- unified under a single Grafana interface
- **Runtime Security (NeuVector)** -- Container behavioral monitoring, network microsegmentation with DLP/WAF, CIS benchmark scanning, and admission control for vulnerability thresholds
- **Secrets Management (OpenBao + External Secrets Operator)** -- Centralized secret storage with dynamic credential generation, automatic rotation, and Kubernetes-native delivery via ESO
- **Supply Chain Security (Harbor + Trivy + Cosign)** -- Internal container registry with vulnerability scanning on push, image signature verification, SBOM generation and storage, and replication from upstream registries
- **Certificate Management (cert-manager)** -- Automated TLS certificate lifecycle with support for internal CAs, Let's Encrypt, and DoD PKI chains
- **Identity and SSO (Keycloak)** -- Centralized OIDC/SAML provider with MFA enforcement, LDAP/AD federation, and RBAC group mapping to Kubernetes ClusterRoles
- **GitOps-Driven Operations (Flux CD)** -- All cluster state reconciled from Git with drift detection, automated rollback, and full audit trail via Kubernetes-native CRDs
- **Self-Service Developer Experience** -- Standardized Helm chart templates with security contexts, network policies, and observability integrations baked in, enabling developers to deploy compliant applications with a simple values file
- **Backup and Disaster Recovery (Velero)** -- Scheduled cluster state and persistent volume backups with automated restore testing
- **Immutable Infrastructure (Packer)** -- Pre-hardened VM images for air-gapped and reproducible deployments across AWS, Azure, vSphere, and Proxmox VE
- **Proxmox VE Support** -- First-class on-premises and homelab support with an OpenTofu module for VM provisioning via cloud-init, a Packer template for building Proxmox VM templates, and a ready-to-use lab inventory for Ansible

## Architecture

SRE is composed of four layers, each building on the one below:

```
+------------------------------------------------------------------+
|                    Layer 4: Supply Chain Security                 |
|   Harbor (Trivy scanning) + Cosign (image signing) + SBOM (Syft)|
|   Kyverno imageVerify + NeuVector admission control              |
+------------------------------------------------------------------+
|                    Layer 3: Developer Experience                  |
|   Helm chart templates (web-app, api-service, worker, cronjob)   |
|   Tenant namespaces + ResourceQuotas + GitOps app deployment     |
+------------------------------------------------------------------+
|                    Layer 2: Platform Services                     |
|   Istio | Kyverno | Prometheus/Grafana | Loki/Alloy | Tempo     |
|   NeuVector | OpenBao + ESO | cert-manager | Keycloak | Velero  |
|   All deployed and reconciled via Flux CD                        |
+------------------------------------------------------------------+
|                    Layer 1: Cluster Foundation                    |
|   RKE2 Kubernetes on Rocky Linux 9 (STIG-hardened, FIPS enabled) |
|   Provisioned by OpenTofu (AWS, Azure, vSphere, Proxmox VE)      |
|   Hardened by Ansible | Imaged by Packer                         |
+------------------------------------------------------------------+
```

**Layer 1 -- Cluster Foundation:** Infrastructure provisioned with OpenTofu (AWS, Azure, vSphere, or Proxmox VE), operating system hardened to DISA STIG standards via Ansible, and RKE2 Kubernetes installed with FIPS 140-2 mode and CIS benchmark profile enabled.

**Layer 2 -- Platform Services:** Security, observability, networking, policy, and secrets tooling deployed via Flux CD as HelmReleases and Kustomizations. Every component is defined declaratively in Git and continuously reconciled to the cluster.

**Layer 3 -- Developer Experience:** Self-service application deployment through standardized Helm chart templates and GitOps-managed tenant namespaces. Developers deploy applications by committing a values file; the platform handles security contexts, network policies, monitoring, and mesh integration automatically.

**Layer 4 -- Supply Chain Security:** End-to-end image integrity from build through deployment. Images are scanned by Trivy in Harbor, signed with Cosign, verified by Kyverno admission control, and monitored at runtime by NeuVector.

## Project Structure

```
sre/
├── infrastructure/
│   ├── tofu/                    # OpenTofu modules and environments
│   │   ├── modules/             # Reusable infrastructure modules (AWS, Azure, vSphere, Proxmox)
│   │   └── environments/        # Per-environment configurations (dev, staging, production, proxmox-lab)
│   ├── ansible/                 # OS hardening and RKE2 installation playbooks
│   │   ├── playbooks/           # Main playbooks (harden-os, install-rke2, site)
│   │   ├── roles/               # Ansible roles (os-hardening, rke2-server, rke2-agent)
│   │   └── inventory/           # Per-environment inventory files
│   └── packer/                  # Immutable VM image builds (Rocky Linux 9 for AWS, vSphere, Proxmox)
├── platform/                    # Flux CD GitOps manifests for platform services
│   ├── flux-system/             # Flux bootstrap and root Kustomizations
│   ├── core/                    # Core platform services
│   │   ├── istio/               # Service mesh with mTLS STRICT
│   │   ├── kyverno/             # Policy engine
│   │   ├── monitoring/          # Prometheus + Grafana + Alertmanager
│   │   ├── logging/             # Loki + Alloy
│   │   ├── tracing/             # Tempo
│   │   ├── cert-manager/        # TLS certificate management
│   │   ├── openbao/             # Secrets management
│   │   ├── external-secrets/    # External Secrets Operator
│   │   ├── runtime-security/    # NeuVector
│   │   └── backup/              # Velero
│   └── addons/                  # Optional platform services
│       ├── harbor/              # Container registry
│       ├── keycloak/            # Identity and SSO
│       ├── backstage/           # Developer portal
│       └── argocd/              # Alternative GitOps UI for app teams
├── apps/                        # Application deployment
│   ├── templates/               # Standardized Helm chart templates
│   │   ├── sre-web-app/         # Web application chart
│   │   ├── sre-api-service/     # Internal API chart
│   │   ├── sre-worker/          # Background worker chart
│   │   └── sre-cronjob/         # Scheduled job chart
│   └── tenants/                 # Per-team application deployment configs
├── policies/                    # Kyverno policies
│   ├── baseline/                # Pod Security Standards baseline (cluster-wide)
│   ├── restricted/              # Pod Security Standards restricted (tenant namespaces)
│   ├── custom/                  # SRE-specific policies
│   └── tests/                   # Policy test suites (required for every policy)
├── compliance/                  # Compliance artifacts
│   ├── oscal/                   # OSCAL System Security Plan
│   ├── stig-checklists/         # DISA STIG checklist files
│   └── nist-800-53-mappings/    # NIST control-to-component mappings
├── docs/                        # Documentation
├── scripts/                     # Bootstrap and validation scripts
├── Taskfile.yml                 # Task runner commands
└── CLAUDE.md                    # AI-assisted development instructions
```

## Quick Start

### Proxmox VE (one-command quickstart)

```bash
git clone https://github.com/morbidsteve/sre-platform.git
cd sre-platform
./scripts/quickstart-proxmox.sh
```

The script prompts for your Proxmox connection details, then automates the entire pipeline: Packer image build, OpenTofu VM provisioning, Ansible OS hardening + RKE2 install, kubeconfig retrieval, and Flux CD bootstrap. See the [Proxmox Getting Started Guide](docs/getting-started-proxmox.md) for details and manual steps.

### Cloud (AWS / Azure / vSphere)

#### Prerequisites

- A Kubernetes-capable environment (AWS, Azure, or vSphere)
- [Task](https://taskfile.dev) installed as the command runner
- Git for version control and GitOps workflow

#### 1. Clone the repository

```bash
git clone https://github.com/morbidsteve/sre-platform.git
cd sre-platform
```

### 2. Install required CLI tools

```bash
task init
```

This installs yamllint, ansible-lint, Kyverno CLI, Helm, Flux CLI, Trivy, and OpenTofu.

### 3. Provision infrastructure

**Cloud (AWS/Azure/vSphere):**
```bash
# Review the plan
task infra-plan ENV=dev

# Apply infrastructure (provisions VMs, networking, load balancers)
task infra-apply ENV=dev
```

**Proxmox VE (on-premises / homelab):**
```bash
# Build the VM template first
cd infrastructure/packer/rocky-linux-9-proxmox
packer init .
packer build -var 'proxmox_url=https://pve.example.com:8006/api2/json' \
  -var 'proxmox_username=packer@pve!packer-token' \
  -var 'proxmox_token=YOUR_TOKEN' \
  -var 'proxmox_node=pve' \
  -var 'iso_file=local:iso/Rocky-9.3-x86_64-minimal.iso' \
  -var 'vm_storage_pool=local-lvm' .

# Then provision VMs from the template
cd ../../tofu/environments/proxmox-lab
tofu init && tofu plan && tofu apply
```

### 4. Harden the OS and install RKE2

```bash
# Cloud environments
cd infrastructure/ansible
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml

# Proxmox lab
ansible-playbook playbooks/site.yml -i inventory/proxmox-lab/hosts.yml
```

### 5. Bootstrap Flux CD

```bash
task bootstrap-flux REPO_URL=https://github.com/morbidsteve/sre-platform
```

Flux will begin reconciling all platform services from the Git repository automatically.

### 6. Validate the deployment

```bash
# Run all linters
task lint

# Run compliance and policy validation
task validate

# Check Flux reconciliation status
task flux-status

# Generate a compliance report
task compliance-report
```

## Documentation

### Getting Started

| Guide | Audience | Description |
|-------|----------|-------------|
| [Deploy to Proxmox](docs/getting-started-proxmox.md) | Platform engineers | Step-by-step: local tool setup, Packer build, OpenTofu provision, Ansible harden, Flux bootstrap |
| [Deploy Your App](docs/getting-started-developer.md) | App developers | Tool installation, credential setup, build compliant images, deploy with SRE Helm charts, integrate with platform services |
| [Onboarding Guide](docs/onboarding-guide.md) | Team leads | Request a tenant namespace and understand what gets provisioned |

### Reference

| Guide | Description |
|-------|-------------|
| [Architecture](docs/architecture.md) | Full platform architecture specification and design rationale |
| [Decision Records](docs/decisions.md) | Architectural Decision Records (ADRs) for all major technology choices |
| [Developer Guide](docs/developer-guide.md) | Complete reference for all Helm chart values and configuration options |
| [Operator Guide](docs/operator-guide.md) | Day-2 operations: monitoring, alerting, upgrades, backup, and rotation |
| [Security Guide](docs/security-guide.md) | Security architecture, threat model, and incident response procedures |
| [Compliance Guide](docs/compliance-guide.md) | Compliance framework coverage and artifact generation |
| [Session Playbook](docs/session-playbook.md) | Step-by-step build plan for the platform |

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Kubernetes Distribution | RKE2 | DISA STIG-certified, FIPS 140-2 compliant Kubernetes |
| Base Operating System | Rocky Linux 9 | RHEL-compatible OS with published DISA STIG |
| Infrastructure as Code | OpenTofu | Declarative infrastructure provisioning (AWS, Azure, vSphere, Proxmox VE) |
| OS Hardening | Ansible | DISA STIG application, RKE2 installation, idempotent configuration |
| Image Builds | Packer | Immutable, pre-hardened VM images for reproducible deployments (AWS, vSphere, Proxmox VE) |
| Virtualization (on-prem) | Proxmox VE | On-premises hypervisor with VM provisioning via cloud-init and OpenTofu |
| GitOps Engine | Flux CD | Continuous reconciliation of cluster state from Git |
| Service Mesh | Istio | Zero-trust mTLS, traffic management, and authorization policies |
| Policy Engine | Kyverno | Kubernetes-native admission control, mutation, and image verification |
| Metrics and Dashboards | kube-prometheus-stack | Prometheus, Grafana, and Alertmanager |
| Logging | Loki + Alloy | Centralized log aggregation and collection |
| Tracing | Tempo | Distributed trace storage integrated with Grafana |
| Runtime Security | NeuVector | Container behavioral monitoring, network DLP/WAF, CIS scanning |
| Secrets Management | OpenBao | Centralized secrets with dynamic credentials and automatic rotation |
| Secrets Delivery | External Secrets Operator | Syncs secrets from OpenBao into native Kubernetes Secrets |
| Certificate Management | cert-manager | Automated TLS certificate lifecycle and rotation |
| Identity and SSO | Keycloak | OIDC/SAML provider with MFA, LDAP federation, RBAC mapping |
| Container Registry | Harbor | Image storage with Trivy scanning, Cosign verification, replication |
| Image Scanning | Trivy | Vulnerability scanning for container images and IaC configurations |
| Image Signing | Cosign | Cryptographic image signature creation and verification |
| SBOM Generation | Syft | Software Bill of Materials in SPDX and CycloneDX formats |
| Backup | Velero | Cluster state and persistent volume backup with disaster recovery |

## Compliance

SRE is designed to satisfy the following compliance frameworks:

- **NIST 800-53 Rev 5** -- Covers control families AC, AU, CA, CM, IA, IR, MP, RA, SA, SC, and SI through platform components with machine-readable mappings
- **CMMC 2.0 Level 2** -- Addresses all 110 NIST 800-171 controls via the same mechanisms as the 800-53 implementation
- **DISA STIGs** -- RKE2 Kubernetes STIG, RHEL 9 / Rocky Linux 9 STIG, and Istio STIG applied and validated automatically
- **FedRAMP** -- Architecture supports FedRAMP authorization through NIST 800-53 control inheritance and OSCAL artifact generation
- **ATO (Authority to Operate)** -- Continuous ATO (cATO) supported through automated compliance evidence collection

Compliance artifacts are stored in the `compliance/` directory:

- `compliance/oscal/` -- OSCAL System Security Plan (SSP) in machine-readable JSON format
- `compliance/stig-checklists/` -- DISA STIG checklist files pre-filled with implementation status
- `compliance/nist-800-53-mappings/` -- Control-to-component crosswalk for automated reporting

Every Kyverno policy, Helm chart, and Flux manifest includes `sre.io/nist-controls` annotations mapping the resource to the specific NIST 800-53 controls it satisfies.

### Compliance Commands

```bash
# Generate compliance report from live cluster
task compliance-report

# Identify gaps in NIST 800-53 control coverage
task compliance-gaps

# Run Kyverno policy tests
task validate:kyverno

# Scan Kubernetes manifests for security issues
task security-scan-config TARGET=platform/
```

## Key Commands

All operations are managed through [Task](https://taskfile.dev):

| Command | Description |
|---------|-------------|
| `task init` | Install all required CLI tools and dependencies |
| `task lint` | Run all linters (YAML, HCL, Helm, Ansible) |
| `task validate` | Run all validators (Kyverno tests, OpenTofu validate, Helm schemas) |
| `task test` | Run full test suite (lint + validate) |
| `task fmt` | Auto-format all files (YAML, HCL, Helm) |
| `task infra-plan ENV=<env>` | Run OpenTofu plan for an environment |
| `task infra-apply ENV=<env>` | Apply infrastructure changes |
| `task bootstrap-flux REPO_URL=<url>` | Bootstrap Flux CD onto the cluster |
| `task flux-status` | Show status of all Flux resources |
| `task flux-reconcile` | Force reconcile all Flux resources |
| `task helm-template CHART=<path>` | Render a Helm chart for inspection |
| `task security-scan IMAGE=<image>` | Run Trivy vulnerability scan on a container image |
| `task security-scan-config` | Run Trivy config scan on Kubernetes manifests |
| `task compliance-report` | Generate compliance report from cluster state |
| `task compliance-gaps` | Show NIST 800-53 controls without implementing components |
| `task clean` | Remove generated files and caches |

## Contributing

### Branch Naming

Use descriptive prefixes for all branches:

- `feat/` -- New features or components
- `fix/` -- Bug fixes
- `docs/` -- Documentation changes
- `refactor/` -- Code restructuring without functional changes

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(istio): add strict mTLS peer authentication
fix(kyverno): correct image registry pattern matching
docs(operator-guide): add certificate rotation runbook
refactor(tofu): extract common tags into shared module
```

### Pull Request Requirements

- One component per PR when possible
- All PRs must pass `task lint` and `task validate`
- Every new component must include a `README.md`
- All Kyverno policies must have corresponding test suites in `policies/tests/`
- All Helm charts must include a `values.schema.json`
- Never use `:latest` image tags -- always pin specific versions
- Never commit secrets, tokens, or credentials

### Coding Standards

- **YAML:** 2-space indent, no tabs, quoted strings for ambiguous values
- **HCL:** Must pass `tofu fmt` formatting check
- **Ansible:** Use fully qualified collection names (FQCN) for all modules; all playbooks must be idempotent
- **Helm charts:** Must include NOTES.txt, chart tests, and JSON schema for values validation

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.
