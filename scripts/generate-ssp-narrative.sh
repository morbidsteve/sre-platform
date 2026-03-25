#!/usr/bin/env bash
# ============================================================================
# SRE Platform — SSP Narrative Auto-Generation
# ============================================================================
# Reads the NIST 800-53 control mapping and generates prose narratives
# suitable for inclusion in a System Security Plan (SSP) document.
#
# Each narrative includes: control description, platform implementation,
# evidence paths, and last verified status.
#
# Usage:
#   ./scripts/generate-ssp-narrative.sh                    # Generate to stdout
#   ./scripts/generate-ssp-narrative.sh -o FILE            # Write to file
#   ./scripts/generate-ssp-narrative.sh --family AC        # Single family
#
# Output: compliance/ssp-narratives.md (Markdown)
#
# NIST Controls: PL-2 (System Security Plan), CA-5 (Plan of Action)
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTROL_MAPPING="${REPO_ROOT}/compliance/nist-800-53-mappings/control-mapping.json"
OUTPUT_FILE="${REPO_ROOT}/compliance/ssp-narratives.md"
SCAN_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FILTER_FAMILY=""

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output)   OUTPUT_FILE="$2"; shift 2 ;;
        --family)      FILTER_FAMILY="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [-o output.md] [--family FAMILY]"
            echo "  -o, --output FILE    Output file (default: compliance/ssp-narratives.md)"
            echo "  --family FAMILY      Filter by control family (e.g., AC, AU, CM)"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Prerequisites ───────────────────────────────────────────────────────────
if [[ ! -f "$CONTROL_MAPPING" ]]; then
    echo "ERROR: Control mapping not found: ${CONTROL_MAPPING}" >&2
    echo "Run from the sre-platform repo root." >&2
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 is required for narrative generation" >&2
    exit 1
fi

# ── Generate narratives ────────────────────────────────────────────────────
echo -e "${CYAN}[*]${NC} Generating SSP narratives from ${CONTROL_MAPPING}..." >&2

python3 <<'PYEOF' > "${OUTPUT_FILE}"
import json
import sys
import os
from datetime import datetime

control_mapping_path = os.environ.get("CONTROL_MAPPING", "")
filter_family = os.environ.get("FILTER_FAMILY", "")
scan_date = os.environ.get("SCAN_DATE", datetime.utcnow().isoformat() + "Z")

with open(control_mapping_path) as f:
    data = json.load(f)

metadata = data.get("metadata", {})
controls = data.get("controls", [])

if filter_family:
    controls = [c for c in controls if c.get("id", "").startswith(filter_family)]

# Group controls by family
families = {}
for ctrl in controls:
    family_name = ctrl.get("family", "Unknown")
    if family_name not in families:
        families[family_name] = []
    families[family_name].append(ctrl)

# Sort families by control ID
for fam in families:
    families[fam].sort(key=lambda c: c.get("id", ""))

# Status mapping for prose
status_prose = {
    "implemented": "Fully implemented and operational",
    "partially-implemented": "Partially implemented; remediation in progress",
    "planned": "Planned for implementation",
    "not-implemented": "Not yet implemented"
}

# Component descriptions for prose
component_desc = {
    "keycloak": "Keycloak Identity and Access Management",
    "kyverno": "Kyverno Policy Engine",
    "istio": "Istio Service Mesh",
    "rke2": "RKE2 Kubernetes Distribution",
    "flux": "Flux CD GitOps Engine",
    "monitoring": "Prometheus/Grafana Monitoring Stack",
    "logging": "Loki/Alloy Logging Stack",
    "neuvector": "NeuVector Runtime Security",
    "harbor": "Harbor Container Registry",
    "cert-manager": "cert-manager Certificate Management",
    "openbao": "OpenBao Secrets Management",
    "ansible": "Ansible OS Hardening Automation",
    "velero": "Velero Backup and Recovery"
}

