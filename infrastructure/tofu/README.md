# OpenTofu Infrastructure

OpenTofu modules and environment configurations for provisioning the SRE platform's cloud infrastructure. OpenTofu is a fully open-source (MPL 2.0) fork of Terraform with identical HCL syntax and provider compatibility.

See [OpenTofu patterns](../../docs/agent-docs/tofu-patterns.md) for coding conventions.

## Structure

```
tofu/
├── modules/          # Reusable, provider-agnostic modules
│   ├── compute/      # VM instances for RKE2 nodes
│   ├── network/      # VPC, subnets, security groups
│   ├── dns/          # DNS zone and record management
│   ├── load-balancer/ # L4 load balancer for K8s API and Istio ingress
│   └── storage/      # Object storage (S3-compatible) for backups, logs, state
├── environments/     # Per-environment compositions
│   ├── dev/
│   ├── staging/
│   └── production/
└── scripts/          # Helper scripts (state backend init, etc.)
```

## Usage

```bash
task infra-plan ENV=dev      # Preview changes
task infra-apply ENV=dev     # Apply changes
```

## Key Rules

- Pin exact provider versions in `versions.tf` (no `>=` or `~>`)
- Never store state locally — use S3-compatible remote backend with locking
- Never commit secrets in `.tfvars` — use `TF_VAR_` env vars
- Tag all resources with `Project`, `Environment`, `ManagedBy`, `Compliance`
- Run `tofu fmt` before every commit
