# sre-web-app Helm Chart

Standard Helm chart for deploying HTTP-facing web applications on the SRE platform.

## Resources Created

- Deployment with hardened security context
- Service (ClusterIP)
- Istio VirtualService for external ingress
- HorizontalPodAutoscaler
- PodDisruptionBudget
- NetworkPolicy (allow from Istio gateway + monitoring)
- ServiceMonitor for Prometheus scraping
- ExternalSecret for OpenBao secret sync (if configured)

## Usage

```yaml
# values.yaml
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
