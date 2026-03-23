# ArgoCD (Optional Addon)

ArgoCD as an optional GitOps UI for application teams who prefer its visual interface over the Flux CLI.

## Purpose

While Flux CD is the primary GitOps engine for platform services, some app teams prefer ArgoCD's web UI for managing their application deployments. This addon provides ArgoCD scoped to tenant namespaces only -- it does not manage platform-level resources.

## Components

- **Namespace**: `argocd` with Pod Security Standards (restricted) and Istio injection disabled
- **HelmRelease**: Deploys `argo-cd` chart v7.7.11 from the official Argo Helm repository
- **NetworkPolicies**: Default deny-all plus explicit allows for monitoring (port 8083), Istio ingress (port 8080), DNS resolution, and outbound HTTPS/K8s API access

## Configuration

The HelmRelease sets resource requests and limits for all ArgoCD components:

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| Server | 100m | 500m | 256Mi | 512Mi |
| Controller | 250m | 1 | 512Mi | 1Gi |
| Redis | 50m | 200m | 64Mi | 128Mi |
| Repo Server | 100m | 500m | 256Mi | 512Mi |

The global domain is set to `argocd.apps.sre.example.com`. Server ingress is disabled by default -- traffic is expected to route through the Istio gateway.

## Enabling This Addon

This addon is not deployed by default. To enable it, add a Flux Kustomization in `platform/flux-system/` pointing to `platform/addons/argocd/`.

## NIST Controls

- CM-3 (Configuration Change Control) -- Git-based change tracking with approval workflows

## Dependencies

- HelmRepository `argocd` in `flux-system` namespace (defined in `platform/core/sources/helmrepositories.yaml`)
- Istio (for ingress routing)
- Keycloak (for SSO, requires additional OIDC client configuration)

## Troubleshooting

```bash
# Check HelmRelease status
flux get helmrelease argocd -n argocd

# Check pod health
kubectl get pods -n argocd

# View ArgoCD server logs
kubectl logs -n argocd -l app.kubernetes.io/component=server
```
