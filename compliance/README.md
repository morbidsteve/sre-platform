# Compliance Artifacts

Machine-readable and human-readable compliance documentation for ATO, CMMC, FedRAMP, NIST 800-53, and DISA STIGs.

## Structure

```
compliance/
├── oscal/                    # OSCAL System Security Plan and component definitions
├── stig-checklists/          # DISA STIG checklists (Rocky Linux 9, RKE2, Istio)
└── nist-800-53-mappings/     # NIST 800-53 → platform component crosswalk
```

## NIST 800-53 Rev 5

The platform addresses control families: AC, AU, CA, CM, IA, IR, MP, RA, SA, SC, SI. See [compliance mapping](../docs/agent-docs/compliance-mapping.md) for the full control-to-component matrix.

## CMMC 2.0 Level 2

Maps to NIST 800-171, which is a subset of 800-53. The `nist-800-53-mappings/` directory includes a crosswalk from 800-53 to 800-171.

## DISA STIGs

- Rocky Linux 9 (RHEL 9 STIG) — applied by Ansible `os-hardening` role
- RKE2 Kubernetes STIG — validated by `scripts/validate-compliance.sh`
- Istio STIG — manual checklist in `stig-checklists/`

## OSCAL / cATO

OSCAL (Open Security Controls Assessment Language) artifacts enable Continuous Authority to Operate by providing machine-readable compliance evidence.

```bash
task compliance-report    # Generate compliance report from live cluster
task compliance-gaps      # Show NIST controls without implementing components
```
