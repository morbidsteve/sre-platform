# Phase 11: ATO Evidence Collection

**Date:** 2026-03-30
**Result:** PASS -- All artifacts collected

## Collected Evidence Artifacts

| Artifact | File | Records |
|----------|------|---------|
| Kyverno Policy Reports | `kyverno-policy-reports.json` | 29,771 lines |
| Network Policies | `network-policies.json` | 119 policies across 29 namespaces |
| mTLS Configuration | `mtls-config.json` | STRICT cluster-wide |
| Authorization Policies | `authz-policies.json` | 15 policies |
| TLS Certificates | `certificates.json` | 3 cert-manager certificates |
| External Secrets | `external-secrets.json` | 2 synced secrets |
| Cluster Secret Stores | `cluster-secret-stores.json` | OpenBao backend |
| OSCAL Artifacts | `oscal-artifacts.txt` | SSP + generator script |
| STIG Checklists | `oscal-artifacts.txt` | RKE2 STIG + Rocky Linux 9 |

## OSCAL Artifacts (compliance/oscal/)

- `ssp.json` -- System Security Plan in OSCAL format
- `generate-ssp.sh` -- SSP generation script

## STIG Checklists (compliance/stig-checklists/)

- `kubernetes-rke2.yaml` -- RKE2 Kubernetes DISA STIG checklist
- `rke2-stig.json` -- Machine-readable RKE2 STIG data
- `rocky-linux-9.yaml` -- Rocky Linux 9 DISA STIG checklist

## Security Control Evidence

| Evidence Type | Artifact | NIST Control |
|--------------|----------|--------------|
| Privileged pod denied | `ac6-privileged-test.txt` | AC-6 |
| Registry restriction | `cm11-registry-test.txt` | CM-11 |
| mTLS enforcement | `sc8-mtls.txt` | SC-8 |
| Image signatures | `si7-image-signatures.txt` | SI-7 |
| Policy reports | `kyverno-policy-reports.json` | CA-7, CM-6 |
| Network isolation | `network-policies.json` | AC-4, SC-7 |
| AuthZ policies | `authz-policies.json` | AC-3, AC-4 |
| Certificates | `certificates.json` | SC-12, IA-5 |
| Secrets management | `external-secrets.json` | SC-28, IA-5 |

## Evidence Location

All files stored in: `tests/e2e/round5/evidence/`
