# External Secrets Operator

External Secrets Operator (ESO) synchronizes secrets from OpenBao into native Kubernetes Secrets. Applications consume standard Kubernetes Secrets with no code changes required.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | ESO Helm chart (v0.9.13) |
| `clustersecretstore.yaml` | ClusterSecretStore pointing to OpenBao |
| `example-externalsecret.yaml` | Reference ExternalSecret for tenants |
| `network-policies/` | Default deny + explicit allows |

## Architecture

```
OpenBao (secret store)
    ↓ Kubernetes auth (ServiceAccount → OpenBao role)
ESO (ClusterSecretStore → openbao-backend)
    ↓ sync every 1h (configurable per ExternalSecret)
Kubernetes Secret
    ↓
Pod env vars / volume mounts
```

## Usage

### Creating an ExternalSecret for your application

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-db
  namespace: my-namespace
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: my-app-db
  data:
    - secretKey: password
      remoteRef:
        key: sre/data/my-team/my-app-db
        property: password
```

### Prerequisites

1. OpenBao KV v2 secret exists at the path
2. OpenBao policy allows the namespace ServiceAccount to read it
3. ExternalSecret resource deployed in the target namespace

## Dependencies

- Depends on: Istio, OpenBao, Monitoring

## NIST Controls

| Control | Implementation |
|---------|---------------|
| IA-5 | Authenticator management via OpenBao policies |
| SC-28 | Secrets encrypted at rest in OpenBao, synced to encrypted K8s Secrets |

## Troubleshooting

```bash
# Check ExternalSecret sync status
kubectl get externalsecret -A

# Check ClusterSecretStore status
kubectl get clustersecretstore

# View ESO logs
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets

# Force sync an ExternalSecret
kubectl annotate externalsecret my-secret -n my-ns force-sync=$(date +%s) --overwrite
```
