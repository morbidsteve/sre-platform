#!/usr/bin/env bash
# ============================================================================
# SRE Platform — OSCAL-to-eMASS Export
# ============================================================================
# Reads the NIST 800-53 control mapping (or OSCAL SSP) and outputs an
# eMASS-compatible CSV for bulk import into the Enterprise Mission
# Assurance Support Service.
#
# Columns: Control Number, Control Title, Implementation Status,
#          Responsible Entities, Implementation Description,
#          Assessment Procedures
#
# Usage:
#   ./scripts/oscal-to-emass.sh                          # Generate CSV
#   ./scripts/oscal-to-emass.sh -o FILE                  # Custom output path
#   ./scripts/oscal-to-emass.sh --from-ssp               # Use OSCAL SSP as source
#
# NIST Controls: CA-5, CA-6, PL-2
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTROL_MAPPING="${REPO_ROOT}/compliance/nist-800-53-mappings/control-mapping.json"
SSP_FILE="${REPO_ROOT}/compliance/oscal/ssp.json"
OUTPUT_FILE="${REPO_ROOT}/compliance/emass-export.csv"
USE_SSP=false

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output)   OUTPUT_FILE="$2"; shift 2 ;;
        --from-ssp)    USE_SSP=true; shift ;;
        -h|--help)
            echo "Usage: $0 [-o output.csv] [--from-ssp]"
            echo "  -o, --output FILE    Output CSV path (default: compliance/emass-export.csv)"
            echo "  --from-ssp           Use OSCAL SSP JSON as source instead of control-mapping.json"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Prerequisites ───────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 is required" >&2
    exit 1
fi

SOURCE_FILE="$CONTROL_MAPPING"
if [[ "$USE_SSP" == true ]]; then
    SOURCE_FILE="$SSP_FILE"
fi

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "ERROR: Source file not found: ${SOURCE_FILE}" >&2
    if [[ "$USE_SSP" == true ]]; then
        echo "Generate SSP first: ./scripts/generate-ssp.sh -o compliance/oscal/ssp.json" >&2
    fi
    exit 1
fi

# ── Generate CSV ────────────────────────────────────────────────────────────
echo -e "${CYAN}[*]${NC} Generating eMASS CSV from ${SOURCE_FILE}..." >&2

EXPORT_SOURCE="$SOURCE_FILE" EXPORT_USE_SSP="$USE_SSP" python3 <<'PYEOF' > "${OUTPUT_FILE}"
import json
import csv
import sys
import os
import io

source_file = os.environ.get("EXPORT_SOURCE", "")
use_ssp = os.environ.get("EXPORT_USE_SSP", "false") == "true"

with open(source_file) as f:
    data = json.load(f)

# eMASS status mapping
emass_status_map = {
    "implemented": "Implemented",
    "partially-implemented": "Partially Implemented",
    "planned": "Planned",
    "not-implemented": "Not Implemented",
    "operational": "Implemented",
    "degraded": "Partially Implemented"
}

# Component to entity mapping
entity_map = {
    "keycloak": "Platform Team / Identity Management",
    "kyverno": "Platform Team / Policy Enforcement",
    "istio": "Platform Team / Service Mesh",
    "rke2": "Platform Team / Kubernetes Operations",
    "flux": "Platform Team / GitOps Operations",
    "monitoring": "Platform Team / Monitoring & Observability",
    "logging": "Platform Team / Logging & Audit",
    "neuvector": "Platform Team / Runtime Security",
    "harbor": "Platform Team / Container Registry",
    "cert-manager": "Platform Team / Certificate Management",
    "openbao": "Platform Team / Secrets Management",
    "ansible": "Platform Team / Infrastructure Automation",
    "velero": "Platform Team / Backup & Recovery"
}

