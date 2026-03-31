# Phase 8: Monitoring and Logging

**Date:** 2026-03-30
**Result:** PASS (core stack healthy), NOTE (compliance CronJobs failing)

## Monitoring Stack (namespace: monitoring)

| Component | Pods | Status |
|-----------|------|--------|
| Prometheus | 1/1 | Running |
| Alertmanager | 1/1 | Running |
| Grafana | 1/1 | Running |
| kube-state-metrics | 1/1 | Running |
| prometheus-node-exporter | 3/3 (DaemonSet) | Running |
| prometheus-operator | 1/1 | Running |
| blackbox-exporter | 1/1 | Running |

All core monitoring pods Running with Istio sidecars (2/2 or 3/3 containers).

## ServiceMonitors: 26 Active

Covering: external-secrets (3), harbor, keycloak, logging (alloy, loki), monitoring (14 including Flux controllers, Istio, Prometheus stack), openbao, team-keystone (2), tempo, velero.

## Logging Stack (namespace: logging)

| Component | Pods | Status |
|-----------|------|--------|
| Alloy (DaemonSet) | 3/3 | Running |
| Loki | 1/1 | Running |
| Loki Canary | 3/3 (DaemonSet) | Running |

All logging pods Running with Istio sidecars.

## Known Issue: Compliance CronJobs

Several compliance CronJobs in monitoring namespace are in Error state:
- `sre-compliance-drift` -- recurring failures
- `sre-compliance-evidence` -- recurring failures
- `sre-compliance-scan` -- recurring failures
- `sre-stig-scan` -- recurring failures
- `sre-cve-scan` -- Completed successfully (last run 11h ago)

These are non-blocking for platform operation but should be investigated.

## Evidence

- `tests/e2e/round5/evidence/monitoring-pods.txt`
- `tests/e2e/round5/evidence/servicemonitors.txt`
- `tests/e2e/round5/evidence/logging-pods.txt`
