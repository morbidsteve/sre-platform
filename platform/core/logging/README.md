# Logging Stack

Centralized log aggregation using Grafana Loki and Alloy, deployed via Flux CD.

## Components

| Component | Purpose | Deployment Type |
|-----------|---------|----------------|
| **Loki** | Log aggregation engine (Simple Scalable mode) | StatefulSet (read, write, backend) |
| **Alloy** | Log collector, replaces Promtail | DaemonSet (runs on every node) |
| **Loki Gateway** | nginx reverse proxy for Loki API | Deployment |
| **Grafana Datasource** | ConfigMap auto-discovered by Grafana sidecar | ConfigMap (in monitoring namespace) |

## Architecture

```
                                  ┌─────────────┐
                                  │   Grafana    │
                                  │ (monitoring) │
                                  └──────┬───────┘
                                         │ query
                                         ▼
┌──────────┐   push    ┌──────────────┐     ┌────────────┐
│  Alloy   │ ────────► │ Loki Gateway │ ──► │ Loki Read  │
│ DaemonSet│           │   (nginx)    │     │ (queriers) │
└──────────┘           └──────┬───────┘     └────────────┘
                              │ push
                              ▼
                       ┌─────────────┐     ┌─────────────┐
                       │ Loki Write  │ ──► │    S3/MinIO  │
                       │ (ingesters) │     │   (storage)  │
                       └─────────────┘     └─────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Loki Backend │
                       │ (compactor)  │
                       └──────────────┘
```

## Log Sources

Alloy collects logs from two sources:

1. **Kubernetes pod logs** -- All container stdout/stderr via the Kubernetes API. Each log entry is enriched with labels: `namespace`, `pod`, `container`, `app`, `team`, `node`.

2. **Node journal logs** -- systemd journal from every node. Captures kernel messages, kubelet logs, containerd logs, and other system services. Labeled with `unit`, `hostname`, `level`.

## Retention Policy

| Log Type | Retention Period | Configuration |
|----------|-----------------|---------------|
| Default (all logs) | 30 days (720h) | `loki.limits_config.retention_period` |
| Audit namespace logs | 90 days | Configure via per-tenant overrides when multi-tenancy is enabled |

To increase retention for specific log types in production, configure Loki's per-tenant limits or adjust the global `retention_period` value in the HelmRelease.

## NIST 800-53 Controls

| Control | Description | Implementation |
|---------|-------------|----------------|
| **AU-2** | Audit Events | Alloy collects all pod logs and node journal entries, including K8s API audit events |
| **AU-3** | Content of Audit Records | Structured JSON log parsing with timestamp, source, namespace, pod, level |
| **AU-4** | Audit Storage Capacity | S3-compatible backend with configurable retention and unlimited storage growth |
| **AU-9** | Protection of Audit Information | NetworkPolicies restrict access; S3 encryption at rest; RBAC on Grafana queries |
| **AU-12** | Audit Generation | All platform components output structured JSON to stdout, collected by Alloy DaemonSet |

## Storage Backend

**Dev environment**: MinIO (deployed separately in `minio` namespace) with `loki-chunks` bucket.

**Production**: S3-compatible storage (AWS S3, Azure Blob via S3 gateway, or MinIO). Configure via the `loki-s3-credentials` Secret or `loki-env-values` ConfigMap.

S3 credentials in the HelmRelease use `REPLACE_ME` placeholders. In production, override with a Kubernetes Secret created by External Secrets Operator from OpenBao:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: loki-s3-credentials
  namespace: logging
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: loki-s3-credentials
  data:
    - secretKey: loki.storage.s3.access_key_id
      remoteRef:
        key: sre/platform/loki-s3
        property: access_key_id
    - secretKey: loki.storage.s3.secret_access_key
      remoteRef:
        key: sre/platform/loki-s3
        property: secret_access_key
