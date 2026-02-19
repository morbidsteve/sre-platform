# CMMC 2.0 Level 2 Self-Assessment

## Overview

This directory contains the Cybersecurity Maturity Model Certification (CMMC) 2.0 Level 2 self-assessment artifacts for the SRE platform. CMMC 2.0 Level 2 maps directly to NIST SP 800-171 Rev 2, which defines 110 security requirements for protecting Controlled Unclassified Information (CUI) in non-federal systems.

## What is CMMC 2.0?

CMMC 2.0 is the Department of Defense's framework for assessing the cybersecurity posture of defense contractors. Level 2 requires implementation of the 110 security requirements from NIST SP 800-171 Rev 2, which are derived from a subset of NIST SP 800-53 controls.

- **Level 1**: Basic safeguarding of Federal Contract Information (FCI) - 17 practices
- **Level 2**: Protection of Controlled Unclassified Information (CUI) - 110 practices (NIST 800-171)
- **Level 3**: Enhanced protection against Advanced Persistent Threats (APT) - 110+ practices

## Files

| File | Description |
|------|-------------|
| `self-assessment.yaml` | Machine-readable self-assessment of SRE platform practices against CMMC 2.0 Level 2 |
| `README.md` | This document |

## CMMC Domains Covered

The self-assessment evaluates the SRE platform against the following 9 CMMC domains:

### Access Control (AC) - 5 Practices Assessed

The SRE platform implements access control through multiple layers:
- **Keycloak** provides centralized identity management with SSO and group-based RBAC
- **Kubernetes RBAC** scopes user permissions to specific namespaces
- **Istio AuthorizationPolicy** enforces service-to-service access control
- **Kyverno policies** enforce pod security contexts (non-root, drop ALL capabilities)
- **NetworkPolicies** with default deny restrict all network communication flows

### Audit and Accountability (AU) - 3 Practices Assessed

Full audit trail coverage through:
- **Kubernetes API audit logging** captures all API server events
- **Istio access logs** record all service mesh traffic
- **Alloy** collects all pod and node logs
- **Loki** aggregates and stores logs with configurable retention
- **Prometheus AlertManager** alerts on audit system failures

### Configuration Management (CM) - 3 Practices Assessed

Configuration is managed declaratively and enforced continuously:
- **Git** serves as the single source of truth for all configuration
- **Flux CD** continuously reconciles cluster state to match Git
- **Ansible STIG roles** harden the operating system to DISA STIG standards
- **RKE2 CIS profile** hardens Kubernetes out of the box
- **Kyverno** enforces workload configuration policies on admission

### Identification and Authentication (IA) - 2 Practices Assessed

Identity management and authentication:
- **Keycloak** provides SSO with OIDC for all platform UIs
- **MFA enforcement** for all privileged access
- **Istio mTLS** provides workload identity via SPIFFE certificates
- **cert-manager** automates certificate lifecycle management

### Incident Response (IR) - 2 Practices Assessed

Incident detection and response capabilities:
- **NeuVector** detects runtime security anomalies and generates alerts
- **Prometheus/Grafana** provide the alerting pipeline with configurable receivers
- **Kyverno PolicyReports** track compliance violations over time
- **Grafana dashboards** provide exportable incident reports

### Risk Assessment (RA) - 1 Practice Assessed

Continuous vulnerability assessment:
- **Harbor + Trivy** scan all container images on push
- **NeuVector** performs runtime vulnerability scanning
- **CIS benchmark scanning** validates node configurations

### System and Communications Protection (SC) - 4 Practices Assessed

Data protection in transit and at rest:
- **Istio mTLS STRICT** encrypts all in-cluster communication
- **cert-manager** manages TLS certificates for external endpoints
- **RKE2 FIPS mode** provides FIPS 140-2 validated cryptography
- **OpenBao** encrypts secrets at rest with auto-unseal via KMS
- **NetworkPolicies** enforce network segmentation boundaries

### System and Information Integrity (SI) - 3 Practices Assessed

Integrity verification and flaw remediation:
- **Cosign image signatures** verified by Kyverno on admission
- **SBOM generation** via Syft, stored in Harbor as OCI artifacts
- **Trivy scanning** with severity-based alerting
- **Flux CD** detects and remediates configuration drift automatically
- **Grafana AlertManager** routes security alerts to configured channels

## Assessment Status

| Metric | Count |
|--------|-------|
| Total practices assessed | 22 |
| Implemented | 22 |
| Partially implemented | 0 |
| Not implemented | 0 |
| Not applicable | 0 |

All 22 assessed practices are fully implemented by the SRE platform's technical controls.

## Important Notes

1. **This is a self-assessment.** A formal CMMC Level 2 certification requires assessment by a CMMC Third Party Assessor Organization (C3PAO).

2. **Technical controls only.** This assessment covers the technical controls implemented by the SRE platform. Organizational controls (personnel security, physical protection, media handling procedures) require additional policy documentation outside the scope of this platform.

3. **NIST 800-171 coverage.** CMMC Level 2 requires all 110 NIST SP 800-171 practices. This assessment covers the 22 practices most directly addressed by the SRE platform's technical architecture. The remaining practices involve organizational policies, training, physical security, and procedural controls that are the responsibility of the deploying organization.

4. **NIST 800-53 crosswalk.** Each CMMC practice maps to one or more NIST 800-53 controls. See `compliance/nist-800-53-mappings/` for the full crosswalk between NIST 800-53, NIST 800-171, and platform components.

## Generating Updated Assessments

```bash
# Review current CMMC assessment status
task validate

# Generate compliance gap report
task compliance-gaps

# Cross-reference with NIST 800-53 mappings
cat compliance/nist-800-53-mappings/*.json | jq '.controls[] | select(.cmmc_mapping != null)'
```

## References

- [CMMC 2.0 Model Overview (DoD)](https://dodcio.defense.gov/CMMC/)
- [NIST SP 800-171 Rev 2](https://csrc.nist.gov/publications/detail/sp/800-171/rev-2/final)
- [NIST SP 800-53 Rev 5](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [CMMC Assessment Guide Level 2](https://dodcio.defense.gov/CMMC/Documentation/)
