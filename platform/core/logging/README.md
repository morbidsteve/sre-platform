# Logging Stack

Centralized log aggregation using Grafana Loki and Alloy.

## Components

- **Alloy** — DaemonSet log collector (replaces Promtail), collects from all pod stdout/stderr and node journals
- **Loki** — Log aggregation and storage with S3-compatible backend
- **Grafana** — Unified log query UI (shared with monitoring stack)

## NIST Controls

- AU-2 (Audit Events) — Captures K8s API audit logs and all pod logs
- AU-3 (Content of Audit Records) — Structured JSON format with timestamps
- AU-4 (Audit Storage) — Configurable retention with S3 backend
- AU-9 (Protection of Audit Information) — Encrypted storage, RBAC-restricted access

## Retention

- Default: 30 days
- Audit logs: 90 days (configurable per compliance requirement)

## Dependencies

- Depends on: Istio, Monitoring (Grafana datasource integration)
