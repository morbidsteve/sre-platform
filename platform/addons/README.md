# Platform Addons

Optional services that can be enabled per-deployment based on customer requirements.

## Addons

| Addon | Purpose |
|-------|---------|
| `argocd/` | GitOps UI for app teams who prefer ArgoCD over Flux CLI |
| `backstage/` | Developer portal with software catalog and templates |
| `harbor/` | Container registry with Trivy scanning and Cosign verification |
| `keycloak/` | SSO/OIDC identity provider for all platform UIs |

## Enabling Addons

Add the addon's Flux Kustomization to `platform/addons/kustomization.yaml` to enable it. Each addon follows the same manifest structure as core components.
