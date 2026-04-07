# OpenBao Secrets Management

OpenBao (open-source Vault fork under Linux Foundation, API-compatible with HashiCorp Vault) deployed via Flux for centralized secrets management. Provides KV v2 secret storage, PKI certificate issuance, and Kubernetes auth integration. External Secrets Operator (ESO) syncs secrets from OpenBao into native Kubernetes Secrets for consumption by workloads.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | OpenBao Helm chart v0.9.0 via Flux |
| `namespace.yaml` | `openbao` namespace with Istio injection |
| `virtualservice.yaml` | Istio routing for `openbao.apps.sre.example.com` |
| `auto-unseal-cronjob.yaml` | CronJob to auto-unseal after pod restarts |
| `secret-rotation-policy.yaml` | Policy for automated secret rotation |
| `network-policies/` | Default deny + explicit allows |

## Architecture

```
OpenBao (Raft storage)
    |
    +-- Kubernetes auth method (pods auth via ServiceAccount)
    +-- KV v2 engine (path: sre/) for app secrets
    +-- PKI engine for internal certificates
    |
    v
External Secrets Operator (ClusterSecretStore)
    |
    v
Kubernetes Secrets --> Pod env/volume mounts
```

## Deployment

Deployed via Flux HelmRelease in the `openbao` namespace. Depends on Istio (mTLS) and Monitoring (ServiceMonitor scraping). The chart is sourced from the OpenBao Helm repository in `flux-system`.

### Initialization and Unseal

After first deployment, OpenBao must be initialized and unsealed. Use the provided script:

```bash
# Run the init script (initializes, unseals, enables auth/engines)
./scripts/init-openbao.sh
```

The init script stores unseal keys and root token in the `openbao-init-keys` Secret in the `openbao` namespace. An auto-unseal CronJob runs periodically to unseal pods after restarts.

For production, configure transit seal (auto-unseal via cloud KMS) by updating the `seal` stanza in the HelmRelease values.

## Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Chart version | `0.9.0` | Pinned in HelmRelease |
| Storage | Raft consensus | Integrated storage, no external DB |
| Auth methods | Kubernetes | Pods authenticate via ServiceAccount JWT |
| Secret engines | KV v2 (`sre/`), PKI | Application secrets and certificates |
| UI | Enabled | Accessible at `openbao.apps.sre.example.com` |

### Secrets Engines

After initialization, the following engines are available:

- **KV v2** (`sre/`) -- application secrets stored at `sre/<team>/<secret-name>`
- **PKI** -- internal certificate authority for workload TLS

### ESO Integration

External Secrets Operator uses a `ClusterSecretStore` pointing to OpenBao. Tenant workloads create `ExternalSecret` resources to sync specific keys:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-secrets
  namespace: team-alpha
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: my-app-secrets
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: sre/team-alpha/my-app
        property: database_url
```

## Dependencies

| Dependency | Reason |
|------------|--------|
| Istio | mTLS between OpenBao pods and clients |
| Monitoring | ServiceMonitor for Prometheus metrics scraping |

ESO depends on OpenBao being initialized and unsealed.

## NIST Controls

| Control | Implementation |
|---------|---------------|
| IA-5 | Secret rotation and lifecycle management via policies |
| SC-12 | Centralized cryptographic key management (PKI engine) |
| SC-13 | FIPS-compliant encryption at rest |
| SC-28 | Encrypted Raft storage backend with seal/unseal protection |
| AU-2 | Audit logging of all secret access events |

## Troubleshooting

```bash
# Check OpenBao seal status
kubectl exec -n openbao openbao-0 -- openbao status

# Check Raft peers (HA)
kubectl exec -n openbao openbao-0 -- openbao operator raft list-peers

# List enabled secret engines
kubectl exec -n openbao openbao-0 -- openbao secrets list

# List enabled auth methods
kubectl exec -n openbao openbao-0 -- openbao auth list

# View pod logs (includes audit events if enabled)
kubectl logs -n openbao openbao-0 --tail=100

# Check HelmRelease status
flux get helmrelease openbao -n openbao

# Force Flux reconciliation
flux reconcile helmrelease openbao -n openbao

# Check ESO sync status
kubectl get externalsecret -A
```

### Common Issues

| Issue | Resolution |
|-------|-----------|
| Pods sealed after restart | Run `./scripts/init-openbao.sh` or check the auto-unseal CronJob |
| ESO sync failing | Verify OpenBao is unsealed and the ClusterSecretStore is healthy: `kubectl get clustersecretstore` |
| "permission denied" on secret read | Check Kubernetes auth role bindings match the ServiceAccount and namespace |
| Raft leader election stuck | Delete the standby pod to trigger re-election: `kubectl delete pod openbao-1 -n openbao` |
