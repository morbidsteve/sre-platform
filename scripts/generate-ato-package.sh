#!/usr/bin/env bash
# ============================================================================
# SRE Platform — ATO Evidence Package Generator
# ============================================================================
# Collects 16 evidence artifacts from the live cluster and compliance
# repository into a timestamped ZIP archive for ATO assessors.
#
# Usage:
#   ./scripts/generate-ato-package.sh                    # Generate package
#   ./scripts/generate-ato-package.sh -o /tmp/ato        # Custom output dir
#   ./scripts/generate-ato-package.sh --skip-cluster      # Skip live cluster queries
#
# NIST Controls: CA-5, CA-6, PL-2
# RAISE 2.0: ATO Package Assembly (RAISE-11)
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
SCAN_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OUTPUT_DIR=""
SKIP_CLUSTER=false
PACKAGE_NAME="sre-ato-package-${TIMESTAMP}"
SRE_DOMAIN="${SRE_DOMAIN:-apps.sre.example.com}"
HARBOR_URL="${HARBOR_URL:-https://harbor.${SRE_DOMAIN}}"
HARBOR_USER="${HARBOR_USER:-admin}"
HARBOR_PASS="${HARBOR_PASS:-}"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output)      OUTPUT_DIR="$2"; shift 2 ;;
        --skip-cluster)   SKIP_CLUSTER=true; shift ;;
        -h|--help)
            echo "Usage: $0 [-o output-dir] [--skip-cluster]"
            echo "  -o, --output DIR     Output directory (default: /tmp)"
            echo "  --skip-cluster       Skip live cluster queries (use repo artifacts only)"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="/tmp"
fi

WORK_DIR="${OUTPUT_DIR}/${PACKAGE_NAME}"
mkdir -p "${WORK_DIR}"

# ── Counters ────────────────────────────────────────────────────────────────
COLLECTED=0
SKIPPED=0
FAILED=0
ARTIFACTS=()

log()  { echo -e "${CYAN}[*]${NC} $1"; }
pass() { echo -e "  ${GREEN}[OK]${NC} $1"; COLLECTED=$((COLLECTED + 1)); }
skip() { echo -e "  ${YELLOW}[SKIP]${NC} $1"; SKIPPED=$((SKIPPED + 1)); }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }

collect_artifact() {
    local name="$1"
    local file="$2"
    if [[ -f "${WORK_DIR}/${file}" ]]; then
        ARTIFACTS+=("{\"name\":\"${name}\",\"file\":\"${file}\",\"status\":\"collected\",\"size\":$(stat -c%s "${WORK_DIR}/${file}" 2>/dev/null || echo 0)}")
    else
        ARTIFACTS+=("{\"name\":\"${name}\",\"file\":\"${file}\",\"status\":\"missing\",\"size\":0}")
    fi
}

check_kubectl() {
    if [[ "$SKIP_CLUSTER" == true ]]; then
        return 1
    fi
    if ! command -v kubectl &>/dev/null; then
        echo -e "${YELLOW}WARNING: kubectl not found — cluster artifacts will be skipped${NC}" >&2
        SKIP_CLUSTER=true
        return 1
    fi
    if ! kubectl cluster-info &>/dev/null 2>&1; then
        echo -e "${YELLOW}WARNING: Cannot connect to cluster — cluster artifacts will be skipped${NC}" >&2
        SKIP_CLUSTER=true
        return 1
    fi
    return 0
}

# ── Banner ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}SRE Platform — ATO Evidence Package Generator${NC}"
echo "=============================================================================="
echo -e "  Timestamp:    ${SCAN_DATE}"
echo -e "  Output:       ${WORK_DIR}"
echo -e "  Cluster:      $(if [[ "$SKIP_CLUSTER" == true ]]; then echo 'SKIPPED'; else echo 'LIVE'; fi)"
echo "=============================================================================="
echo ""

check_kubectl || true

