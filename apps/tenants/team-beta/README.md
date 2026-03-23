# team-beta Tenant Namespace

This directory contains the Kustomize overlay for the **team-beta** tenant namespace on the SRE platform. The base configuration is inherited from `../_base/` and patched with the team-beta name.

## What Gets Created

| Resource | Source | Description |
|----------|--------|-------------|
| Namespace | base | The `team-beta` namespace with Istio sidecar injection enabled and standard SRE labels |
| RBAC RoleBindings | base | Maps Keycloak groups to Kubernetes RBAC roles within the namespace |
| ResourceQuota | base | Enforces CPU, memory, pod count, service, and PVC limits for the namespace |
| LimitRange | base | Sets default and max/min container resource requests and limits |
| NetworkPolicies | base | Default-deny baseline with explicit allows for DNS, monitoring, Istio, same-namespace, and HTTPS egress |

## RBAC Groups

Access to this namespace is controlled through Keycloak groups mapped to Kubernetes ClusterRoles:

| Keycloak Group | ClusterRole | Permissions |
|----------------|-------------|-------------|
| `team-beta-developers` | `edit` | Create, update, and delete most resources in the namespace (Deployments, Services, ConfigMaps, Secrets, etc.) |
| `team-beta-viewers` | `view` | Read-only access to all resources in the namespace |

To request access, ask your team lead to add your Keycloak account to the appropriate group.

## Deploying an Application

1. Choose the appropriate SRE Helm chart template:
   - `sre-web-app` -- For HTTP services with external ingress
   - `sre-worker` -- For background processors with no ingress
   - `sre-cronjob` -- For scheduled jobs

2. Create a HelmRelease YAML file under `apps/` and add it to `apps/kustomization.yaml`

3. Commit and push. Flux will automatically reconcile and deploy your application.

## Checking Resource Usage

```bash
# View pod CPU and memory usage
kubectl top pods -n team-beta

# View current quota usage vs limits
kubectl describe quota team-beta-quota -n team-beta

# View limit range configuration
kubectl describe limitrange team-beta-limits -n team-beta

# View all resources in the namespace
kubectl get all -n team-beta

# Check network policies
kubectl get networkpolicies -n team-beta
```

## Troubleshooting

- **Pod stuck in Pending**: Check if you have exceeded the ResourceQuota with `kubectl describe quota -n team-beta`
- **Pod cannot resolve DNS**: Verify the `allow-dns` NetworkPolicy exists with `kubectl get networkpolicy allow-dns -n team-beta`
- **Pod cannot reach external services**: Only HTTPS (port 443) egress is allowed by default. For other ports, request an additional NetworkPolicy
- **403 Forbidden on kubectl commands**: Verify your Keycloak account is in the correct group (`team-beta-developers` or `team-beta-viewers`)
