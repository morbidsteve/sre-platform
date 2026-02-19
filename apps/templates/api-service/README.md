# sre-api-service Helm Chart

Standard Helm chart for deploying internal API services on the SRE platform. Unlike `sre-web-app`, this chart is designed for service-to-service communication within the Istio mesh. It includes an Istio AuthorizationPolicy to restrict which namespaces and service accounts can call the API, enforcing mTLS peer authentication via the mesh.

## Resources Created

- Deployment with hardened security context (non-root, read-only rootfs, drop ALL capabilities, seccomp RuntimeDefault)
- Service (ClusterIP, internal only)
- ServiceAccount (dedicated, no token auto-mount)
- Istio AuthorizationPolicy restricting callers by namespace and service account (optional)
- HorizontalPodAutoscaler (configurable)
- PodDisruptionBudget
- NetworkPolicy (default deny + explicit allows for authorized callers, monitoring, DNS)
- ServiceMonitor for Prometheus scraping
- ExternalSecret for OpenBao secret sync (if configured)

## Quick Start

```yaml
# my-api-values.yaml
app:
  name: user-api
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/user-api
    tag: "v2.1.0"
  port: 8080
  replicas: 2

authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha
    - namespace: team-beta
```

```bash
helm install user-api apps/templates/api-service/ -f my-api-values.yaml -n team-alpha
```

## Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.name` | Application name (required) | `""` |
| `app.team` | Owning team (required) | `""` |
| `app.image.repository` | Image from harbor.sre.internal (required) | `""` |
| `app.image.tag` | Pinned image tag (required, not "latest") | `""` |
| `app.image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `app.port` | Container port | `8080` |
| `app.replicas` | Replica count (when HPA disabled) | `2` |
| `app.resources.requests.cpu` | CPU request | `100m` |
| `app.resources.requests.memory` | Memory request | `128Mi` |
| `app.resources.limits.cpu` | CPU limit | `500m` |
| `app.resources.limits.memory` | Memory limit | `512Mi` |
| `app.env` | Environment variables list | `[]` |
| `app.probes.liveness.path` | Liveness probe path | `/healthz` |
| `app.probes.liveness.initialDelaySeconds` | Liveness probe initial delay | `10` |
| `app.probes.liveness.periodSeconds` | Liveness probe period | `10` |
| `app.probes.readiness.path` | Readiness probe path | `/readyz` |
| `app.probes.readiness.initialDelaySeconds` | Readiness probe initial delay | `5` |
| `app.probes.readiness.periodSeconds` | Readiness probe period | `5` |
| `authorizationPolicy.enabled` | Enable Istio AuthorizationPolicy | `true` |
| `authorizationPolicy.allowedNamespaces` | Namespaces allowed to call this API | `[]` |
| `authorizationPolicy.allowedCallers` | Fine-grained caller restrictions (namespace + service accounts) | `[]` |
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `autoscaling.targetCPUUtilization` | CPU target percentage | `80` |
| `serviceAccount.create` | Create a dedicated ServiceAccount | `true` |
| `serviceMonitor.enabled` | Enable Prometheus scraping | `true` |
| `serviceMonitor.interval` | Scrape interval | `30s` |
| `serviceMonitor.path` | Metrics endpoint path | `/metrics` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |
| `networkPolicy.additionalIngress` | Additional ingress rules | `[]` |
| `networkPolicy.additionalEgress` | Additional egress rules | `[]` |
| `podDisruptionBudget.enabled` | Enable PDB | `true` |
| `podDisruptionBudget.minAvailable` | Minimum available pods | `1` |

## Authorization Policy

The Istio AuthorizationPolicy controls which services can call this API. When enabled (the default), traffic is restricted to:

1. Services within the **same namespace** (always allowed)
2. **Prometheus** from the monitoring namespace (always allowed for metrics scraping)
3. Services from namespaces listed in `authorizationPolicy.allowedNamespaces`
4. Specific service accounts from namespaces listed in `authorizationPolicy.allowedCallers`

### Namespace-level access

Allow all services from specific namespaces:

```yaml
authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha
    - namespace: team-beta
```

### Fine-grained access

Allow only specific service accounts from specific namespaces:

```yaml
authorizationPolicy:
  enabled: true
  allowedCallers:
    - namespace: team-alpha
      serviceAccounts:
        - frontend-sa
        - gateway-sa
    - namespace: team-beta
      serviceAccounts:
        - data-processor-sa
```

### Mixed access

Combine both approaches:

```yaml
authorizationPolicy:
  enabled: true
  allowedNamespaces:
    - namespace: team-alpha
  allowedCallers:
    - namespace: team-beta
      serviceAccounts:
        - specific-service-sa
```

## Secrets from OpenBao

To use secrets from OpenBao via External Secrets Operator, add entries to `app.env` with a `secretRef`:

```yaml
app:
  env:
    - name: DATABASE_URL
      secretRef: my-db-url
    - name: API_KEY
      secretRef: my-api-key
```

This creates ExternalSecret resources that sync from `sre/<team>/<secretRef>` in OpenBao.

## Security Features

- Pod runs as non-root with read-only root filesystem
- All Linux capabilities dropped
- Privilege escalation disabled
- Seccomp profile set to RuntimeDefault
- ServiceAccount token not auto-mounted
- Istio AuthorizationPolicy restricts callers to explicitly allowed namespaces/service accounts
- NetworkPolicy restricts traffic to authorized callers, monitoring, and DNS only
- All traffic encrypted via Istio mTLS (STRICT mode cluster-wide)

## Differences from sre-web-app

| Feature | sre-web-app | sre-api-service |
|---------|-------------|-----------------|
| External ingress | Istio VirtualService (optional) | None (internal only) |
| Authorization | None (relies on gateway) | Istio AuthorizationPolicy |
| Network access | From Istio gateway + monitoring | From allowed namespaces + monitoring |
| Use case | HTTP-facing web UIs | Internal service-to-service APIs |

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=<app-name> -n <namespace>

# View logs
kubectl logs -l app.kubernetes.io/name=<app-name> -n <namespace> -f

# Check HPA status
kubectl get hpa -n <namespace>

# Check AuthorizationPolicy
kubectl get authorizationpolicy -n <namespace>

# Debug Istio authorization (check envoy logs)
kubectl logs <pod-name> -c istio-proxy -n <namespace> | grep "rbac"

# Run Helm test
helm test <release-name> -n <namespace>
```
