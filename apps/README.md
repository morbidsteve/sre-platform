# Applications

Layer 3 of the SRE platform — developer-facing application deployment via GitOps.

## Structure

```
apps/
├── dashboard/        # SRE Dashboard (React 18 + Express) — cluster management UI
├── portal/           # SRE Portal (React + Vite) — developer landing page
├── dsop-wizard/      # DSOP Wizard (React + Vite) — guided RAISE 2.0 pipeline
├── demo-app/         # Go example workload for testing
├── templates/        # Standardized Helm chart templates
│   ├── web-app/      # For HTTP-facing services (Deployment + Service + VirtualService)
│   ├── api-service/  # For internal APIs (adds Istio AuthorizationPolicy)
│   ├── worker/       # For background processors (no ingress, CronJob support)
│   └── cronjob/      # For scheduled jobs
└── tenants/          # Per-team deployment configurations
    ├── _base/        # Shared tenant resources (namespace, RBAC, network policies)
    ├── team-alpha/   # Example tenant with deployed apps
    ├── team-beta/    # Example tenant
    └── team-keystone/# Example tenant
```

## How to Deploy an App

### Option 1: Interactive script (easiest)

```bash
./scripts/sre-deploy-app.sh
```

### Option 2: Deploy from Git repository

```bash
./scripts/deploy-from-git.sh --repo https://github.com/org/app --team my-team
```

### Option 3: GitOps (commit to repo)

1. Pick a template from `apps/templates/` that matches your workload type
2. Create a HelmRelease YAML under `apps/tenants/<team>/apps/`
3. Commit and push — Flux auto-deploys

### Option 4: Dashboard UI

Use the Deploy tab in the SRE Dashboard at `https://dashboard.apps.sre.example.com`.

See [Developer Guide](../docs/developer-guide.md) and [Helm chart conventions](../docs/agent-docs/helm-conventions.md) for details.
