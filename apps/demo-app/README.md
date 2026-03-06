# SRE Demo App

A Go HTTP service that demonstrates full SRE platform integration: Prometheus metrics, health probes, structured logging, and security-hardened container deployment.

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | HTML dashboard showing hostname, namespace, version, uptime, and request count |
| `GET /healthz` | Liveness probe (always returns 200 OK) |
| `GET /readyz` | Readiness probe (returns 503 during 3s startup grace period, then 200 OK) |
| `GET /metrics` | Prometheus metrics endpoint |

## Prometheus Metrics

- `http_requests_total` — Counter with labels: `method`, `path`, `status`
- `http_request_duration_seconds` — Histogram with labels: `method`, `path`
- Standard Go runtime metrics (goroutines, memory, GC)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_NAME` | `demo-app` | Application name shown on the HTML page |
| `APP_VERSION` | `0.1.0` | Application version shown on the HTML page |
| `POD_NAMESPACE` | (auto-detected) | Kubernetes namespace, read from downward API or service account |

## Build Locally

```bash
# Build the binary
cd apps/demo-app
go build -o demo-app .

# Run
./demo-app
# Open http://localhost:8080
```

## Build Container Image

```bash
cd apps/demo-app
docker build -t sre-demo:v0.1.0 .
docker run -p 8080:8080 sre-demo:v0.1.0
```

The image is built from `scratch` (no OS layer), runs as UID 1000, and the binary is statically linked with no CGO dependencies.

## Deploy to SRE Platform

The app is deployed via Flux CD using the `sre-web-app` Helm chart template.

### Option 1: Use the existing HelmRelease

The file at `apps/demo-app/k8s/helmrelease.yaml` contains a ready-to-use Flux HelmRelease. Copy it to the tenant directory:

```bash
cp apps/demo-app/k8s/helmrelease.yaml apps/tenants/team-alpha/apps/sre-demo.yaml
```

Add the file to the tenant kustomization, commit, and push. Flux will reconcile automatically.

### Option 2: Build and push to Harbor first

For a full supply chain workflow:

```bash
# Build and push
docker build -t harbor.sre.internal/team-alpha/sre-demo:v0.1.0 apps/demo-app/
docker push harbor.sre.internal/team-alpha/sre-demo:v0.1.0

# Update the HelmRelease image repository
# Then commit and push to Git
```

## Platform Integration

This demo app is designed to exercise the following platform features:

- **Monitoring**: ServiceMonitor scrapes `/metrics` into Prometheus; request rate and latency dashboards in Grafana
- **Health Probes**: Kubernetes uses `/healthz` and `/readyz` for pod lifecycle management
- **Tracing**: Istio sidecar captures distributed traces and sends them to Tempo
- **Security Context**: Runs as non-root (UID 1000), read-only root filesystem, no capabilities
- **Network Policy**: Default deny with explicit allows for Istio gateway and monitoring
- **mTLS**: Istio sidecar provides automatic mTLS for all traffic

## Security

The container image follows SRE platform security requirements:

- Built from `scratch` (zero OS packages, zero CVEs from base image)
- Runs as non-root user (UID 1000)
- Statically compiled binary (no shared libraries)
- Read-only root filesystem compatible
- No capabilities required
