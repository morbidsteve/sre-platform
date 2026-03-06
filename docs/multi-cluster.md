# Multi-Cluster Patterns for SRE Platform

This document describes patterns for managing multiple SRE platform clusters using Flux CD.

## Architecture

```
Management Cluster (hub)
├── Flux watches: sre-platform repo (main branch)
├── Cluster definitions in: clusters/
│   ├── clusters/dev/
│   ├── clusters/staging/
│   └── clusters/production/
└── Each cluster gets its own Flux Kustomization with path + patches

Workload Clusters (spokes)
├── Each bootstrapped with Flux pointing to same repo
├── Environment-specific overrides via Kustomize patches
└── Shared platform services, per-cluster tenant configs
```

## Directory Structure

```
clusters/
├── base/                           # Shared across all clusters
│   └── kustomization.yaml          # Points to platform/core/
├── dev/
│   ├── kustomization.yaml          # Patches for dev (fewer replicas, no persistence)
│   └── patches/
│       └── reduce-resources.yaml
├── staging/
│   ├── kustomization.yaml          # Patches for staging
│   └── patches/
│       └── staging-domain.yaml
└── production/
    ├── kustomization.yaml          # Patches for production (HA, persistence, real TLS)
    └── patches/
        ├── ha-replicas.yaml
        ├── production-domain.yaml
        └── real-tls-issuer.yaml
```

## Flux Multi-Cluster Bootstrap

### Option 1: Single Repo, Multiple Paths

Each cluster's Flux instance points to a different path in the same repo:

```yaml
# On dev cluster
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: flux-system
  namespace: flux-system
spec:
  url: https://github.com/org/sre-platform.git
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: flux-system
  namespace: flux-system
spec:
  path: ./clusters/dev
  sourceRef:
    kind: GitRepository
    name: flux-system
```

### Option 2: Branch-per-Environment

Each cluster's Flux watches a different branch:

```yaml
spec:
  ref:
    branch: env/production  # or env/staging, env/dev
```

### Recommended: Option 1 with Kustomize Overlays

Use a single `main` branch with Kustomize overlays per cluster. This ensures:
- All clusters share the same base configs
- Differences are explicit in overlay patches
- PRs show exactly what changes per environment
- Promotion is a patch change, not a branch merge

## Environment Promotion

```
Developer pushes image tag → CI pipeline runs →
  → Updates apps/tenants/<team>/apps/<app>.yaml in dev overlay
  → PR created for staging promotion
  → After staging validation, PR for production
```

## Cross-Cluster Service Mesh

For services that span clusters, use Istio multi-cluster:

```yaml
# On each cluster, configure Istio for multi-cluster
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  meshConfig:
    defaultConfig:
      meshId: sre-mesh
    trustDomain: cluster.local
  values:
    global:
      meshID: sre-mesh
      multiCluster:
        clusterName: <cluster-name>
      network: <network-name>
```

## Secrets Across Clusters

Each cluster runs its own OpenBao instance. For shared secrets:
1. Use OpenBao replication (Enterprise feature) or
2. Use a central secrets source (e.g., AWS Secrets Manager) with ESO on each cluster
3. Use SOPS/Age encryption in Git (Flux native support)

## Monitoring Across Clusters

Options:
1. **Thanos**: Sidecar on each cluster's Prometheus, central Thanos Query
2. **Grafana Cloud**: Remote write from each cluster
3. **Victoria Metrics**: Cluster-mode with global query layer

For the SRE platform, Thanos is recommended:
```yaml
# Add to each cluster's monitoring HelmRelease
prometheus:
  prometheusSpec:
    thanos:
      objectStorageConfig:
        secretName: thanos-objstore-config
```
