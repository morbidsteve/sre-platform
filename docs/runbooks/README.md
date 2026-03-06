# SRE Platform Runbook Library

Operational runbooks for the Secure Runtime Environment (SRE) platform. Each runbook corresponds to a specific alert or operational scenario and provides step-by-step investigation and resolution procedures.

## Runbook Index

| Runbook | Severity | Component | Description |
|---------|----------|-----------|-------------|
| [certificate-expiry.md](certificate-expiry.md) | Critical | cert-manager | Certificate rotation and expiry remediation |
| [flux-reconciliation-failure.md](flux-reconciliation-failure.md) | Warning | Flux CD | Debugging GitOps reconciliation failures |
| [openbao-sealed.md](openbao-sealed.md) | Critical | OpenBao | Unsealing and recovery procedures |
| [node-not-ready.md](node-not-ready.md) | Critical | RKE2 | Node troubleshooting and recovery |
| [pod-security-violation.md](pod-security-violation.md) | Warning | Kyverno | Policy violation investigation |
| [high-memory-usage.md](high-memory-usage.md) | Warning | Monitoring | Memory pressure investigation and remediation |
| [harbor-scan-failure.md](harbor-scan-failure.md) | Warning | Harbor | Trivy scan troubleshooting |
| [istio-mtls-failure.md](istio-mtls-failure.md) | Critical | Istio | mTLS connection debugging |
| [backup-restore.md](backup-restore.md) | Critical | Velero | Backup verification and restore procedures |
| [keycloak-sso-failure.md](keycloak-sso-failure.md) | Critical | Keycloak | OIDC/SSO troubleshooting |
| [loki-ingestion-failure.md](loki-ingestion-failure.md) | Warning | Logging | Loki log pipeline debugging |

## Conventions

Each runbook follows a standard format:

- **Alert** -- The Prometheus/Grafana alert that triggers this runbook
- **Severity** -- Critical, Warning, or Info
- **Impact** -- What is affected when this issue occurs
- **Investigation Steps** -- Numbered diagnostic commands
- **Resolution** -- Step-by-step fix procedures
- **Prevention** -- How to prevent recurrence
- **Escalation** -- When and to whom to escalate

## Platform Component Reference

| Component | Namespace | HelmRelease Name | Key Pods |
|-----------|-----------|-----------------|----------|
| Istio Base | istio-system | istio-base | -- |
| Istiod | istio-system | istiod | istiod |
| cert-manager | cert-manager | cert-manager | cert-manager, cert-manager-webhook |
| Kyverno | kyverno | kyverno | kyverno-admission-controller, kyverno-background-controller |
| Monitoring | monitoring | kube-prometheus-stack | prometheus, grafana, alertmanager |
| Loki | logging | loki | loki |
| Alloy | logging | alloy | alloy |
| OpenBao | openbao | openbao | openbao-0 |
| External Secrets | external-secrets | external-secrets | external-secrets |
| Harbor | harbor | harbor | harbor-core, harbor-registry, harbor-trivy |
| NeuVector | neuvector | neuvector | neuvector-controller, neuvector-enforcer |
| Keycloak | keycloak | keycloak | keycloak-0 |
| Velero | velero | velero | velero |
| Tempo | tempo | tempo | tempo |

## How to Use

1. Identify the alert firing in Grafana or Alertmanager
2. Find the matching runbook from the index above
3. Follow the investigation steps in order
4. Apply the resolution that matches your diagnosis
5. Verify the fix and document any deviations
6. If unresolved after following the runbook, follow the escalation path
