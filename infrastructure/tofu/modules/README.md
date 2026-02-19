# OpenTofu Modules

Reusable infrastructure modules for the SRE platform. Each module is provider-aware but designed to be composed by environment configurations.

## Modules

| Module | Purpose |
|--------|---------|
| `compute/` | VM instances for RKE2 server and agent nodes |
| `network/` | VPC/VNet with public and private subnets, NAT, flow logs |
| `dns/` | DNS zones and records for cluster and application endpoints |
| `load-balancer/` | Network load balancer for K8s API (6443) and Istio ingress (443) |
| `storage/` | S3-compatible object storage for state, backups, logs, and registry |

## Module Requirements

Every module must contain:

- `main.tf` — Resource definitions
- `variables.tf` — Input variables with types, descriptions, and validation blocks
- `outputs.tf` — All outputs with descriptions
- `README.md` — Purpose, usage example, and required providers
