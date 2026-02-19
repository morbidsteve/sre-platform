# App Templates

Standardized Helm charts that bake in all SRE compliance requirements. Developers use these to deploy applications without needing to know the platform's security details.

## Available Templates

| Template | Use Case |
|----------|----------|
| `web-app/` | HTTP services exposed via Istio ingress |
| `api-service/` | Internal APIs with mTLS and AuthorizationPolicy |
| `worker/` | Background processors with no ingress |

## What Every Template Includes

- Hardened security context (non-root, read-only rootfs, drop ALL capabilities)
- HPA for autoscaling
- PodDisruptionBudget
- NetworkPolicy (default deny + explicit allows)
- ServiceMonitor for Prometheus
- ExternalSecret support for OpenBao integration

## Requirements

Every chart must have:
- `values.schema.json` — Enforces Harbor registry and blocks `:latest` tags
- `NOTES.txt` — Post-install instructions
- `tests/` — Helm chart tests

See [Helm conventions](../../docs/agent-docs/helm-conventions.md) for full details.