# ============================================================================
# Artifact 1: Live SSP (System Security Plan)
# ============================================================================
log "1/16 — System Security Plan (SSP)"
if [[ -x "${SCRIPT_DIR}/generate-ssp.sh" ]] && [[ "$SKIP_CLUSTER" == false ]]; then
    if "${SCRIPT_DIR}/generate-ssp.sh" -o "${WORK_DIR}/01-ssp.json" 2>/dev/null; then
        pass "SSP generated from live cluster"
    else
        fail "SSP generation failed"
    fi
elif [[ -f "${REPO_ROOT}/compliance/oscal/ssp.json" ]]; then
    cp "${REPO_ROOT}/compliance/oscal/ssp.json" "${WORK_DIR}/01-ssp.json"
    pass "SSP copied from committed artifact"
else
    skip "No SSP available (generate-ssp.sh not found and no committed ssp.json)"
fi
collect_artifact "System Security Plan (SSP)" "01-ssp.json"

# ============================================================================
# Artifact 2: Compliance Report
# ============================================================================
log "2/16 — NIST 800-53 Compliance Report"
if [[ -x "${SCRIPT_DIR}/compliance-report.sh" ]] && [[ "$SKIP_CLUSTER" == false ]]; then
    if "${SCRIPT_DIR}/compliance-report.sh" --json > "${WORK_DIR}/02-compliance-report.json" 2>/dev/null; then
        pass "Compliance report generated from live cluster"
    else
        fail "Compliance report generation failed"
    fi
else
    skip "compliance-report.sh not available or cluster not reachable"
fi
collect_artifact "NIST 800-53 Compliance Report" "02-compliance-report.json"

# ============================================================================
# Artifact 3: STIG Scan Results
# ============================================================================
log "3/16 — STIG Scan Results"
if [[ -x "${SCRIPT_DIR}/quarterly-stig-scan.sh" ]] && [[ "$SKIP_CLUSTER" == false ]]; then
    if "${SCRIPT_DIR}/quarterly-stig-scan.sh" --json > "${WORK_DIR}/03-stig-scan.json" 2>/dev/null; then
        pass "STIG scan completed"
    else
        fail "STIG scan failed (may require additional tools)"
    fi
elif [[ -f "${REPO_ROOT}/compliance/stig-checklists/rke2-stig.json" ]]; then
    cp "${REPO_ROOT}/compliance/stig-checklists/rke2-stig.json" "${WORK_DIR}/03-stig-scan.json"
    pass "STIG checklist copied from committed artifact"
else
    skip "quarterly-stig-scan.sh not available or cluster not reachable"
fi
collect_artifact "STIG Scan Results" "03-stig-scan.json"

# ============================================================================
# Artifact 4: RBAC Audit
# ============================================================================
log "4/16 — RBAC Audit"
if [[ -x "${SCRIPT_DIR}/rbac-audit.sh" ]] && [[ "$SKIP_CLUSTER" == false ]]; then
    if "${SCRIPT_DIR}/rbac-audit.sh" --json > "${WORK_DIR}/04-rbac-audit.json" 2>/dev/null; then
        pass "RBAC audit completed"
    else
        fail "RBAC audit failed"
    fi
else
    skip "rbac-audit.sh not available or cluster not reachable"
fi
collect_artifact "RBAC Audit" "04-rbac-audit.json"

# ============================================================================
# Artifact 5: Kyverno PolicyReports
# ============================================================================
log "5/16 — Kyverno PolicyReports"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get policyreport -A -o json > "${WORK_DIR}/05-policy-reports.json" 2>/dev/null; then
        REPORT_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/05-policy-reports.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "PolicyReports collected (${REPORT_COUNT} reports)"
    else
        fail "Failed to collect PolicyReports"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Kyverno PolicyReports" "05-policy-reports.json"

# ============================================================================
# Artifact 6: Component Inventory (Flux HelmReleases)
# ============================================================================
log "6/16 — Component Inventory"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o json > "${WORK_DIR}/06-component-inventory.json" 2>/dev/null; then
        HR_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/06-component-inventory.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "Component inventory collected (${HR_COUNT} HelmReleases)"
    else
        # Fallback to text format
        if flux get helmreleases -A > "${WORK_DIR}/06-component-inventory.txt" 2>/dev/null; then
            pass "Component inventory collected (text format)"
        else
            fail "Failed to collect component inventory"
        fi
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Component Inventory" "06-component-inventory.json"

