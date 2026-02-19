# NIST 800-53 Mappings

Machine-readable mappings from NIST 800-53 Rev 5 controls to SRE platform components.

## Contents

- `control-mapping.json` — Full mapping: control ID to implementing component(s), implementation status, and evidence source paths
- `800-53-to-800-171.json` — Crosswalk from NIST 800-53 to NIST 800-171 (CMMC 2.0 Level 2)
- `gaps.json` — Controls not yet covered by the platform

## control-mapping.json

The primary mapping file contains:

### Metadata
- Title, version, baseline level (Moderate), and last-updated timestamp

### Controls
Each control entry includes:

| Field | Description |
|-------|-------------|
| `title` | Human-readable control name |
| `components` | Array of SRE platform components that implement this control |
| `status` | Implementation status: `implemented`, `partial`, or `planned` |
| `evidence` | Array of file paths to manifests, policies, or configurations that serve as implementation evidence |

### Coverage

The mapping covers 46 controls across 11 NIST 800-53 Rev 5 control families:

- **AC** (Access Control): AC-2, AC-3, AC-4, AC-6, AC-6(1), AC-6(9), AC-6(10), AC-14, AC-17
- **AU** (Audit and Accountability): AU-2, AU-3, AU-4, AU-5, AU-6, AU-8, AU-9, AU-12
- **CA** (Assessment, Authorization, and Monitoring): CA-7, CA-8
- **CM** (Configuration Management): CM-2, CM-3, CM-5, CM-6, CM-7, CM-8, CM-11
- **IA** (Identification and Authentication): IA-2, IA-3, IA-5, IA-8
- **IR** (Incident Response): IR-4, IR-5, IR-6
- **MP** (Media Protection): MP-2
- **RA** (Risk Assessment): RA-5
- **SA** (System and Services Acquisition): SA-10, SA-11
- **SC** (System and Communications Protection): SC-3, SC-7, SC-8, SC-12, SC-13, SC-28
- **SI** (System and Information Integrity): SI-2, SI-3, SI-4, SI-5, SI-6, SI-7

## Usage

### Query controls by component
```bash
# Find all controls implemented by Istio
python3 -c "
import json
with open('compliance/nist-800-53-mappings/control-mapping.json') as f:
    data = json.load(f)
for ctrl_id, ctrl in data['controls'].items():
    if 'istio' in ctrl['components']:
        print(f\"{ctrl_id}: {ctrl['title']}\")
"
```

### Check for unimplemented controls
```bash
# Find controls that are not fully implemented
python3 -c "
import json
with open('compliance/nist-800-53-mappings/control-mapping.json') as f:
    data = json.load(f)
for ctrl_id, ctrl in data['controls'].items():
    if ctrl['status'] != 'implemented':
        print(f\"{ctrl_id}: {ctrl['title']} ({ctrl['status']})\" )
"
```

### Generate gap report
```bash
task compliance-gaps
```

### Feed into automated reporting
These mappings feed into:
1. OSCAL SSP generation (`compliance/oscal/ssp.json`)
2. `task compliance-gaps` for gap analysis
3. Automated compliance reporting dashboards in Grafana
4. ATO evidence packages for government assessors

## Updating the Mapping

When adding or modifying a platform component:
1. Identify which NIST 800-53 controls the component addresses (refer to `docs/agent-docs/compliance-mapping.md`)
2. Add or update the control entry in `control-mapping.json`
3. Set the correct `status` value
4. Add evidence file paths pointing to the actual manifests or policies
5. Update `compliance/oscal/ssp.json` to keep the SSP in sync

## Related Files

- `../oscal/ssp.json` — OSCAL System Security Plan referencing these controls
- `../../docs/agent-docs/compliance-mapping.md` — Human-readable compliance mapping with detailed implementation notes
