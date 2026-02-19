# Platform Services

Flux CD GitOps manifests for all platform services deployed on the RKE2 cluster. This is Layer 2 of the SRE architecture — everything here is reconciled automatically by Flux from this Git repository.

## Structure

```
platform/
├── flux-system/      # Flux toolkit components and root sync configuration
├── core/             # Required platform services (installed on every cluster)
│   ├── istio/        # Service mesh with mTLS
│   ├── kyverno/      # Policy enforcement engine
│   ├── monitoring/   # Prometheus + Grafana + AlertManager
│   ├── logging/      # Loki + Alloy log collection
│   ├── runtime-security/ # NeuVector runtime protection
│   ├── cert-manager/ # TLS certificate automation
│   ├── openbao/      # Secrets management (OpenBao + External Secrets Operator)
│   └── backup/       # Velero backup and disaster recovery
└── addons/           # Optional services (enabled per-deployment)
    ├── argocd/       # ArgoCD for app teams who prefer its UI
    ├── backstage/    # Developer portal
    ├── harbor/       # Container registry with Trivy scanning
    └── keycloak/     # SSO/OIDC identity provider
```

## Reconciliation Order

Flux deploys components in dependency order via `dependsOn`:

```
istio → cert-manager → kyverno → monitoring → logging → openbao → harbor → neuvector → keycloak → tempo → velero
```

## Each Component Contains

- `namespace.yaml` — Namespace with `istio-injection: enabled`
- `helmrepository.yaml` — Upstream Helm chart source
- `helmrelease.yaml` — Flux HelmRelease with pinned version, health checks, remediation
- `kustomization.yaml` — Flux Kustomization for orchestration
- `network-policies/` — Default deny + explicit allows
- `README.md` — Configuration and troubleshooting docs

See [adding a platform component](../docs/agent-docs/adding-platform-component.md) for the full pattern.
