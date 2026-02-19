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

Use the `/new-tenant` command to scaffold a new tenant:

```
/new-tenant <team-name>
```

This creates the full directory structure with sensible defaults.
