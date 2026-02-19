# Flux System

Flux CD toolkit components and root synchronization configuration. This directory is managed by `flux bootstrap` and contains the GitOps engine that drives all platform deployments.

## Contents

- `gotk-components.yaml` — Flux toolkit controllers (source, kustomize, helm, notification)
- `gotk-sync.yaml` — Root GitRepository and Kustomization pointing to `platform/`

## Bootstrap

```bash
task bootstrap-flux REPO_URL=https://github.com/org/sre-platform
```

See [Flux patterns](../../docs/agent-docs/flux-patterns.md) for conventions.
