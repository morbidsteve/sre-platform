# Flux System

Flux CD toolkit components and root synchronization configuration. This directory is managed by `flux bootstrap` and contains the GitOps engine that drives all platform deployments.

## Contents

- `gotk-components.yaml` — Flux toolkit controllers (source, kustomize, helm, notification)
- `gotk-sync.yaml` — Root GitRepository and Kustomization pointing to `platform/`
- `kustomization.yaml` — Kustomize resource list for this directory

## Bootstrap

```bash
# Automated bootstrap (preferred)
task bootstrap-flux REPO_URL=https://github.com/org/sre-platform

# Manual bootstrap
flux bootstrap git \
  --url=https://github.com/org/sre-platform \
  --branch=main \
  --path=platform/flux-system \
  --version=v2.2.3
```

## How It Works

1. `flux bootstrap` installs Flux controllers into the cluster
2. Flux watches the Git repo defined in `gotk-sync.yaml`
3. The root Kustomization reconciles `platform/` which includes `core/` and `addons/`
4. Each core component has a Flux Kustomization with `dependsOn` for ordering
5. Changes pushed to Git are automatically reconciled within 10 minutes

## Dependency Chain

```
istio → cert-manager → kyverno → monitoring → logging
                                      ↓           ↓
                                   openbao → external-secrets
                                      ↓
                               runtime-security
                                      ↓
                                    backup
```

See [Flux patterns](../../docs/agent-docs/flux-patterns.md) for conventions.
