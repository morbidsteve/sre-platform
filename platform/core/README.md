# Core Platform Services

Required services installed on every SRE cluster. These provide the security, observability, and policy foundation that all applications depend on.

## Services

| Service | Component | Purpose |
|---------|-----------|---------|
| Istio | `istio/` | Service mesh — mTLS, traffic management, authorization |
| cert-manager | `cert-manager/` | Automated TLS certificate issuance and rotation |
| Kyverno | `kyverno/` | Kubernetes-native policy enforcement |
| Monitoring | `monitoring/` | kube-prometheus-stack (Prometheus + Grafana + AlertManager) |
| Logging | `logging/` | Loki + Alloy for centralized log aggregation |
| OpenBao | `openbao/` | Secrets management + External Secrets Operator |
| NeuVector | `runtime-security/` | Container runtime security and network segmentation |
| Velero | `backup/` | Cluster backup and disaster recovery |

## Dependency Order

Each service's Flux Kustomization uses `dependsOn` to enforce installation order. See the root `kustomization.yaml` in this directory for the full dependency graph.
