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
| OpenBao | `openbao/` | Secrets management (HA mode, Kubernetes auth) |
| External Secrets | `external-secrets/` | Syncs secrets from OpenBao to Kubernetes Secrets |
| NeuVector | `runtime-security/` | Container runtime security and network segmentation |
| Velero | `backup/` | Cluster backup and disaster recovery |

## Directory Structure

```
core/
├── kustomization.yaml          # Root — lists sources and components
├── sources/
│   └── helmrepositories.yaml   # All HelmRepository definitions
├── components/                 # Flux Kustomization CRDs (dependency ordering)
│   ├── istio.yaml
│   ├── cert-manager.yaml
│   ├── kyverno.yaml
│   ├── monitoring.yaml
│   ├── logging.yaml
│   ├── openbao.yaml
│   ├── external-secrets.yaml
│   ├── runtime-security.yaml
│   └── backup.yaml
├── istio/                      # Component manifests (HelmRelease, namespace, etc.)
├── cert-manager/
├── kyverno/
├── monitoring/
├── logging/
├── openbao/
├── external-secrets/
├── runtime-security/
└── backup/
```

## Dependency Chain

```
istio → cert-manager → kyverno → monitoring → logging
                                      ↓
                                   openbao → external-secrets
                                      ↓
                               runtime-security
                                      ↓
                                    backup
```

Each component's Flux Kustomization uses `dependsOn` to enforce this ordering.
