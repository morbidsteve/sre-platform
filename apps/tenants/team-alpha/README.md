# team-alpha Tenant Namespace

This directory contains the Kubernetes resource definitions for the **team-alpha** tenant namespace on the SRE platform.

## What Gets Created

| Resource | File | Description |
|----------|------|-------------|
| Namespace | `namespace.yaml` | The `team-alpha` namespace with Istio sidecar injection enabled and standard SRE labels |
| RBAC RoleBindings | `rbac.yaml` | Kubernetes RBAC bindings mapped to Keycloak groups |
| ResourceQuota | `resource-quota.yaml` | CPU, memory, pod, service, and PVC limits for the namespace |
| LimitRange | `limit-range.yaml` | Default and max container resource limits |
| NetworkPolicy (deny) | `network-policies/default-deny.yaml` | Default deny-all ingress and egress |
| NetworkPolicy (allow) | `network-policies/allow-base.yaml` | Explicit allows for DNS, monitoring, Istio gateway, same-namespace, and HTTPS egress |

## RBAC Groups

Access to this namespace is controlled via Keycloak group membership:

| Keycloak Group | ClusterRole | Permissions |
|----------------|-------------|-------------|
| `team-alpha-developers` | `edit` | Create, update, and delete most resources in the namespace (Deployments, Services, ConfigMaps, Secrets, etc.) |
| `team-alpha-viewers` | `view` | Read-only access to all resources in the namespace |

To request access, ask your team lead to add you to the appropriate Keycloak group.

## Resource Quotas

The namespace enforces the following resource limits:

| Resource | Limit |
|----------|-------|
| CPU requests | 4 cores |
| Memory requests | 8Gi |
| CPU limits | 8 cores |
| Memory limits | 16Gi |
| Pods | 20 |
| Services | 10 |
| PersistentVolumeClaims | 10 |

If your team needs higher limits, submit a request to the platform team with justification.

## Default Container Limits

Containers that do not specify resource requests/limits will receive these defaults:

| Setting | CPU | Memory |
|---------|-----|--------|
| Default request | 100m | 128Mi |
| Default limit | 500m | 512Mi |
| Maximum allowed | 2 cores | 4Gi |
| Minimum allowed | 50m | 64Mi |

## Network Policies

The namespace starts with a **default deny-all** policy. The following traffic is explicitly allowed:

- **DNS** -- Egress to kube-system on port 53 (UDP/TCP) for name resolution
- **Monitoring** -- Ingress from the monitoring namespace for Prometheus metric scraping
- **Istio Gateway** -- Ingress from istio-system gateway pods for external traffic routing
- **Same Namespace** -- Ingress and egress between pods within team-alpha
- **HTTPS Egress** -- Egress to any destination on port 443 for external API calls

If your application needs additional network access (e.g., a database in another namespace or a non-HTTPS external service), add a custom NetworkPolicy in your app directory.

## Deploying an Application

1. Choose the appropriate SRE Helm chart template:
   - `sre-web-app` -- For HTTP services with external ingress
   - `sre-worker` -- For background processors with no ingress
   - `sre-cronjob` -- For scheduled jobs

2. Create a directory under `apps/<app-name>/` with a `values.yaml`:

   ```yaml
   app:
     name: my-service
     team: team-alpha
     image:
       repository: harbor.sre.internal/team-alpha/my-service
       tag: "v1.0.0"
     port: 8080
     replicas: 2
     resources:
       requests:
         cpu: 100m
         memory: 128Mi
       limits:
         cpu: 500m
         memory: 512Mi
     probes:
       liveness:
         path: /healthz
       readiness:
         path: /readyz

   ingress:
     enabled: true
     host: my-service.apps.sre.example.com
   ```

3. Create a Flux HelmRelease in the same directory to deploy it:

   ```yaml
   apiVersion: helm.toolkit.fluxcd.io/v2
   kind: HelmRelease
   metadata:
     name: my-service
     namespace: team-alpha
   spec:
     interval: 10m
     chart:
       spec:
         chart: sre-web-app
         version: "0.1.0"
         sourceRef:
           kind: HelmRepository
           name: sre-charts
           namespace: flux-system
     values:
       # Reference your values.yaml content here
   ```

4. Commit and push. Flux will automatically reconcile and deploy your application.

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
