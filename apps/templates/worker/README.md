# sre-worker Helm Chart

Standard Helm chart for deploying background worker processes on the SRE platform. No ingress — egress only to required services. Optional CronJob support.

## Resources Created

- Deployment (or CronJob if scheduled) with hardened security context
- HorizontalPodAutoscaler (Deployment mode only)
- PodDisruptionBudget (Deployment mode only)
- NetworkPolicy (no ingress, egress to specified services only)
- ServiceMonitor for Prometheus scraping
- ExternalSecret for OpenBao secret sync (if configured)

## Usage

```yaml
# values.yaml
app:
  name: my-worker
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/my-worker
    tag: "v1.3.0"
  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits: { cpu: "1", memory: 1Gi }
```
