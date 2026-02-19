# DISA STIG Checklists

Pre-filled STIG checklists documenting how the SRE platform satisfies each STIG requirement.

## Checklists

| STIG | File | Findings | Status | Applied By |
|------|------|----------|--------|------------|
| Rocky Linux 9 (RHEL 9 STIG) | `rocky-linux-9.yaml` | 14 | All not_a_finding | Ansible `os-hardening` role |
| RKE2 Kubernetes STIG | `kubernetes-rke2.yaml` | 12 | All not_a_finding | RKE2 CIS profile + Kyverno + Istio |
| Istio STIG | (planned) | - | - | Manual configuration documented here |

## Format

Checklists are provided as YAML files for automated processing and integration with compliance tooling. Each finding includes:

- **vuln_id**: DISA Vulnerability ID (V-XXXXXX)
- **stig_id**: STIG rule identifier (e.g., RHEL-09-211010, CNTR-K8-000010)
- **severity**: Finding severity (high, medium, low)
- **title**: Human-readable description of the requirement
- **status**: One of `not_a_finding`, `open`, `not_applicable`
- **implementation**: How the SRE platform satisfies the requirement
- **evidence**: Path to the implementing code or configuration
- **nist_controls**: Mapped NIST 800-53 control IDs

## Rocky Linux 9 STIG Summary

The Rocky Linux 9 checklist covers the DISA STIG for RHEL 9 (V1R1). Rocky Linux 9 is binary-compatible with RHEL 9, so the same STIG applies directly. All 14 key findings are addressed by the Ansible `os-hardening` role, which configures:

- FIPS 140-2 cryptographic mode
- SELinux in enforcing mode with targeted policy
- auditd logging with proper log format and rotation
- SSH hardening (no root login, no password auth, key-only)
- Host-based firewall via firewalld
- AIDE file integrity monitoring
- Filesystem mount hardening (/tmp with nodev, nosuid, noexec)

## Kubernetes (RKE2) STIG Summary

The Kubernetes checklist covers the DISA STIG for Kubernetes (V1R11) as applied to RKE2. All 12 key findings are addressed through a combination of:

- **RKE2 defaults**: TLS 1.2+, FIPS cipher suites, embedded etcd with mTLS, RBAC enabled, anonymous auth disabled, audit logging
- **Kyverno policies**: Pod security enforcement, image registry restriction, image signature verification
- **Istio**: TLS termination for user-facing components, mTLS for service-to-service communication
- **cert-manager**: Automated certificate management

## Validation

```bash
# Validate STIG compliance against live cluster
task validate

# Run the compliance validation script
scripts/validate-compliance.sh

# Check specific STIG findings
kubectl get policyreport -A -o json | jq '.items[].results[] | select(.result == "fail")'
```

## Adding New Findings

When adding findings to a checklist:

1. Use the exact `vuln_id` and `stig_id` from the published DISA STIG
2. Set `status` to one of: `not_a_finding`, `open`, `not_applicable`
3. Provide a clear `implementation` description explaining how the platform satisfies the requirement
4. Include an `evidence` path pointing to the implementing code
5. Map to relevant NIST 800-53 controls in the `nist_controls` field
6. Update the `summary` section totals

## References

- [DISA STIG Library](https://public.cyber.mil/stigs/)
- [RHEL 9 STIG (applies to Rocky Linux 9)](https://public.cyber.mil/stigs/downloads/)
- [Kubernetes STIG](https://public.cyber.mil/stigs/downloads/)
- [RKE2 STIG Compliance](https://docs.rke2.io/security/hardening_guide)
