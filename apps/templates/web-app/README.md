# sre-web-app Helm Chart

Standard Helm chart for deploying HTTP-facing web applications on the SRE platform.

## Resources Created

- Deployment with hardened security context (non-root, read-only rootfs, drop ALL)
- Service (ClusterIP)
- ServiceAccount (dedicated, no token auto-mount)
- Istio VirtualService for external ingress (optional)
- HorizontalPodAutoscaler (configurable)
- PodDisruptionBudget
- NetworkPolicy (default deny + explicit allows for gateway, monitoring, DNS)
- ServiceMonitor for Prometheus scraping
- ExternalSecret for OpenBao secret sync (if configured)

## Quick Start

```yaml
# my-app-values.yaml
app:
  name: my-frontend
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/my-frontend
    tag: "v1.0.0"
  port: 8080
  replicas: 2

ingress:
  enabled: true
  host: my-frontend.apps.sre.example.com
```

```bash
helm install my-frontend apps/templates/web-app/ -f my-app-values.yaml -n team-alpha
```

## Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.name` | Application name (required) | `""` |
| `app.team` | Owning team (required) | `""` |
| `app.image.repository` | Image from harbor.sre.internal (required) | `""` |
| `app.image.tag` | Pinned image tag (required, not "latest") | `""` |
| `app.port` | Container port | `8080` |
| `app.replicas` | Replica count (when HPA disabled) | `2` |
| `app.resources.requests.cpu` | CPU request | `100m` |
| `app.resources.requests.memory` | Memory request | `128Mi` |
| `app.resources.limits.cpu` | CPU limit | `500m` |
| `app.resources.limits.memory` | Memory limit | `512Mi` |
| `app.env` | Environment variables list | `[]` |
| `app.probes.liveness.path` | Liveness probe path | `/healthz` |
| `app.probes.readiness.path` | Readiness probe path | `/readyz` |
| `ingress.enabled` | Enable Istio VirtualService | `false` |
| `ingress.host` | Hostname for ingress | `""` |
| `ingress.gateway` | Istio gateway reference | `istio-system/sre-gateway` |
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `autoscaling.targetCPUUtilization` | CPU target percentage | `80` |
| `serviceMonitor.enabled` | Enable Prometheus scraping | `true` |
| `serviceMonitor.path` | Metrics endpoint path | `/metrics` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |
| `podDisruptionBudget.enabled` | Enable PDB | `true` |
| `podDisruptionBudget.minAvailable` | Minimum available pods | `1` |

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
- NetworkPolicy restricts traffic to Istio gateway, monitoring, and DNS only

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=<app-name> -n <namespace>

# View logs
kubectl logs -l app.kubernetes.io/name=<app-name> -n <namespace> -f

# Check HPA status
kubectl get hpa -n <namespace>

# Run Helm test
helm test <release-name> -n <namespace>
```
