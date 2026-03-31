# Phase 10: Backup (Velero)

**Date:** 2026-03-30
**Result:** PASS (components running), NOTE (storage backend unavailable)

## Velero Pods (namespace: velero)

| Component | Replicas | Status |
|-----------|----------|--------|
| velero | 1/1 | Running |
| node-agent (DaemonSet) | 3/3 | Running |

## Backup Schedules

| Schedule | Cron | Last Backup | Status |
|----------|------|-------------|--------|
| velero-daily-backup | `0 2 * * *` (daily 2AM) | 14h ago | Enabled |
| velero-weekly-backup | `0 3 * * 0` (Sunday 3AM) | 2d13h ago | Enabled |
| velero-monthly-backup | `0 4 1 * *` (1st of month 4AM) | -- | Enabled |

## Storage Backend

- BackupStorageLocation `default`: Phase=**Unavailable**
- This indicates the S3-compatible storage backend (MinIO) is not reachable
- Backups are being created on schedule but may not be persisting to remote storage
- This is a known limitation of the lab environment (no MinIO deployed)

## Recommendation

For production: deploy MinIO or configure S3 backend. For lab: backups run but remote storage is unavailable. Velero infrastructure is correctly configured and ready for a functional storage backend.

## Evidence

- `tests/e2e/round5/evidence/velero-pods.txt`
- `tests/e2e/round5/evidence/velero-storage.txt`
- `tests/e2e/round5/evidence/velero-schedules.txt`