print(f"# System Security Plan (SSP) -- Control Implementation Narratives")
print()
print(f"**System Name:** {metadata.get('platform', 'Secure Runtime Environment (SRE)')}")
print(f"**Framework:** {metadata.get('framework', 'NIST SP 800-53 Rev 5')}")
print(f"**Baseline:** {metadata.get('baseline', 'Moderate')}")
print(f"**Generated:** {scan_date}")
print(f"**Total Controls:** {metadata.get('total-controls', len(controls))}")
print(f"**Implemented:** {metadata.get('implemented', 0)}")
print()
print("---")
print()
print("## Table of Contents")
print()
for fam_name in sorted(families.keys()):
    anchor = fam_name.lower().replace(" ", "-").replace(",", "").replace("&", "and")
    ctrl_ids = ", ".join(c["id"] for c in families[fam_name])
    print(f"- [{fam_name}](#{anchor}) ({ctrl_ids})")
print()
print("---")
print()

for fam_name in sorted(families.keys()):
    ctrls = families[fam_name]
    print(f"## {fam_name}")
    print()

    for ctrl in ctrls:
        ctrl_id = ctrl.get("id", "")
        title = ctrl.get("title", "")
        priority = ctrl.get("priority", "")
        baseline = ctrl.get("baseline", "")
        components = ctrl.get("components", [])
        implementation = ctrl.get("implementation", "")
        evidence = ctrl.get("evidence", [])
        status = ctrl.get("status", "unknown")
        automated = ctrl.get("automated", False)
        continuous_monitoring = ctrl.get("continuous-monitoring", "")

        status_text = status_prose.get(status, status)
        component_list = ", ".join(component_desc.get(c, c) for c in components)

        print(f"### {ctrl_id}: {title}")
        print()
        print(f"**Priority:** {priority} | **Baseline:** {baseline.capitalize()} | **Status:** {status_text}")
        print()

        # Implementation narrative
        print(f"**Implementation Description:**")
        print()
        print(f"{implementation}")
        print()

        # Responsible components
        print(f"**Responsible Components:** {component_list}")
        print()

        # Evidence
        if evidence:
            print(f"**Evidence Artifacts:**")
            print()
            for ev in evidence:
                print(f"- `{ev}`")
            print()

        # Automation status
        if automated:
            print(f"**Automation:** This control is automatically enforced and continuously validated by the platform.")
        else:
            print(f"**Automation:** This control requires manual verification or procedural compliance.")
        print()

        # Continuous monitoring
        if continuous_monitoring:
            print(f"**Continuous Monitoring:** {continuous_monitoring}")
            print()

        print("---")
        print()

# Summary statistics
total = len(controls)
implemented = len([c for c in controls if c.get("status") == "implemented"])
partial = len([c for c in controls if c.get("status") == "partially-implemented"])
planned = len([c for c in controls if c.get("status") == "planned"])
automated_count = len([c for c in controls if c.get("automated")])

print("## Summary Statistics")
print()
print(f"| Metric | Value |")
print(f"|--------|-------|")
print(f"| Total controls | {total} |")
print(f"| Fully implemented | {implemented} |")
print(f"| Partially implemented | {partial} |")
print(f"| Planned | {planned} |")
print(f"| Automated enforcement | {automated_count} |")
print(f"| Manual/procedural | {total - automated_count} |")
print()
if total > 0:
    pct = round(implemented / total * 100, 1)
    print(f"**Overall Implementation Rate:** {pct}%")
    print()
print("---")
print()
print(f"*This document was auto-generated by `scripts/generate-ssp-narrative.sh` on {scan_date}.*")
print(f"*Source data: `compliance/nist-800-53-mappings/control-mapping.json`*")
PYEOF

EXPORT_STATUS=$?

if [[ $EXPORT_STATUS -eq 0 ]] && [[ -f "$OUTPUT_FILE" ]]; then
    LINE_COUNT=$(wc -l < "$OUTPUT_FILE")
    echo -e "${GREEN}[OK]${NC} SSP narratives generated: ${OUTPUT_FILE} (${LINE_COUNT} lines)" >&2
else
    echo -e "${RED}[FAIL]${NC} Narrative generation failed" >&2
    exit 1
fi
