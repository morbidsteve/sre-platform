# Backup — Velero

Cluster state and persistent volume backup to S3-compatible storage.

## What It Does

- Backs up all Kubernetes resources and persistent volumes
- Scheduled backups: daily (retain 7), weekly (retain 4), monthly (retain 3)
- Disaster recovery with tested restore procedures
- CSI volume snapshots for stateful workloads

## NIST Controls

- CP-9 (Information System Backup) — Scheduled automated backups
- CP-10 (System Recovery and Reconstitution) — Tested restore procedures

## Security Exception

Velero requires elevated permissions to access cluster resources and volume snapshots. This is a documented exception scoped to the `velero` namespace.

## Dependencies

- Depends on: Istio, Monitoring
