# sre-worker Helm Chart

Standard Helm chart for deploying background worker processes on the SRE platform.

## Resources Created

- Deployment with hardened security context (non-root, read-only rootfs, drop ALL)
- ServiceAccount (dedicated, no token auto-mount)
- HorizontalPodAutoscaler (optional, disabled by default)
- PodDisruptionBudget
- NetworkPolicy (egress only: DNS, same namespace, HTTPS)
- Headless Service + ServiceMonitor for Prometheus metrics scraping
- ExternalSecret for OpenBao secret sync (if configured)

Workers have **no ingress** — no Service, no VirtualService. They process work from queues, databases, or other event sources.

## Quick Start

```yaml
# my-worker-values.yaml
app:
  name: order-processor
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/order-processor
    tag: "v1.0.0"
  command: ["/app/worker"]
  args: ["--queue", "orders"]
  env:
    - name: QUEUE_URL
      secretRef: order-queue-url
```

```bash
helm install order-processor apps/templates/worker/ -f my-worker-values.yaml -n team-alpha
```

## Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.name` | Application name (required) | `""` |
| `app.team` | Owning team (required) | `""` |
| `app.image.repository` | Image from harbor.sre.internal (required) | `""` |
| `app.image.tag` | Pinned image tag (required, not "latest") | `""` |
| `app.replicas` | Replica count (when HPA disabled) | `2` |
| `app.resources.requests.cpu` | CPU request | `100m` |
| `app.resources.requests.memory` | Memory request | `128Mi` |
| `app.resources.limits.cpu` | CPU limit | `500m` |
| `app.resources.limits.memory` | Memory limit | `512Mi` |
| `app.command` | Container command override | `[]` |
| `app.args` | Container command arguments | `[]` |
| `app.env` | Environment variables list | `[]` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `serviceMonitor.enabled` | Enable Prometheus scraping | `true` |
| `serviceMonitor.port` | Metrics port | `9090` |
| `serviceMonitor.path` | Metrics endpoint path | `/metrics` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |
| `podDisruptionBudget.enabled` | Enable PDB | `true` |

## Probes

Workers use exec probes by default (checking process existence) since they typically don't expose HTTP endpoints. Customize the probe commands in values:

```yaml
app:
  probes:
    liveness:
      exec:
        command: ["/app/healthcheck"]
      initialDelaySeconds: 15
      periodSeconds: 30
```

## Security Features

- Pod runs as non-root with read-only root filesystem
- All Linux capabilities dropped
- Privilege escalation disabled
- Seccomp profile set to RuntimeDefault
- ServiceAccount token not auto-mounted
- NetworkPolicy blocks all ingress (except metrics scraping)
- Egress limited to DNS, same namespace, and HTTPS
