# team-alpha Tenant Namespace

This directory contains the Kustomize overlay for the **team-alpha** tenant namespace on the SRE platform. The base configuration is inherited from `../_base/` and patched with the team-alpha name.

## What Gets Created

| Resource | Source | Description |
|----------|--------|-------------|
| Namespace | base | The `team-alpha` namespace with Istio sidecar injection enabled and standard SRE labels |
| RBAC RoleBindings | base | Kubernetes RBAC bindings mapped to Keycloak groups |
| ResourceQuota | base | CPU, memory, pod, service, and PVC limits for the namespace |
| LimitRange | base | Default and max container resource limits |
| NetworkPolicies | base | Default deny-all + explicit allows for DNS, monitoring, Istio gateway, same-namespace, and HTTPS egress |

## RBAC Groups

Access to this namespace is controlled via Keycloak group membership:

| Keycloak Group | ClusterRole | Permissions |
|----------------|-------------|-------------|
| `team-alpha-developers` | `edit` | Create, update, and delete most resources in the namespace (Deployments, Services, ConfigMaps, Secrets, etc.) |
| `team-alpha-viewers` | `view` | Read-only access to all resources in the namespace |

To request access, ask your team lead to add you to the appropriate Keycloak group.

## Deploying an Application

1. Choose the appropriate SRE Helm chart template:
   - `sre-web-app` -- For HTTP services with external ingress
   - `sre-worker` -- For background processors with no ingress
   - `sre-cronjob` -- For scheduled jobs

2. Create a HelmRelease YAML file under `apps/` and add it to `apps/kustomization.yaml`

3. Commit and push. Flux will automatically reconcile and deploy your application.

## Checking Resource Usage

```bash
# View pod resource consumption
kubectl top pods -n team-alpha

# View namespace quota usage
kubectl describe quota team-alpha-quota -n team-alpha

# View limit range details
kubectl describe limitrange team-alpha-limits -n team-alpha

# Check network policies
kubectl get networkpolicy -n team-alpha

# View Kyverno policy reports for violations
kubectl get policyreport -n team-alpha
```

## Troubleshooting

- **Pod stuck in Pending** -- Check if you have exceeded the ResourceQuota with `kubectl describe quota -n team-alpha`
- **Pod rejected by admission** -- Check Kyverno policy reports for violations. Common issues: missing labels, using a disallowed image registry, or missing security context
- **Network connectivity issues** -- Verify the default-deny and allow policies are applied. Add custom NetworkPolicies if your app needs access beyond the defaults
- **Istio sidecar not injected** -- Verify the namespace has the `istio-injection: enabled` label
