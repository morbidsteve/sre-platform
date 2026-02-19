# Distributed Tracing — Tempo

Grafana Tempo provides distributed tracing storage and query for the SRE platform, integrated with Istio and the Grafana observability stack.

## What It Does

- **Trace Storage** — Stores distributed traces from Istio sidecars and application instrumentation
- **Zipkin Receiver** — Receives traces from Istio's built-in Zipkin exporter
- **OTLP Receiver** — Accepts OpenTelemetry traces via gRPC (4317) and HTTP (4318)
- **Metrics Generation** — Generates RED metrics (Rate, Errors, Duration) from traces
- **Grafana Integration** — Unified trace, log, and metric correlation in Grafana

## Components

| Resource | Purpose |
|----------|---------|
| `namespace.yaml` | Namespace with Istio sidecar injection |
| `helmrelease.yaml` | Grafana Tempo chart with S3 backend |
| `grafana-datasource.yaml` | ConfigMap for Grafana auto-discovery (in monitoring namespace) |
| `network-policies/default-deny.yaml` | Default deny all ingress/egress |
| `network-policies/allow-tempo.yaml` | Explicit allows for trace ingestion and queries |

## Helm Chart Version

Grafana Tempo chart is pinned to version `1.7.2`.

## Architecture

Tempo runs as a single-binary deployment with persistent local storage for WAL (write-ahead log) and S3-compatible object storage for long-term trace data.

### Trace Flow

```
Application/Istio Sidecar
    |
    v
Tempo (Zipkin :9411 / OTLP gRPC :4317 / OTLP HTTP :4318)
    |
    v
S3-compatible storage (long-term)
    |
    v
Grafana (query via :3100)
```

## Configuration

### S3 Storage Backend

Tempo uses S3-compatible storage for trace data. Update the `REPLACE_ME` placeholders in `helmrelease.yaml` or provide values via the `tempo-s3-credentials` Secret:

| Setting | Description |
|---------|-------------|
| `endpoint` | S3 endpoint URL (MinIO for dev, S3 for production) |
| `bucket` | S3 bucket name for trace storage |
| `access_key` | S3 access key |
| `secret_key` | S3 secret key |

### Receivers

| Protocol | Port | Source |
|----------|------|--------|
| Zipkin | 9411 | Istio sidecars |
| OTLP gRPC | 4317 | OpenTelemetry SDKs and collectors |
| OTLP HTTP | 4318 | OpenTelemetry SDKs (HTTP fallback) |

### Grafana Datasource

The `grafana-datasource.yaml` ConfigMap is deployed to the `monitoring` namespace with the `grafana_datasource: "1"` label. Grafana's sidecar automatically discovers and loads it.

The datasource includes:
- Trace-to-logs correlation with Loki
- Trace-to-metrics correlation with Prometheus
- Service map visualization
- Node graph visualization

### Metrics Generator

The metrics generator creates service graph metrics and span metrics from ingested traces, enabling RED dashboards without separate instrumentation.

## NIST Controls

| Control | Implementation |
|---------|---------------|
| AU-2 | Distributed traces capture service-to-service request flows |
| SI-4 | Trace data enables detection of anomalous communication patterns |

## Dependencies

- Depends on: Istio (trace source, sidecar injection), Monitoring (Grafana datasource, Prometheus scraping)

## Troubleshooting

```bash
# Check Tempo pods
kubectl get pods -n tempo

# View Tempo logs
kubectl logs -n tempo -l app.kubernetes.io/name=tempo --tail=100

# Verify trace ingestion (check metrics)
kubectl port-forward -n tempo svc/tempo 3100:3100
curl http://localhost:3100/metrics | grep tempo_distributor_spans_received_total

# Verify Grafana datasource loaded
kubectl get configmap -n monitoring grafana-datasource-tempo

# Test Zipkin endpoint
kubectl port-forward -n tempo svc/tempo 9411:9411
curl -X POST http://localhost:9411/api/v2/spans -H 'Content-Type: application/json' -d '[]'
```
