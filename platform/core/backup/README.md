# Backup — Velero

Cluster state and persistent volume backup to S3-compatible storage for disaster recovery.

## What It Does

- **Scheduled Backups** — Daily (retain 7 days), weekly (retain 28 days), monthly (retain 90 days)
- **Cluster Resources** — Backs up all Kubernetes resources including CRDs, RBAC, and namespaces
- **Volume Snapshots** — CSI volume snapshots for stateful workloads via AWS provider
- **Disaster Recovery** — Tested restore procedures with configurable scope
- **Namespace Exclusion** — Skips kube-system and flux-system (infrastructure is redeployable via GitOps)

## Components

| Resource | Purpose |
|----------|---------|
| `namespace.yaml` | Namespace without Istio injection (mesh-independent operation) |
| `helmrelease.yaml` | Velero chart with AWS plugin, schedules, and S3 backend |
| `network-policies/default-deny.yaml` | Default deny all ingress/egress |
| `network-policies/allow-velero.yaml` | Explicit allows for S3, K8s API, Prometheus |

## Helm Chart Version

Velero chart is pinned to version `6.0.0`. AWS plugin is pinned to `v1.9.1`.

## Architecture

- **Velero Server** — Deployment that manages backup/restore operations
- **AWS Plugin** — Init container providing S3-compatible storage and volume snapshot support
- **Backup Storage Location** — S3 bucket for backup data
- **Volume Snapshot Location** — AWS EBS snapshots for persistent volumes

## Configuration

### S3 Storage Backend

Update the `REPLACE_ME` placeholder in `helmrelease.yaml` for `s3Url`, or provide the value via the `velero-s3-credentials` Secret.

The Secret must contain credentials in the format expected by the Velero AWS plugin:

```yaml
credentials:
  secretContents:
    cloud: |
      [default]
      aws_access_key_id=REPLACE_ME
      aws_secret_access_key=REPLACE_ME
```

### Backup Schedules

| Schedule | Cron | Retention | Scope |
|----------|------|-----------|-------|
| `daily-backup` | `0 2 * * *` (2 AM daily) | 168h (7 days) | All except kube-system, flux-system |
| `weekly-backup` | `0 3 * * 0` (3 AM Sunday) | 672h (28 days) | All except kube-system, flux-system |
| `monthly-backup` | `0 4 1 * *` (4 AM 1st of month) | 2160h (90 days) | All except kube-system, flux-system |

All schedules include cluster resources (CRDs, ClusterRoles, etc.) and volume snapshots.

### Excluded Namespaces

- `kube-system` — Kubernetes system components are managed by RKE2
- `flux-system` — Flux is bootstrapped separately; its state is in Git

## NIST Controls

| Control | Implementation |
|---------|---------------|
| CP-9 | Scheduled automated backups with configurable retention |
| CP-10 | System recovery and reconstitution via tested restore procedures |

## Security Exception

Velero requires elevated permissions to access cluster resources and volume snapshots across all namespaces. This is a documented exception scoped to the `velero` namespace and its ServiceAccount.

## Dependencies

- Depends on: Istio (base CRDs), Monitoring (Prometheus ServiceMonitor)

## Troubleshooting

```bash
# Check Velero status
kubectl get pods -n velero

# List backups
velero backup get

# Describe a backup
velero backup describe daily-backup-<timestamp> --details

# Check backup storage location
velero backup-location get

# View Velero logs
kubectl logs -n velero -l app.kubernetes.io/name=velero --tail=100

# Manually trigger a backup
velero backup create manual-backup --exclude-namespaces kube-system,flux-system

# Restore from a backup (to a test namespace first)
velero restore create --from-backup daily-backup-<timestamp> --namespace-mappings "source:target"

# Check scheduled backups
velero schedule get
```
