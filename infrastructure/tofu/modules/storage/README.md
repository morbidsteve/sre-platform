# Storage Module

Provisions S3-compatible object storage for platform services that require durable storage backends.

## Resources Created

- Buckets for: OpenTofu state, Velero backups, Loki log storage, Tempo trace storage, Harbor registry storage
- Encryption at rest (SSE-S3 or KMS)
- Versioning enabled for state and backup buckets
- Lifecycle policies for log and trace retention
- IAM policies / IRSA roles for Kubernetes workloads to access buckets
