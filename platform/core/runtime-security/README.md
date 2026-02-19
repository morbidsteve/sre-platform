# Runtime Security — NeuVector

Open-source container runtime security providing detection and enforcement.

## What It Does

- Container runtime behavioral monitoring and enforcement
- Network segmentation visualization and DLP/WAF
- CIS benchmark scanning for running containers
- Admission control for vulnerability thresholds
- Process and file activity monitoring

## NIST Controls

- SI-3 (Malicious Code Protection) — Runtime process blocking and file monitoring
- SI-4 (System Monitoring) — Behavioral anomaly detection
- SC-7 (Boundary Protection) — Network microsegmentation with DLP
- IR-5 (Incident Monitoring) — Security event alerting to Prometheus/Grafana

## Security Exception

NeuVector requires a privileged DaemonSet to function. This is a documented and accepted exception to the `disallow-privileged-containers` Kyverno policy, scoped to the `neuvector` namespace only.

## Dependencies

- Depends on: Istio, Monitoring
