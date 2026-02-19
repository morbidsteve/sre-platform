# Monitoring Stack

kube-prometheus-stack providing metrics collection, alerting, and visualization.

## Components

- **Prometheus** — Metrics collection and storage (15-day in-cluster retention)
- **Grafana** — Unified dashboards for metrics, logs, and traces
- **AlertManager** — Alert routing to PagerDuty, Slack, or email
- **Thanos Sidecar** — Long-term metrics storage to S3-compatible backend

## NIST Controls

- CA-7 (Continuous Monitoring) — Real-time metrics for all platform components
- IR-4 (Incident Handling) — AlertManager routing with runbook links
- SI-4 (System Monitoring) — Prometheus metrics for all workloads

## Pre-built Dashboards

- Cluster health overview
- Namespace resource usage
- Istio traffic and error rates
- Kyverno policy violation trends
- NeuVector security alerts
- Flux reconciliation status

## Dependencies

- Depends on: Istio, Kyverno
