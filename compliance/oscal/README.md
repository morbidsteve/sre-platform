# OSCAL Artifacts

Machine-readable compliance artifacts in OSCAL (Open Security Controls Assessment Language) format, supporting Continuous Authority to Operate (cATO).

## Contents

- `ssp.json` — System Security Plan (SSP) in OSCAL JSON format covering all NIST 800-53 Rev 5 controls implemented by the SRE platform
- Component definitions mapping platform services to NIST controls
- Assessment results from automated compliance scanning

## Format

All OSCAL documents follow the NIST OSCAL 1.1.2 specification in JSON format.

## System Security Plan (ssp.json)

The SSP is the primary compliance artifact for the SRE platform. It contains:

### Metadata
- System identification, versioning, and role definitions (system owner, platform admin, security officer)

### System Characteristics
- **System Name:** Secure Runtime Environment
- **Security Sensitivity Level:** Moderate (FIPS 199)
- **Information Types:** Controlled Unclassified Information (CUI)
- **Authorization Boundary:** All RKE2 cluster nodes, platform services, and tenant workloads

### System Implementation
Lists all 13 platform components with UUIDs, descriptions, and types:
- RKE2, Istio, Kyverno, Monitoring (Prometheus/Grafana), Logging (Loki/Alloy)
- OpenBao, Harbor, NeuVector, Keycloak, cert-manager, Velero, Flux CD, Rocky Linux 9

### Control Implementation
Maps 48 NIST 800-53 Rev 5 controls across 11 control families (AC, AU, CA, CM, IA, IR, MP, RA, SA, SC, SI) to their implementing components with detailed descriptions.

## Usage

### Validate the SSP structure
```bash
# Verify JSON is well-formed
python3 -m json.tool compliance/oscal/ssp.json > /dev/null

# Count implemented controls
python3 -c "
import json
with open('compliance/oscal/ssp.json') as f:
    ssp = json.load(f)
reqs = ssp['system-security-plan']['control-implementation']['implemented-requirements']
print(f'Total controls implemented: {len(reqs)}')
families = set(r['control-id'].split('-')[0].upper() for r in reqs)
print(f'Control families covered: {sorted(families)}')
"
```

### Generate compliance gap report
```bash
task compliance-gaps
```

### Feed into ATO package
The SSP JSON can be imported into compliance tools (e.g., OSCAL-based GRC platforms) to auto-populate the ATO package. The machine-readable format enables:
1. Automated evidence collection from the live cluster
2. Continuous compliance monitoring via Prometheus and Kyverno policy reports
3. Delta analysis when controls or components change

## Updating the SSP

When adding a new platform component:
1. Add the component to `system-implementation.components` with a unique UUID
2. Add or update `control-implementation.implemented-requirements` entries for any NIST controls the component addresses
3. Update the `last-modified` timestamp in metadata
4. Cross-reference `compliance/nist-800-53-mappings/control-mapping.json` to ensure consistency

## Related Files

- `../nist-800-53-mappings/control-mapping.json` — Machine-readable control-to-component mapping with evidence paths
- `../../docs/agent-docs/compliance-mapping.md` — Human-readable compliance mapping documentation