```

## Dependencies

| Dependency | Reason |
|------------|--------|
| Istio (istio-system) | Namespace has `istio-injection: enabled` for mTLS |
| Monitoring (monitoring) | Grafana datasource integration, ServiceMonitor scraping |

## Configuration

### Environment-specific overrides

Create a ConfigMap named `loki-env-values` in the `logging` namespace to override values per environment:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: loki-env-values
  namespace: logging
data:
  values.yaml: |
    loki:
      limits_config:
        retention_period: "2160h"  # 90 days for production
    read:
      replicas: 3
    write:
      replicas: 3
    backend:
      replicas: 2
```

### Alloy custom relabeling

Create a ConfigMap named `alloy-env-values` in the `logging` namespace to override Alloy configuration per environment.

## Troubleshooting

### Check Flux HelmRelease status

```bash
flux get helmreleases -n logging
flux logs --kind=HelmRelease --name=loki -n logging
flux logs --kind=HelmRelease --name=alloy -n logging
```

### Force reconciliation

```bash
flux reconcile helmrelease loki -n logging
flux reconcile helmrelease alloy -n logging
```

### Check Loki health

```bash
# Loki ready endpoint (via gateway)
kubectl exec -n logging deploy/loki-gateway -- \
  wget -qO- http://localhost:80/ready

# Check Loki ring status
kubectl port-forward -n logging svc/loki-read 3100:3100
curl http://localhost:3100/ring
```

### Query logs via LogCLI

```bash
# Port-forward Loki gateway
kubectl port-forward -n logging svc/loki-gateway 8080:80

# Query logs
logcli query '{namespace="default"}' --addr http://localhost:8080
logcli query '{namespace="kube-system", unit="kubelet.service"}' --addr http://localhost:8080
```

### Check Alloy DaemonSet status

```bash
kubectl get pods -n logging -l app.kubernetes.io/name=alloy
kubectl logs -n logging -l app.kubernetes.io/name=alloy --tail=50
```

### Common issues

| Issue | Resolution |
|-------|-----------|
| Loki pods in CrashLoopBackOff | Check S3/MinIO connectivity: `kubectl logs -n logging loki-write-0` |
| Alloy not collecting logs | Verify DaemonSet is running on all nodes: `kubectl get ds -n logging` |
| Grafana shows "No data" for Loki | Check datasource ConfigMap is in monitoring namespace with `grafana_datasource: "1"` label |
| Loki write timeout errors | Increase write replicas or check S3 latency |
| Missing logs from a namespace | Verify pods are running (not Pending/Failed) and Alloy relabel rules include the namespace |

## Network Policy Summary

| Policy | Purpose |
|--------|---------|
| `default-deny-all` | Deny all ingress and egress by default |
| `allow-dns` | Allow all logging pods to resolve DNS via kube-system |
| `allow-alloy-to-loki` | Alloy DaemonSet can push logs to Loki gateway (port 80, 3100) |
| `allow-loki-internal` | Loki read/write/backend inter-communication (ports 3100, 9095, 7946) |
| `allow-loki-to-s3` | Loki can reach MinIO (port 9000) and S3 (port 443) |
| `allow-grafana-to-loki` | Monitoring namespace can query Loki gateway (port 80, 3100) |
| `allow-prometheus-scrape` | Monitoring namespace can scrape metrics from all logging pods |
| `allow-gateway-to-loki` | Loki gateway can forward requests to Loki read/write/backend |

## Integration Checklist

- [x] **Istio**: Namespace has `istio-injection: enabled`
- [x] **Monitoring**: ServiceMonitors enabled for both Loki and Alloy
- [x] **Grafana**: Loki datasource ConfigMap deployed in monitoring namespace
- [x] **Network Policies**: Default deny + explicit allows for all required traffic
- [x] **NIST Controls**: AU-2, AU-3, AU-4, AU-9, AU-12 annotated on all resources
- [x] **README**: This document
