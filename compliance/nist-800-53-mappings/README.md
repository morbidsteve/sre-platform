# NIST 800-53 Mappings

Machine-readable mappings from NIST 800-53 Rev 5 controls to SRE platform components.

## Contents

- `controls.json` — Full mapping: control ID → implementing component(s) → evidence source
- `800-53-to-800-171.json` — Crosswalk from NIST 800-53 to NIST 800-171 (CMMC 2.0 Level 2)
- `gaps.json` — Controls not yet covered by the platform

## Usage

These mappings feed into:
1. OSCAL SSP generation
2. `task compliance-gaps` for gap analysis
3. Automated compliance reporting dashboards in Grafana
