# Phase 9: Runtime Security (NeuVector)

**Date:** 2026-03-30
**Result:** PASS

## NeuVector Pods (namespace: neuvector)

| Component | Replicas | Status |
|-----------|----------|--------|
| controller-pod | 3/3 | Running (HA) |
| enforcer-pod (DaemonSet) | 3/3 | Running |
| manager-pod | 1/1 | Running |
| scanner-pod | 3/3 | Running |
| updater-pod (CronJob) | Completed | Scanner DB updated 16h ago |
| cert-upgrader-job | Completed | Certificate rotation done |

## Admission Control

- Validating webhook `neuvector-validating-crd-webhook` active (age: 25d)
- Complements Kyverno admission control for runtime-level enforcement

## Security Posture

- 3 controllers in HA for high availability
- 3 enforcers (one per node) for full cluster coverage
- 3 scanners for parallel vulnerability scanning
- Automated scanner DB updates via CronJob
- PeerAuthentication: PERMISSIVE (documented exception -- NeuVector requires unencrypted sidecar communication for deep packet inspection)

## Evidence

- `tests/e2e/round5/evidence/neuvector-pods.txt`
- `tests/e2e/round5/evidence/neuvector-webhooks.txt`
