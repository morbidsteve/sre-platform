# Runtime Security — NeuVector

Open-source container runtime security providing detection and enforcement for the SRE platform.

## What It Does

- **Runtime Protection** — Behavioral monitoring and enforcement for all containers
- **Network Segmentation** — DLP/WAF with Layer 7 network microsegmentation visualization
- **CIS Benchmarks** — Automated CIS benchmark scanning for running containers
- **Admission Control** — Vulnerability threshold enforcement at admission time
- **Process/File Monitoring** — Whitelist-based process and file activity monitoring
- **Prometheus Metrics** — Exports security events and scan results for Grafana dashboards

## Components

| Resource | Purpose |
|----------|---------|
| `namespace.yaml` | Namespace without Istio injection (privileged DaemonSet) |
| `helmrelease.yaml` | NeuVector core chart (controller, enforcer, manager, scanner) |
| `network-policies/default-deny.yaml` | Default deny all ingress/egress |
| `network-policies/allow-neuvector.yaml` | Explicit allows for NeuVector internal comms |

## Helm Chart Version

NeuVector core chart is pinned to version `2.7.3`.

## Architecture

- **Controller** (3 replicas) — Central management, policy engine, and API server
- **Enforcer** (DaemonSet) — Runtime agent on every node for container monitoring
- **Manager** — Web UI for security operations
- **Scanner** (2 replicas) — Image and container vulnerability scanning

## Configuration

### Controller Cluster

The controller runs with 3 replicas for HA. Controllers communicate over ports 18300-18301 (data) and 18400-18401 (control).

### Enforcer

The enforcer DaemonSet requires privileged access to monitor container runtimes. This is a documented security exception — see below.

### Prometheus Integration

The metrics exporter is enabled, exposing NeuVector metrics for Prometheus scraping. Use Grafana dashboards for security event visualization.

### Admission Control

The admission webhook (ClusterIP) complements Kyverno by adding vulnerability-based admission decisions.

## NIST Controls

| Control | Implementation |
|---------|---------------|
| SI-3 | Runtime process blocking and file system monitoring |
| SI-4 | Behavioral anomaly detection and runtime events |
| IR-4 | Security alerts feed into Prometheus/Grafana alerting pipeline |
| IR-5 | Security event monitoring and incident tracking |
| SC-7 | Network microsegmentation with DLP/WAF |

## Security Exception

NeuVector requires a privileged DaemonSet (enforcer) to function. This is a documented and accepted exception to the `disallow-privileged-containers` Kyverno policy, scoped to the `neuvector` namespace only. The exception is justified because:

1. NeuVector must inspect container runtimes at the host level
2. Network segmentation enforcement requires host network access
3. The exception is namespace-scoped and audited

## Dependencies

- Depends on: Istio (base CRDs), Monitoring (Prometheus ServiceMonitor)

## Troubleshooting

```bash
# Check NeuVector controller status
kubectl get pods -n neuvector -l app=neuvector-controller-pod

# Check enforcer DaemonSet
kubectl get ds -n neuvector

# View NeuVector logs
kubectl logs -n neuvector -l app=neuvector-controller-pod --tail=100

# Check admission webhook
kubectl get validatingwebhookconfiguration | grep neuvector

# Access NeuVector UI (port-forward for debugging)
kubectl port-forward -n neuvector svc/neuvector-service-webui 8443:8443
```