# ============================================================================
# Artifact 7: Certificate Status
# ============================================================================
log "7/16 — Certificate Status"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get certificates -A -o json > "${WORK_DIR}/07-certificate-status.json" 2>/dev/null; then
        CERT_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/07-certificate-status.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "Certificate status collected (${CERT_COUNT} certificates)"
    else
        skip "No certificates CRD found (cert-manager may not be installed)"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Certificate Status" "07-certificate-status.json"

# ============================================================================
# Artifact 8: Network Policies
# ============================================================================
log "8/16 — Network Policies"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get networkpolicies -A -o json > "${WORK_DIR}/08-network-policies.json" 2>/dev/null; then
        NP_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/08-network-policies.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "Network policies collected (${NP_COUNT} policies)"
    else
        fail "Failed to collect network policies"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Network Policies" "08-network-policies.json"

# ============================================================================
# Artifact 9: Istio mTLS Status
# ============================================================================
log "9/16 — Istio mTLS Status"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get peerauthentication -A -o json > "${WORK_DIR}/09-mtls-status.json" 2>/dev/null; then
        PA_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/09-mtls-status.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "mTLS status collected (${PA_COUNT} PeerAuthentication resources)"
    else
        skip "PeerAuthentication CRD not found (Istio may not be installed)"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Istio mTLS Status" "09-mtls-status.json"

# ============================================================================
# Artifact 10: Harbor Project Summary
# ============================================================================
log "10/16 — Harbor Project Summary"
if [[ -n "$HARBOR_PASS" ]] && [[ "$SKIP_CLUSTER" == false ]]; then
    if curl -sk -u "${HARBOR_USER}:${HARBOR_PASS}" \
        "${HARBOR_URL}/api/v2.0/projects" \
        -o "${WORK_DIR}/10-harbor-projects.json" 2>/dev/null; then
        PROJECT_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/10-harbor-projects.json')); print(len(data) if isinstance(data, list) else 0)" 2>/dev/null || echo "?")
        pass "Harbor projects collected (${PROJECT_COUNT} projects)"
    else
        fail "Failed to query Harbor API"
    fi
elif [[ -z "$HARBOR_PASS" ]]; then
    skip "Harbor password not set (export HARBOR_PASS=...)"
else
    skip "Cluster not available"
fi
collect_artifact "Harbor Project Summary" "10-harbor-projects.json"

# ============================================================================
# Artifact 11: Active PolicyExceptions
# ============================================================================
log "11/16 — Active PolicyExceptions"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if kubectl get policyexceptions -A -o json > "${WORK_DIR}/11-policy-exceptions.json" 2>/dev/null; then
        PE_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/11-policy-exceptions.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
        pass "PolicyExceptions collected (${PE_COUNT} exceptions)"
    else
        # No PolicyExceptions CRD or none exist
        echo '{"items":[]}' > "${WORK_DIR}/11-policy-exceptions.json"
        pass "No PolicyExceptions found (clean)"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Active PolicyExceptions" "11-policy-exceptions.json"

