# team-beta Tenant Namespace

This directory contains the Kubernetes resource definitions for the **team-beta** tenant namespace on the SRE platform.

## What Gets Created

| Resource | File | Description |
|----------|------|-------------|
| Namespace | `namespace.yaml` | The `team-beta` namespace with Istio sidecar injection enabled and standard SRE labels |
| RBAC RoleBindings | `rbac.yaml` | Maps Keycloak groups to Kubernetes RBAC roles within the namespace |
| ResourceQuota | `resource-quota.yaml` | Enforces CPU, memory, pod count, service, and PVC limits for the namespace |
| LimitRange | `limit-range.yaml` | Sets default and max/min container resource requests and limits |
| NetworkPolicies | `network-policies/` | Default-deny baseline with explicit allows for DNS, monitoring, Istio, same-namespace, and HTTPS egress |

## RBAC Groups

Access to this namespace is controlled through Keycloak groups mapped to Kubernetes ClusterRoles:

| Keycloak Group | ClusterRole | Permissions |
|----------------|-------------|-------------|
| `team-beta-developers` | `edit` | Create, update, and delete most resources in the namespace (Deployments, Services, ConfigMaps, Secrets, etc.) |
| `team-beta-viewers` | `view` | Read-only access to all resources in the namespace |

To request access, ask your team lead to add your Keycloak account to the appropriate group.

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

## Default Container Limits

If a container does not specify resource requests or limits, the LimitRange applies these defaults:

| Setting | CPU | Memory |
|---------|-----|--------|
| Default request | 100m | 128Mi |
| Default limit | 500m | 512Mi |
| Maximum | 2 cores | 4Gi |
| Minimum | 50m | 64Mi |

## Network Policies

The namespace uses a default-deny-all policy with the following explicit allows:

- **DNS**: Egress to kube-system on port 53 (UDP/TCP) for name resolution
- **Monitoring**: Ingress from the monitoring namespace for Prometheus scraping
- **Istio Gateway**: Ingress from istio-system gateway pods for external traffic
- **Same Namespace**: Ingress and egress between pods within team-beta
- **HTTPS Egress**: Egress to any destination on port 443 for external API calls

## Deploying an Application

To deploy an application to this namespace, create a values file under the `apps/` subdirectory referencing one of the SRE standard Helm chart templates.

### 1. Choose a chart template

- `sre-web-app` -- For HTTP services with external ingress
- `sre-worker` -- For background processors with no ingress
- `sre-cronjob` -- For scheduled jobs

### 2. Create a values file

Create `apps/<app-name>/values.yaml` with your application configuration:

```yaml
app:
  name: my-service
  team: team-beta
  image:
    repository: harbor.sre.internal/team-beta/my-service
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

ingress:
  enabled: true
  host: my-service.apps.sre.example.com
```

### 3. Create a Flux HelmRelease

Create `apps/<app-name>/helmrelease.yaml` to deploy via Flux:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-service
  namespace: team-beta
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
    # Inline values or use valuesFrom
  valuesFrom:
    - kind: ConfigMap
      name: my-service-values
```

### 4. Commit and push

Flux will automatically detect the changes and deploy your application.

## Checking Resource Usage

Monitor your namespace resource consumption with these commands:

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
