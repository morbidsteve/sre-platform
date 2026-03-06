# Flagger — Progressive Delivery for SRE Platform

## What It Does

Flagger is a progressive delivery operator that automates the release process for applications running on Kubernetes. It reduces the risk of introducing a new software version by gradually shifting traffic to the new version while measuring metrics and running conformance tests.

Flagger supports multiple deployment strategies:

- **Canary** — Gradually shifts traffic from the old version to the new version based on metrics analysis. If metrics degrade, Flagger automatically rolls back.
- **A/B Testing** — Routes traffic based on HTTP headers or cookies, useful for testing features with specific user segments.
- **Blue/Green** — Switches all traffic at once after the new version passes health checks, with instant rollback capability.

## How It Works in SRE

Flagger integrates with **Istio** for traffic management and **Prometheus** for metrics analysis:

1. When a Deployment is updated (new image tag), Flagger detects the change.
2. Flagger creates a canary Deployment and starts routing a small percentage of traffic to it.
3. At each analysis interval, Flagger queries Prometheus for request success rate and latency.
4. If metrics are within thresholds, Flagger increases the traffic weight by `stepWeight`.
5. Once `maxWeight` is reached and metrics remain healthy, Flagger promotes the canary.
6. If metrics degrade beyond the `threshold` number of failed checks, Flagger rolls back.

## Adding a Canary to Your Application

### Using the sre-web-app Helm Chart

The `sre-web-app` chart includes built-in Canary support. Enable it in your values:

```yaml
app:
  name: my-service
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/my-service
    tag: v1.2.3
  port: 8080

ingress:
  enabled: true
  host: my-service.apps.sre.example.com

canary:
  enabled: true
  progressDeadlineSeconds: 600
  analysis:
    interval: "1m"
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    successRate: 99
    latencyMax: 500
```

### Standalone Canary Manifest

If you are not using the sre-web-app chart, create a Canary resource directly:

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: my-service
  namespace: team-alpha
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  progressDeadlineSeconds: 600
  service:
    port: 8080
    targetPort: 8080
    gateways:
      - istio-system/main
    hosts:
      - my-service.apps.sre.example.com
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 1m
      - name: request-duration
        thresholdRange:
          max: 500
        interval: 1m
```

## Metrics Used for Canary Analysis

| Metric | Description | Default Threshold |
|--------|-------------|-------------------|
| `request-success-rate` | Percentage of non-5xx responses | >= 99% |
| `request-duration` | 99th percentile latency in milliseconds | <= 500ms |

These metrics are sourced from Istio telemetry via Prometheus. Flagger uses built-in metric templates for Istio that query `istio_requests_total` and `istio_request_duration_milliseconds_bucket`.

### Custom Metrics

You can define additional metrics using Flagger MetricTemplate resources. For example, to check error rates from application-specific metrics:

```yaml
apiVersion: flagger.app/v1beta1
kind: MetricTemplate
metadata:
  name: error-rate
  namespace: team-alpha
spec:
  provider:
    type: prometheus
    address: http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090
  query: |
    100 - sum(
      rate(http_requests_total{
        namespace="{{ namespace }}",
        pod=~"{{ target }}-[0-9a-zA-Z]+(-[0-9a-zA-Z]+)",
        status!~"5.*"
      }[{{ interval }}])
    ) / sum(
      rate(http_requests_total{
        namespace="{{ namespace }}",
        pod=~"{{ target }}-[0-9a-zA-Z]+(-[0-9a-zA-Z]+)"
      }[{{ interval }}])
    ) * 100
```

## Integration with Istio VirtualService

When Flagger manages a Canary resource, it automatically creates and manages an Istio VirtualService to control traffic splitting between the primary and canary Deployments. You should NOT create your own VirtualService for Canary-managed services -- Flagger will handle it.

Flagger creates these resources automatically:
- `<name>-primary` Deployment (the stable version)
- `<name>-canary` Service (pointing to the canary pods)
- `<name>-primary` Service (pointing to the primary pods)
- An Istio VirtualService with weighted routing

## Rollback Behavior

Flagger rolls back automatically when:
- The canary analysis fails for more consecutive checks than the `threshold` value.
- The `progressDeadlineSeconds` is exceeded without completing the analysis.
- The canary Deployment fails to become ready.

During rollback, Flagger:
1. Routes 100% of traffic back to the primary Deployment.
2. Scales down the canary Deployment.
3. Sets the Canary status to `Failed`.
4. Emits a Kubernetes event and (if configured) sends a notification via Flux alerts.

To manually roll back a canary in progress:

```bash
kubectl annotate canary my-service -n team-alpha "flagger.app/rollback=true"
```

## Troubleshooting

Check canary status:

```bash
kubectl get canaries -A
kubectl describe canary my-service -n team-alpha
```

View Flagger logs:

```bash
kubectl logs -n flagger-system deploy/flagger -f
```

Check Flagger events:

```bash
kubectl get events -n team-alpha --field-selector reason=Synced
```

## Configuration

| Value | Description | Default |
|-------|-------------|---------|
| `canary.enabled` | Enable Flagger Canary resource | `false` |
| `canary.progressDeadlineSeconds` | Max time for canary to complete | `600` |
| `canary.analysis.interval` | How often to run analysis | `1m` |
| `canary.analysis.threshold` | Max failed checks before rollback | `5` |
| `canary.analysis.maxWeight` | Max traffic percentage to canary | `50` |
| `canary.analysis.stepWeight` | Traffic increment per step | `10` |
| `canary.analysis.successRate` | Min request success rate (%) | `99` |
| `canary.analysis.latencyMax` | Max p99 latency (ms) | `500` |
