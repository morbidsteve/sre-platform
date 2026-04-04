# Tenants

Per-team application deployment configurations. Each subdirectory represents a tenant team with their own namespace, RBAC, quotas, and application deployments.

## Structure

```
tenants/
└── <team-name>/
    ├── namespace.yaml        # Namespace with Istio injection + labels
    ├── rbac.yaml             # RoleBindings mapped to Keycloak groups
    ├── resource-quota.yaml   # CPU/memory/pod limits for the namespace
    ├── limit-range.yaml      # Default container resource limits
    ├── network-policy.yaml   # Default deny + DNS + monitoring allows
    └── apps/                 # Application HelmReleases or Kustomizations
        └── <app-name>/
            └── values.yaml   # App-specific values referencing a template chart
```

## Onboarding a New Team

```bash
# Full onboarding: namespace, RBAC, network policies, Harbor project, Keycloak groups
./scripts/onboard-tenant.sh my-team

# Quick namespace creation only
./scripts/sre-new-tenant.sh my-team
```

The onboarding script creates the full directory structure, applies it to the cluster, and configures Harbor and Keycloak integration. See [Team Onboarding Guide](../../docs/developer-guides/team-onboarding.md).
