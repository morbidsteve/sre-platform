# Applications

Layer 3 of the SRE platform — developer-facing application deployment via GitOps.

## Structure

```
apps/
├── templates/        # Standardized Helm chart templates
│   ├── web-app/      # For HTTP-facing services (Deployment + Service + VirtualService)
│   ├── api-service/  # For internal APIs (adds Istio AuthorizationPolicy)
│   └── worker/       # For background processors (no ingress, CronJob support)
└── tenants/          # Per-team deployment configurations
```

## How Developers Deploy

1. Pick a template from `apps/templates/` that matches your workload type
2. Create a directory under `apps/tenants/<team>/`
3. Add a `values.yaml` referencing your image from Harbor
4. Commit and push — Flux auto-deploys

See [Helm chart conventions](../docs/agent-docs/helm-conventions.md) for chart standards.