# Assessment procedure mapping by family
assessment_procedures = {
    "AC": "Verify access control mechanisms via RBAC audit, Kyverno PolicyReport review, and Istio AuthorizationPolicy inspection. Evidence: kubectl get clusterrolebindings, kubectl get policyreport -A, kubectl get authorizationpolicies -A.",
    "AU": "Verify audit logging pipeline by querying Loki for recent audit events, checking Alloy DaemonSet pod status, and reviewing Grafana audit dashboards. Evidence: Loki query results, Alloy pod health, Grafana dashboard screenshots.",
    "CA": "Review continuous monitoring dashboards in Grafana, verify Prometheus scrape targets are healthy, and validate Kyverno background policy scan results. Evidence: Grafana dashboard exports, ServiceMonitor status, PolicyReport summary.",
    "CM": "Verify GitOps baseline by checking Flux reconciliation status (flux get kustomizations -A), reviewing Kyverno policy enforcement mode, and auditing deployed component versions against pinned versions in Git. Evidence: Flux status, Git commit history, HelmRelease versions.",
    "IA": "Verify identity controls by reviewing Keycloak realm configuration, checking cert-manager certificate status, and validating Istio mTLS mode. Evidence: Keycloak admin console, kubectl get certificates -A, kubectl get peerauthentication -A.",
    "IR": "Review incident response pipeline by checking AlertManager configuration, NeuVector alert history, and Grafana alert rules. Evidence: AlertManager status, NeuVector security events, PrometheusRule list.",
    "MP": "Verify media protection by checking OpenBao seal status, Kubernetes secrets encryption at rest configuration, and storage encryption settings. Evidence: vault status, RKE2 encryption config, storage class parameters.",
    "RA": "Review vulnerability scanning results from Harbor/Trivy and NeuVector runtime scans. Check scan policy configurations and vulnerability thresholds. Evidence: Harbor project scan summaries, NeuVector vulnerability reports.",
    "SA": "Verify developer configuration management by reviewing Git workflow (branch protection, PR history), Flux reconciliation audit trail, and policy test results. Evidence: GitHub branch settings, Flux events, kyverno test output.",
    "SC": "Verify communications protection by checking Istio mTLS STRICT mode, NetworkPolicy coverage across namespaces, cert-manager certificate validity, and FIPS mode status. Evidence: PeerAuthentication status, NetworkPolicy list, certificate expiry dates.",
    "SI": "Verify system integrity by checking Cosign image signature verification policy, Harbor scan gate status, Flux drift detection, and NeuVector runtime protection mode. Evidence: Kyverno imageVerify policy, Harbor project settings, Flux status, NeuVector policy mode."
}

rows = []

if use_ssp:
    # Parse from OSCAL SSP format
    ssp = data.get("system-security-plan", {})
    ctrl_impl = ssp.get("control-implementation", {})
    requirements = ctrl_impl.get("implemented-requirements", [])
    components_data = ssp.get("system-implementation", {}).get("components", [])

    for req in requirements:
        ctrl_id = req.get("control-id", "")
        family_prefix = ctrl_id.split("-")[0] if "-" in ctrl_id else ctrl_id[:2]
        desc = req.get("description", "")
        status = emass_status_map.get(req.get("implementation-status", ""), "Not Implemented")
        evidence = req.get("evidence", "")

        rows.append({
            "Control Number": ctrl_id,
            "Control Title": desc,
            "Implementation Status": status,
            "Responsible Entities": "Platform Team",
            "Implementation Description": evidence,
            "Assessment Procedures": assessment_procedures.get(family_prefix, "Manual review required.")
        })
else:
    # Parse from control-mapping.json format
    controls = data.get("controls", [])
    for ctrl in controls:
        ctrl_id = ctrl.get("id", "")
        family_prefix = ctrl_id.split("-")[0] if "-" in ctrl_id else ctrl_id[:2]
        title = ctrl.get("title", "")
        status = emass_status_map.get(ctrl.get("status", ""), "Not Implemented")
        components = ctrl.get("components", [])
        implementation = ctrl.get("implementation", "")
        evidence = ctrl.get("evidence", [])
        continuous_monitoring = ctrl.get("continuous-monitoring", "")

        # Build responsible entities from components
        entities = "; ".join(entity_map.get(c, f"Platform Team / {c}") for c in components)

        # Build implementation description with evidence
        impl_desc = implementation
        if evidence:
            impl_desc += " Evidence artifacts: " + ", ".join(evidence) + "."
        if continuous_monitoring:
            impl_desc += " Continuous monitoring: " + continuous_monitoring

        # Get assessment procedure for this family
        assessment = assessment_procedures.get(family_prefix, "Manual review and documentation inspection required.")

        rows.append({
            "Control Number": ctrl_id,
            "Control Title": title,
            "Implementation Status": status,
            "Responsible Entities": entities,
            "Implementation Description": impl_desc,
            "Assessment Procedures": assessment
        })

# Write CSV
output = io.StringIO()
fieldnames = ["Control Number", "Control Title", "Implementation Status",
              "Responsible Entities", "Implementation Description", "Assessment Procedures"]
writer = csv.DictWriter(output, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
writer.writeheader()
for row in sorted(rows, key=lambda r: r["Control Number"]):
    writer.writerow(row)

print(output.getvalue(), end="")
PYEOF

EXPORT_STATUS=$?

if [[ $EXPORT_STATUS -eq 0 ]] && [[ -f "$OUTPUT_FILE" ]]; then
    ROW_COUNT=$(wc -l < "$OUTPUT_FILE")
    ROW_COUNT=$((ROW_COUNT - 1))  # subtract header
    echo -e "${GREEN}[OK]${NC} eMASS CSV generated: ${OUTPUT_FILE} (${ROW_COUNT} controls)" >&2
else
    echo -e "${RED}[FAIL]${NC} eMASS CSV generation failed" >&2
    exit 1
fi
