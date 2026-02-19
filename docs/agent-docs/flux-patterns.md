# Flux CD Patterns for SRE

This doc covers how Flux CD is used in the SRE platform. Read this before creating or modifying anything in `platform/`.

## Core Concepts

SRE uses Flux CD v2 as the sole GitOps engine for platform services. Flux watches the Git repo and reconciles the cluster state to match.

The reconciliation hierarchy is:

```
GitRepository (sre-platform)
  └── Kustomization (sre-core)
        ├── Kustomization (sre-istio)
        ├── Kustomization (sre-cert-manager)
        ├── Kustomization (sre-kyverno)
        ├── Kustomization (sre-monitoring)
        ├── Kustomization (sre-logging)
        ├── Kustomization (sre-openbao)
        ├── Kustomization (sre-harbor)
        ├── Kustomization (sre-neuvector)
        └── ...
```

Each component has its own Flux Kustomization that points to a directory under `platform/core/<component>/`.

## HelmRelease Conventions

### Required fields — never omit these

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: <component>
  namespace: <component-namespace>
spec:
  interval: 10m                          # How often Flux checks for drift
  chart:
    spec:
      chart: <chart-name>
      version: "1.2.3"                   # ALWAYS pin exact version
      sourceRef:
        kind: HelmRepository
        name: <repo-name>
  install:
    createNamespace: false               # We create namespaces explicitly
    remediation:
      retries: 3
  upgrade:
    cleanupOnFail: true
    remediation:
      retries: 3
  values:
    # Inline values
```

### Dependency ordering with dependsOn

Use `dependsOn` to enforce install order. Common dependencies:

```yaml
spec:
  dependsOn:
    - name: istio                        # Most things depend on Istio
      namespace: istio-system
    - name: monitoring                   # If component needs ServiceMonitors
      namespace: monitoring
```

Dependency chain for the full platform:

```
istio → cert-manager → kyverno → monitoring → logging → openbao → harbor → neuvector → keycloak → tempo → velero
```

### Values management

- Use inline `values:` for non-sensitive config
- Use `valuesFrom:` with ConfigMaps for environment-specific overrides
- Use `valuesFrom:` with Secrets (created by ESO from OpenBao) for credentials
- NEVER put secrets in inline values

```yaml
spec:
  values:
    replicaCount: 3
    istio:
      enabled: true
  valuesFrom:
    - kind: Secret
      name: <component>-credentials
      optional: false
    - kind: ConfigMap
      name: <component>-env-values
      optional: true
```

## Flux Kustomization vs Kustomize kustomization.yaml

These are DIFFERENT things. Do not confuse them.

| | Flux Kustomization | Kustomize kustomization.yaml |
|---|---|---|
| API | `kustomize.toolkit.fluxcd.io/v1` | N/A (file-based) |
| Purpose | Tells Flux what to reconcile | Tells Kustomize how to overlay resources |
| Location | Can be anywhere, usually `platform/flux-system/` | Must be in the directory it manages |
| Has `sourceRef` | Yes | No |
| Has `dependsOn` | Yes | No |

In SRE, we use **Flux Kustomizations** for orchestration and ordering. We MAY also have a `kustomization.yaml` file in each component directory to list the resources Kustomize should include.

## Health Checks

Always add health checks so Flux knows when a component is actually ready:

```yaml
spec:
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: <deployment-name>
      namespace: <namespace>
```

For Helm charts that create multiple deployments, list them all.

## Suspend and Resume

To pause reconciliation during debugging:

```bash
flux suspend helmrelease <name> -n <namespace>
flux resume helmrelease <name> -n <namespace>
```

## Troubleshooting

```bash
flux get helmreleases -A                   # Status of all HelmReleases
flux get kustomizations -A                 # Status of all Kustomizations
flux logs --kind=HelmRelease --name=<name> # Logs for a specific release
flux reconcile helmrelease <name> -n <ns>  # Force immediate reconciliation
```

## Common Mistakes

- Using `spec.chart.spec.version: "*"` — always pin exact versions
- Forgetting `spec.targetNamespace` when the chart doesn't set namespace internally
- Confusing Flux Kustomization CRD with Kustomize kustomization.yaml file
- Missing `dependsOn` causing race conditions during initial deployment
- Using `install.createNamespace: true` — we manage namespaces explicitly for policy control
- Putting secrets in inline `values:` instead of `valuesFrom:` with a Secret
