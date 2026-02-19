# Monitoring Stack

kube-prometheus-stack providing metrics collection, alerting, and visualization for the SRE platform.

## Components

| Component | Description | Version |
|---|---|---|
| Prometheus | Metrics collection, storage, and querying (15-day in-cluster retention) | kube-prometheus-stack `57.2.0` |
| Grafana | Unified dashboards for metrics, logs, and traces | Bundled with kube-prometheus-stack |
| AlertManager | Alert routing with webhook, PagerDuty, Slack, and email support | Bundled with kube-prometheus-stack |
| Prometheus Operator | Manages Prometheus, AlertManager, and ServiceMonitor CRDs | Bundled with kube-prometheus-stack |
| node-exporter | Host-level metrics (CPU, memory, disk, network) | Bundled with kube-prometheus-stack |
| kube-state-metrics | Kubernetes object state metrics (pods, deployments, nodes) | Bundled with kube-prometheus-stack |

## NIST 800-53 Controls

| Control | Description | Implementation |
|---|---|---|
| AU-6 | Audit Review, Analysis, and Reporting | Grafana dashboards for audit log analysis and compliance reporting |
| CA-7 | Continuous Monitoring | Prometheus real-time metrics for all platform components |
| IR-4 | Incident Handling | AlertManager routing with runbook links to Grafana dashboards |
| IR-5 | Incident Monitoring | PrometheusRule alerts for policy violations, certificate expiry, reconciliation failures |
| SI-4 | System Monitoring | Prometheus ServiceMonitors for all platform workloads |

## Grafana Dashboards

The following dashboards are included via the Grafana sidecar (any ConfigMap with the `grafana_dashboard` label is auto-loaded):

| Dashboard | Description |
|---|---|
| Istio Mesh | Service mesh traffic, error rates, and latency (from Istio telemetry) |
| Istio Service | Per-service Istio metrics with request/response details |
| Flux Cluster | Flux reconciliation status, duration, and error rates |
| Kyverno Policy Reports | Policy violation counts, trends, and namespace breakdown |
| Node Overview | Per-node CPU, memory, disk, and network utilization |
| Cluster Overview | Cluster-wide resource usage, pod counts, and API server metrics |

To add a custom dashboard, create a ConfigMap in any namespace with the label `grafana_dashboard: "1"`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-custom-dashboard
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
  annotations:
    grafana_folder: "Custom"
data:
  my-dashboard.json: |
    { ... Grafana dashboard JSON ... }
```

## AlertManager Configuration

AlertManager is configured with two receivers:

- **default-webhook** -- catches all non-critical alerts, groups by namespace and alert name
- **critical-webhook** -- catches `severity: critical` alerts with a 1-hour repeat interval

To configure real receivers, update the webhook URLs in the HelmRelease values or supply credentials via a Secret referenced in `valuesFrom`.

### SRE Platform Alerts

The following custom alerts are defined in `prometheusrule-sre.yaml`:

| Alert | Severity | Condition |
|---|---|---|
| `KyvernoPolicyViolation` | warning | Kyverno policy violation count > 0 for 15 minutes |
| `CertificateExpiringSoon` | warning | cert-manager certificate expires in less than 30 days |
| `FluxReconciliationFailure` | critical | Flux Kustomization or HelmRelease not ready for 30 minutes |
| `PodSecurityViolation` | critical | Pod running as root user (UID 0) |
| `HighErrorRate` | critical | Greater than 5% HTTP 5xx responses for 10 minutes |

## ServiceMonitors

In addition to the ServiceMonitors created by kube-prometheus-stack itself, the following are defined in `servicemonitors.yaml` for platform components:

| Target | Namespace | Port |
|---|---|---|
| istiod | istio-system | 15014 |
| flux source-controller | flux-system | 8080 |
| flux kustomize-controller | flux-system | 8080 |
| flux helm-controller | flux-system | 8080 |

Other platform components (cert-manager, Kyverno) create their own ServiceMonitors via their Helm charts.

## Dependencies

- **Istio** -- namespace has `istio-injection: enabled` for mTLS
- **Kyverno** -- must be installed before monitoring to enforce policies on monitoring pods

## Configuration

### Grafana Admin Credentials

Grafana expects a Kubernetes Secret named `grafana-admin-credentials` in the `monitoring` namespace with keys `admin-user` and `admin-password`. Create this secret via External Secrets Operator from OpenBao, or manually for development:

```bash
kubectl create secret generic grafana-admin-credentials \
  -n monitoring \
  --from-literal=admin-user=admin \
  --from-literal=admin-password=changeme
```

### Prometheus Storage

Prometheus uses 50Gi persistent volumes with 15-day retention. For production, ensure the StorageClass supports `ReadWriteOnce` and has sufficient IOPS.

### Environment-Specific Overrides

Create a ConfigMap named `monitoring-env-values` in the `monitoring` namespace to override defaults without modifying the HelmRelease:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: monitoring-env-values
  namespace: monitoring
data:
  values.yaml: |
    prometheus:
      prometheusSpec:
        retention: "30d"
        storageSpec:
          volumeClaimTemplate:
            spec:
              resources:
                requests:
                  storage: 100Gi
```

## Network Policies

The monitoring namespace uses a default-deny policy with explicit allows:

- **Prometheus** -- egress to all namespaces for metrics scraping; egress to Kubernetes API for service discovery; egress to kube-system for DNS
- **Grafana** -- ingress from istio-system (gateway) and monitoring namespace; egress to Prometheus and Loki; egress to Kubernetes API and DNS
- **AlertManager** -- ingress from Prometheus; egress to webhook receivers; egress to DNS; cluster peering between replicas
- **node-exporter** -- ingress from monitoring namespace (Prometheus scrape)
- **kube-state-metrics** -- ingress from monitoring namespace; egress to Kubernetes API and DNS
- **Prometheus Operator** -- ingress from monitoring namespace; egress to Kubernetes API and DNS

## Troubleshooting

### Check HelmRelease status

```bash
flux get helmrelease monitoring -n monitoring
flux logs --kind=HelmRelease --name=monitoring -n monitoring
```

### Check Prometheus targets

```bash
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
# Open http://localhost:9090/targets
```

### Check AlertManager

```bash
kubectl port-forward svc/monitoring-kube-prometheus-alertmanager 9093:9093 -n monitoring
# Open http://localhost:9093
```

### Check Grafana

```bash
kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring
# Open http://localhost:3000
```

### View PrometheusRule alerts

```bash
kubectl get prometheusrule -n monitoring
kubectl describe prometheusrule sre-platform-alerts -n monitoring
```

### Force Flux reconciliation

```bash
flux reconcile helmrelease monitoring -n monitoring
```

### Check ServiceMonitor discovery

```bash
kubectl get servicemonitor -A
kubectl describe servicemonitor istiod -n monitoring
```
