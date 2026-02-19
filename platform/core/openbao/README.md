# OpenBao Secrets Management

OpenBao (open-source Vault fork under Linux Foundation) deployed in HA mode with Raft storage for centralized secrets management.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | OpenBao Helm chart (v0.6.0) in HA mode |
| `namespace.yaml` | Namespace with Istio injection |
| `network-policies/` | Default deny + explicit allows |

## Architecture

```
OpenBao (3 replicas, Raft consensus)
    ↓ Kubernetes auth method
External Secrets Operator (separate component)
    ↓ sync
Kubernetes Secrets → Pod env/volume mounts
```

## Configuration

### HA Mode

OpenBao runs 3 replicas with Raft consensus storage. One pod is the active leader; the others are standby replicas that forward requests.

### Auto-Unseal

Configured for transit seal (auto-unseal via another Vault/OpenBao instance or cloud KMS). Update the `seal` stanza in the HelmRelease values or provide credentials via the `openbao-seal-credentials` Secret.

For dev environments, manual unseal with Shamir keys is acceptable.

### Secrets Engines

After deployment, initialize and configure:

```bash
# Initialize (first time only)
kubectl exec -n openbao openbao-0 -- openbao operator init

# Enable KV v2 for application secrets
kubectl exec -n openbao openbao-0 -- openbao secrets enable -path=sre kv-v2

# Enable PKI for internal certificates
kubectl exec -n openbao openbao-0 -- openbao secrets enable pki

# Enable Kubernetes auth
kubectl exec -n openbao openbao-0 -- openbao auth enable kubernetes
```

### Audit Logging

Enable audit logging to forward all access events to stdout (collected by Alloy):

```bash
kubectl exec -n openbao openbao-0 -- openbao audit enable file file_path=stdout
```

## Dependencies

- Depends on: Istio, Monitoring
- ESO depends on: OpenBao

## NIST Controls

| Control | Implementation |
|---------|---------------|
| IA-5 | Secret rotation and lifecycle management |
| SC-12 | Centralized cryptographic key management |
| SC-13 | FIPS-compliant encryption at rest |
| SC-28 | Encrypted storage backend with auto-unseal |

## Troubleshooting

```bash
# Check OpenBao status
kubectl exec -n openbao openbao-0 -- openbao status

# Check Raft peers
kubectl exec -n openbao openbao-0 -- openbao operator raft list-peers

# View audit logs
kubectl logs -n openbao openbao-0

# Check HelmRelease status
flux get helmrelease openbao -n openbao
```