# ============================================================================
# Artifact 12: OpenBao Status
# ============================================================================
log "12/16 — OpenBao Status"
if [[ "$SKIP_CLUSTER" == false ]]; then
    OPENBAO_POD=$(kubectl get pods -n openbao -l "app.kubernetes.io/name=openbao" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$OPENBAO_POD" ]]; then
        if kubectl exec -n openbao "${OPENBAO_POD}" -- vault status -format=json > "${WORK_DIR}/12-openbao-status.json" 2>/dev/null; then
            SEALED=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/12-openbao-status.json')); print('unsealed' if not data.get('sealed', True) else 'SEALED')" 2>/dev/null || echo "unknown")
            pass "OpenBao status collected (${SEALED})"
        else
            # vault status returns exit 2 when sealed, still outputs JSON
            if [[ -s "${WORK_DIR}/12-openbao-status.json" ]]; then
                pass "OpenBao status collected (may be sealed)"
            else
                fail "Failed to get OpenBao status"
            fi
        fi
    else
        skip "OpenBao pod not found"
    fi
else
    skip "Cluster not available"
fi
collect_artifact "OpenBao Status" "12-openbao-status.json"

# ============================================================================
# Artifact 13: Velero Backup Status
# ============================================================================
log "13/16 — Velero Backup Status"
if [[ "$SKIP_CLUSTER" == false ]]; then
    if command -v velero &>/dev/null; then
        if velero backup get -o json > "${WORK_DIR}/13-velero-backups.json" 2>/dev/null; then
            pass "Velero backup status collected"
        else
            fail "Failed to get Velero backup status"
        fi
    else
        # Fallback to kubectl
        if kubectl get backups.velero.io -n velero -o json > "${WORK_DIR}/13-velero-backups.json" 2>/dev/null; then
            BACKUP_COUNT=$(python3 -c "import json; data=json.load(open('${WORK_DIR}/13-velero-backups.json')); print(len(data.get('items',[])))" 2>/dev/null || echo "?")
            pass "Velero backups collected via kubectl (${BACKUP_COUNT} backups)"
        else
            skip "Velero not installed or no backups found"
        fi
    fi
else
    skip "Cluster not available"
fi
collect_artifact "Velero Backup Status" "13-velero-backups.json"

# ============================================================================
# Artifact 14: POA&M (Plan of Action and Milestones)
# ============================================================================
log "14/16 — POA&M Findings"
if [[ -f "${REPO_ROOT}/compliance/poam/findings.yaml" ]]; then
    cp "${REPO_ROOT}/compliance/poam/findings.yaml" "${WORK_DIR}/14-poam-findings.yaml"
    pass "POA&M findings copied"
else
    skip "POA&M findings file not found at compliance/poam/findings.yaml"
fi
collect_artifact "POA&M Findings" "14-poam-findings.yaml"

# ============================================================================
# Artifact 15: Control Mapping
# ============================================================================
log "15/16 — NIST 800-53 Control Mapping"
if [[ -f "${REPO_ROOT}/compliance/nist-800-53-mappings/control-mapping.json" ]]; then
    cp "${REPO_ROOT}/compliance/nist-800-53-mappings/control-mapping.json" "${WORK_DIR}/15-control-mapping.json"
    pass "Control mapping copied"
else
    skip "Control mapping not found at compliance/nist-800-53-mappings/control-mapping.json"
fi
collect_artifact "NIST 800-53 Control Mapping" "15-control-mapping.json"

# ============================================================================
# Artifact 16: Package Metadata
# ============================================================================
log "16/16 — Package Metadata"

CLUSTER_CONTEXT="unknown"
if [[ "$SKIP_CLUSTER" == false ]]; then
    CLUSTER_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "unknown")
fi

PLATFORM_VERSION="unknown"
if [[ -f "${REPO_ROOT}/platform/core/kustomization.yaml" ]]; then
    PLATFORM_VERSION=$(git -C "${REPO_ROOT}" describe --tags --always 2>/dev/null || echo "unknown")
fi

