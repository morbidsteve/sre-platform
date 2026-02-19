# External Secrets Operator

External Secrets Operator (ESO) synchronizes secrets from OpenBao into native Kubernetes Secrets. Applications consume standard Kubernetes Secrets with no code changes required.

## Architecture

```
OpenBao (secret store) → ESO (sync engine) → Kubernetes Secret → Pod env/volume
```

## Key Resources

- `namespace.yaml` — Namespace with Istio injection
- `helmrelease.yaml` — ESO Helm chart deployment
- `clustersecretstore.yaml` — ClusterSecretStore pointing to OpenBao
- `network-policies/` — Default deny + explicit allows

## Configuration

ESO connects to OpenBao via the Kubernetes auth method. Each tenant namespace gets an ExternalSecret that references the ClusterSecretStore.

## NIST Controls

- **IA-5**: Authenticator management via OpenBao policies
- **SC-28**: Secrets encrypted at rest in OpenBao, synced to encrypted K8s Secrets
