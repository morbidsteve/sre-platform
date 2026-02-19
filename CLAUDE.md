# Secure Runtime Environment (SRE)

## What This Is
A government-compliant, open-source Kubernetes platform providing a hardened runtime
for deploying applications. Targets ATO, CMMC, FedRAMP, NIST 800-53, DISA STIGs.
Built on RKE2, Flux CD, and the CNCF ecosystem.

## Architecture
Read @docs/architecture.md for the full architecture spec.
Read @docs/decisions.md for all architectural decision records (ADRs).

## Project Structure
- `tofu/` — OpenTofu infrastructure modules (AWS, Azure, vSphere)
- `ansible/` — OS hardening + RKE2 installation playbooks
- `packer/` — Immutable VM image builds (Rocky Linux 9)
- `platform/` — Flux CD GitOps manifests for all platform services
- `platform/core/` — Istio, Kyverno, monitoring, logging, secrets, security
- `platform/addons/` — Optional services (Backstage, Keycloak, ArgoCD)
- `apps/templates/` — Helm chart templates for developer app deployment
- `apps/tenants/` — Per-team app deployment configs
- `policies/` — Kyverno policies (baseline, restricted, custom)
- `compliance/` — OSCAL, STIG checklists, NIST mappings
- `docs/` — All documentation (read these before modifying related code)
- `scripts/` — Bootstrap and validation scripts

## Key Commands
- `task infra-plan` — Run OpenTofu plan (requires ENV var)
- `task infra-apply` — Apply infrastructure changes
- `task bootstrap-flux` — Install Flux CD on a cluster
- `task validate` — Run compliance validation checks
- `task lint` — Lint all YAML/HCL/Ansible files
- `task test` — Run all tests (OPA policy tests, Helm unit tests)
- `task docs` — Build documentation site

## Tech Stack & Tools
- **IaC**: OpenTofu (HCL), Ansible (YAML), Packer (HCL)
- **K8s Distribution**: RKE2
- **GitOps**: Flux CD (HelmRelease, Kustomization CRDs)
- **Service Mesh**: Istio
- **Policy Engine**: Kyverno
- **Monitoring**: kube-prometheus-stack (Prometheus + Grafana)
- **Logging**: Loki + Alloy
- **Tracing**: Tempo
- **Secrets**: OpenBao + External Secrets Operator
- **Runtime Security**: NeuVector
- **Registry**: Harbor + Trivy
- **Certificates**: cert-manager
- **Identity**: Keycloak
- **Backup**: Velero
- **App Deployment**: Custom Helm charts in apps/templates/

## Coding Standards
- All YAML: 2-space indent, no tabs, quoted strings for anything that could be misinterpreted
- All HCL: `tofu fmt` compliant
- Ansible: Use FQCN (fully qualified collection names) for all modules
- Helm charts: Include NOTES.txt, chart tests, JSON schema for values
- Every component gets a README.md explaining what it does and how to configure it
- Pin ALL image versions explicitly — NEVER use `:latest`
- All secrets in examples must use placeholder values like `changeme` or `REPLACE_ME`

## Git Workflow
- Branch naming: `feat/`, `fix/`, `docs/`, `refactor/` prefixes
- Conventional commits: `feat(istio): add strict mTLS peer authentication`
- One component per PR when possible
- Every PR must pass `task lint` and `task validate`

## IMPORTANT Rules
- NEVER commit real secrets, tokens, or credentials to this repo
- NEVER use `:latest` image tags anywhere — always pin specific versions
- NEVER skip writing a README when creating a new component
- All Kyverno policies MUST have corresponding policy tests in `policies/tests/`
- All Helm charts MUST have a values.schema.json
- When creating Flux HelmRelease manifests, ALWAYS include health checks and remediation config
- When writing Ansible, ALWAYS make playbooks idempotent

## Context & Reference Docs
Before working on a specific area, read the relevant doc:
- Platform services: @docs/architecture.md
- Adding a new platform component: @docs/agent-docs/adding-platform-component.md
- Writing Kyverno policies: @docs/agent-docs/kyverno-patterns.md
- Helm chart conventions: @docs/agent-docs/helm-conventions.md
- OpenTofu module patterns: @docs/agent-docs/tofu-patterns.md
- Ansible role patterns: @docs/agent-docs/ansible-patterns.md
- Compliance mapping: @docs/agent-docs/compliance-mapping.md
- Flux CD patterns: @docs/agent-docs/flux-patterns.md

## Compaction Rules
When compacting, always preserve:
- The current component being worked on and its session number
- The full list of files created or modified in this session
- Any failing validation output (task lint, task validate errors)
- The current branch name
- Any pending TODOs or unresolved issues from this session

## Session Workflow
Each session follows: Plan → Review → Execute → Validate → Document → Commit.
- Use Plan Mode (Shift+Tab twice) before writing any files
- Run `task lint` and `task validate` before committing
- Every component gets a README.md
- Commit with conventional commits: `feat(<component>): <description>`
- Use `/compact` proactively when context grows large

## Subagents
- `@compliance-auditor` — Audit NIST 800-53 / CMMC control coverage
- `@security-reviewer` — Find vulnerabilities in manifests and IaC
- `@docs-writer` — Write READMEs, runbooks, and ADRs
- `@manifest-validator` — Cross-validate K8s resource consistency

## Session Playbook
See @docs/session-playbook.md for the 20-session build plan with exact opening prompts.
