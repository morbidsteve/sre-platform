# OpenTofu Environments

Per-environment compositions that call the reusable modules with environment-specific values.

## Environments

| Environment | Purpose |
|-------------|---------|
| `dev/` | Development and testing. Minimal node counts, relaxed policies. |
| `staging/` | Pre-production validation. Mirrors production topology at smaller scale. |
| `production/` | Production deployment. HA node counts, strict policies, encrypted state. |

## Each Environment Contains

- `main.tf` — Module calls with environment-specific arguments
- `variables.tf` — Input variable declarations
- `terraform.tfvars` — Variable values for this environment (no secrets)
- `backend.tf` — Remote state backend configuration
- `versions.tf` — Provider and OpenTofu version pins
