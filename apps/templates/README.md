# App Templates

Standardized Helm charts that bake in all SRE compliance requirements. Developers use these to deploy applications without needing to know the platform's security details.

## Available Templates

| Template | Use Case |
|----------|----------|
| `web-app/` | HTTP services exposed via Istio ingress |
| `api-service/` | Internal APIs with mTLS and AuthorizationPolicy |
| `worker/` | Background processors with no ingress |
| `cronjob/` | Scheduled jobs with configurable cron expressions |

## What Every Template Includes

- Hardened security context (non-root, read-only rootfs, drop ALL capabilities)
- NetworkPolicy (default deny + explicit allows)
- ServiceMonitor for Prometheus (where applicable)
- ExternalSecret support for OpenBao integration
- ServiceAccount with no auto-mounted token

## Additional Features by Template

| Feature | web-app | worker | cronjob |
|---------|---------|--------|---------|
| Service | Yes | No | No |
| VirtualService | Yes | No | No |
| HPA | Yes | Yes | No |
| PDB | Yes | Yes | No |
| ServiceMonitor | Yes | Yes | Optional |

## Requirements

Every chart must have:
- `values.schema.json` — Enforces Harbor registry and blocks `:latest` tags
- `NOTES.txt` — Post-install instructions
- `tests/` — Helm chart tests

See [Helm conventions](../../docs/agent-docs/helm-conventions.md) for full details.