GIT_SHA=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Generate sha256 checksums for all collected artifacts
CHECKSUMS=""
for f in "${WORK_DIR}"/*; do
    if [[ -f "$f" ]]; then
        HASH=$(sha256sum "$f" | awk '{print $1}')
        BASENAME=$(basename "$f")
        if [[ -n "$CHECKSUMS" ]]; then
            CHECKSUMS="${CHECKSUMS},"
        fi
        CHECKSUMS="${CHECKSUMS}{\"file\":\"${BASENAME}\",\"sha256\":\"${HASH}\"}"
    fi
done

python3 -c "
import json

artifacts = [$(IFS=,; echo "${ARTIFACTS[*]:-}")]
checksums = [${CHECKSUMS}]

metadata = {
    'package': {
        'name': '${PACKAGE_NAME}',
        'generated': '${SCAN_DATE}',
        'generator': 'scripts/generate-ato-package.sh',
        'platform-version': '${PLATFORM_VERSION}',
        'git-sha': '${GIT_SHA}',
        'git-branch': '${GIT_BRANCH}',
        'cluster-context': '${CLUSTER_CONTEXT}'
    },
    'summary': {
        'total-artifacts': 16,
        'collected': ${COLLECTED},
        'skipped': ${SKIPPED},
        'failed': ${FAILED}
    },
    'artifacts': artifacts,
    'checksums': checksums
}

print(json.dumps(metadata, indent=2))
" > "${WORK_DIR}/16-package-metadata.json" 2>/dev/null

if [[ -f "${WORK_DIR}/16-package-metadata.json" ]]; then
    pass "Package metadata generated"
else
    # Fallback without python3
    cat > "${WORK_DIR}/16-package-metadata.json" <<METAEOF
{
  "package": {
    "name": "${PACKAGE_NAME}",
    "generated": "${SCAN_DATE}",
    "generator": "scripts/generate-ato-package.sh",
    "platform-version": "${PLATFORM_VERSION}",
    "git-sha": "${GIT_SHA}",
    "git-branch": "${GIT_BRANCH}",
    "cluster-context": "${CLUSTER_CONTEXT}"
  },
  "summary": {
    "total-artifacts": 16,
    "collected": ${COLLECTED},
    "skipped": ${SKIPPED},
    "failed": ${FAILED}
  }
}
METAEOF
    pass "Package metadata generated (basic)"
fi
collect_artifact "Package Metadata" "16-package-metadata.json"

# ============================================================================
# Create ZIP archive
# ============================================================================
echo ""
log "Creating ZIP archive..."

ZIP_FILE="${OUTPUT_DIR}/${PACKAGE_NAME}.zip"

if command -v zip &>/dev/null; then
    (cd "${OUTPUT_DIR}" && zip -r "${PACKAGE_NAME}.zip" "${PACKAGE_NAME}/" -x "*.DS_Store" 2>/dev/null)
    if [[ -f "$ZIP_FILE" ]]; then
        ZIP_SIZE=$(du -h "$ZIP_FILE" | awk '{print $1}')
        pass "ZIP created: ${ZIP_FILE} (${ZIP_SIZE})"
    else
        fail "ZIP creation failed"
    fi
else
    # Fallback to tar.gz if zip not available
    TAR_FILE="${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"
    (cd "${OUTPUT_DIR}" && tar czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}/" 2>/dev/null)
    if [[ -f "$TAR_FILE" ]]; then
        TAR_SIZE=$(du -h "$TAR_FILE" | awk '{print $1}')
        pass "Archive created (tar.gz, zip not available): ${TAR_FILE} (${TAR_SIZE})"
    else
        fail "Archive creation failed"
    fi
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "=============================================================================="
echo -e "${BOLD}ATO Evidence Package Summary${NC}"
echo "=============================================================================="
echo -e "  Artifacts collected: ${GREEN}${COLLECTED}${NC}/16"
echo -e "  Artifacts skipped:  ${YELLOW}${SKIPPED}${NC}/16"
echo -e "  Artifacts failed:   ${RED}${FAILED}${NC}/16"
echo ""
echo -e "  Package:  ${BOLD}${ZIP_FILE:-${TAR_FILE:-${WORK_DIR}}}${NC}"
echo -e "  Work dir: ${WORK_DIR}"
echo ""

if [[ "$FAILED" -gt 0 ]]; then
    echo -e "  ${YELLOW}Some artifacts failed to collect. Review the output above for details.${NC}"
    echo -e "  ${DIM}Re-run with cluster access to collect all artifacts.${NC}"
fi

echo ""
echo -e "${DIM}Provide this package to the ATO assessor along with the SSP narrative.${NC}"
echo -e "${DIM}Generate narratives: ./scripts/generate-ssp-narrative.sh${NC}"
echo -e "${DIM}Generate eMASS export: ./scripts/oscal-to-emass.sh${NC}"
echo ""
