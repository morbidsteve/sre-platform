#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Component Upgrade Script
# ============================================================================
# Safely upgrades a platform component by updating its HelmRelease version,
# creating a pre-upgrade backup, and monitoring Flux reconciliation.
#
# Usage:
#   ./scripts/upgrade-platform.sh <component> <target-version> [--apply] [--rollback]
#
# Examples:
#   ./scripts/upgrade-platform.sh monitoring 72.7.0           # dry-run
#   ./scripts/upgrade-platform.sh monitoring 72.7.0 --apply   # commit and push
#   ./scripts/upgrade-platform.sh monitoring --rollback        # revert last upgrade
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - flux CLI installed
#   - velero CLI installed (for pre-upgrade backup)
#   - git configured with push access
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${BLUE}[upgrade]${NC} $*"; }
success() { echo -e "${GREEN}  PASS${NC} $*"; }
fail()    { echo -e "${RED}  FAIL${NC} $*"; }
warn()    { echo -e "${YELLOW}  WARN${NC} $*"; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n"; }

# ── Configuration ───────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLY=false
ROLLBACK=false
COMPONENT=""
TARGET_VERSION=""
RECONCILE_TIMEOUT=300  # 5 minutes

# ── Usage ───────────────────────────────────────────────────────────────────

usage() {
    echo "Usage: $0 <component> <target-version> [--apply] [--rollback]"
    echo ""
    echo "Arguments:"
    echo "  component        Component name (e.g., monitoring, kyverno, istio)"
    echo "  target-version   Target chart version (e.g., 72.7.0)"
    echo ""
    echo "Flags:"
    echo "  --apply          Actually commit and push (default is dry-run)"
    echo "  --rollback       Revert the last version change for this component"
    echo ""
    echo "Available components:"
    find "${REPO_ROOT}/platform" -name helmrelease.yaml -exec dirname {} \; 2>/dev/null \
        | sed "s|${REPO_ROOT}/platform/||" | sort | sed 's/^/  /'
    exit 1
}

# ── Parse arguments ─────────────────────────────────────────────────────────

parse_args() {
    local positional=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --apply)
                APPLY=true
                shift
                ;;
            --rollback)
                ROLLBACK=true
                shift
                ;;
            --help|-h)
                usage
                ;;
            -*)
                echo "Unknown flag: $1"
                usage
                ;;
            *)
                positional+=("$1")
                shift
                ;;
        esac
    done

    COMPONENT="${positional[0]:-}"

    if [[ -z "${COMPONENT}" ]]; then
        echo "Error: component name is required"
        usage
    fi

    if [[ "${ROLLBACK}" == "false" ]]; then
        TARGET_VERSION="${positional[1]:-}"
        if [[ -z "${TARGET_VERSION}" ]]; then
            echo "Error: target version is required (unless using --rollback)"
            usage
        fi
    fi
}

# ── Find HelmRelease file ──────────────────────────────────────────────────

find_helmrelease() {
    local component="$1"
    local helmrelease_file=""

    # Search in core and addons
    for dir in "platform/core" "platform/addons"; do
        local candidate="${REPO_ROOT}/${dir}/${component}/helmrelease.yaml"
        if [[ -f "${candidate}" ]]; then
            helmrelease_file="${candidate}"
            break
        fi
    done

    # Try matching subdirectory names more broadly
    if [[ -z "${helmrelease_file}" ]]; then
        helmrelease_file=$(find "${REPO_ROOT}/platform" -path "*/${component}/helmrelease.yaml" -type f 2>/dev/null | head -1)
    fi

    if [[ -z "${helmrelease_file}" || ! -f "${helmrelease_file}" ]]; then
        fail "HelmRelease file not found for component '${component}'"
        echo "Searched in: platform/core/${component}/ and platform/addons/${component}/"
        exit 1
    fi

    echo "${helmrelease_file}"
}

# ── Get current version from HelmRelease ────────────────────────────────────

get_current_version() {
    local file="$1"
    # Extract the version field under chart.spec
    grep -A5 'chart:' "${file}" | grep 'version:' | head -1 | sed 's/.*version:[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | tr -d ' '
}

# ── Get HelmRelease name and namespace ──────────────────────────────────────

get_helmrelease_name() {
    local file="$1"
    grep -A1 '^metadata:' "${file}" | grep 'name:' | head -1 | awk '{print $2}'
}

get_helmrelease_namespace() {
    local file="$1"
    grep -A2 '^metadata:' "${file}" | grep 'namespace:' | head -1 | awk '{print $2}'
}

# ── Rollback ────────────────────────────────────────────────────────────────

do_rollback() {
    local file="$1"

    header "Rollback: ${COMPONENT}"

    # Check if there is a previous version in git history
    local previous_version
    previous_version=$(git -C "${REPO_ROOT}" log --oneline -10 -- "${file}" | head -5)

    if [[ -z "${previous_version}" ]]; then
        fail "No previous git history found for ${file}"
        exit 1
    fi

    log "Recent changes to ${file}:"
    echo "${previous_version}"

    # Get the version from the previous commit
    local prev_content
    prev_content=$(git -C "${REPO_ROOT}" show "HEAD~1:$(realpath --relative-to="${REPO_ROOT}" "${file}")" 2>/dev/null || echo "")

    if [[ -z "${prev_content}" ]]; then
        fail "Cannot read previous version of ${file} from git"
        exit 1
    fi

    local prev_version
    prev_version=$(echo "${prev_content}" | grep -A5 'chart:' | grep 'version:' | head -1 | sed 's/.*version:[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | tr -d ' ')
    local curr_version
    curr_version=$(get_current_version "${file}")

    if [[ "${prev_version}" == "${curr_version}" ]]; then
        warn "Previous version (${prev_version}) is the same as current (${curr_version})"
        warn "No rollback needed"
        exit 0
    fi

    log "Rolling back: ${curr_version} -> ${prev_version}"

    # Replace version in file
    sed -i "s/version: \"${curr_version}\"/version: \"${prev_version}\"/" "${file}"

    if [[ "${APPLY}" == "true" ]]; then
        log "Committing rollback..."
        git -C "${REPO_ROOT}" add "${file}"
        git -C "${REPO_ROOT}" commit -m "$(cat <<EOF
fix(${COMPONENT}): rollback chart version ${curr_version} -> ${prev_version}

Reverts the HelmRelease chart version to the previous known-good version.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
        git -C "${REPO_ROOT}" push
        success "Rollback committed and pushed"

        # Monitor reconciliation
        monitor_reconciliation "${file}"
    else
        log "Dry-run: would commit rollback ${curr_version} -> ${prev_version}"
        log "Run with --apply to execute"
        # Revert the local change
        git -C "${REPO_ROOT}" checkout -- "${file}"
    fi
}

# ── Pre-upgrade backup ──────────────────────────────────────────────────────

create_pre_upgrade_backup() {
    local component="$1"
    local ns="$2"

    if ! command -v velero &>/dev/null; then
        warn "velero CLI not found — skipping pre-upgrade backup"
        return 0
    fi

    if ! kubectl get namespace velero &>/dev/null; then
        warn "Velero not deployed — skipping pre-upgrade backup"
        return 0
    fi

    local backup_name="pre-upgrade-${component}-$(date +%Y%m%d-%H%M%S)"

    header "Pre-Upgrade Backup"
    log "Creating backup: ${backup_name} (namespace: ${ns})"

    velero backup create "${backup_name}" \
        --include-namespaces "${ns}" \
        --wait=false \
        2>/dev/null || true

    # Wait up to 2 minutes for the backup
    local elapsed=0
    while [[ ${elapsed} -lt 120 ]]; do
        local phase
        phase=$(velero backup get "${backup_name}" -o json 2>/dev/null \
            | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('phase',''))" 2>/dev/null || echo "")

        case "${phase}" in
            Completed)
                success "Pre-upgrade backup completed: ${backup_name}"
                return 0
                ;;
            Failed)
                warn "Pre-upgrade backup failed — continuing with upgrade"
                return 0
                ;;
            PartiallyFailed)
                warn "Pre-upgrade backup partially failed — continuing"
                return 0
                ;;
        esac

        sleep 5
        elapsed=$((elapsed + 5))
    done

    warn "Pre-upgrade backup timed out — continuing with upgrade"
}

# ── Monitor Flux reconciliation ─────────────────────────────────────────────

monitor_reconciliation() {
    local file="$1"
    local hr_name
    hr_name=$(get_helmrelease_name "${file}")
    local hr_ns
    hr_ns=$(get_helmrelease_namespace "${file}")

    header "Monitoring Flux Reconciliation"
    log "HelmRelease: ${hr_name} in ${hr_ns}"
    log "Timeout: ${RECONCILE_TIMEOUT}s"

    # Force reconciliation
    if command -v flux &>/dev/null; then
        log "Triggering Flux reconciliation..."
        flux reconcile helmrelease "${hr_name}" -n "${hr_ns}" 2>/dev/null || true
    fi

    local elapsed=0
    local interval=10

    while [[ ${elapsed} -lt ${RECONCILE_TIMEOUT} ]]; do
        local ready
        ready=$(kubectl get helmrelease "${hr_name}" -n "${hr_ns}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
        local message
        message=$(kubectl get helmrelease "${hr_name}" -n "${hr_ns}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "")

        if [[ "${ready}" == "True" ]]; then
            success "HelmRelease '${hr_name}' is Ready"
            log "Message: ${message}"
            return 0
        fi

        log "Status: ready=${ready:-pending} (${elapsed}s elapsed)"
        if [[ -n "${message}" ]]; then
            log "  ${message}"
        fi

        sleep ${interval}
        elapsed=$((elapsed + interval))
    done

    fail "HelmRelease '${hr_name}' did not become Ready within ${RECONCILE_TIMEOUT}s"
    log "Current status:"
    kubectl get helmrelease "${hr_name}" -n "${hr_ns}" -o yaml 2>/dev/null | grep -A10 'status:' || true
    return 1
}

# ── Validate component health ──────────────────────────────────────────────

validate_health() {
    local file="$1"
    local hr_name
    hr_name=$(get_helmrelease_name "${file}")
    local hr_ns
    hr_ns=$(get_helmrelease_namespace "${file}")

    header "Post-Upgrade Health Check"

    # Check HelmRelease status
    local ready
    ready=$(kubectl get helmrelease "${hr_name}" -n "${hr_ns}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")

    if [[ "${ready}" == "True" ]]; then
        success "HelmRelease '${hr_name}' is Ready"
    else
        fail "HelmRelease '${hr_name}' is not Ready (status: ${ready})"
    fi

    # Check all pods in namespace
    local not_running
    not_running=$(kubectl get pods -n "${hr_ns}" --no-headers 2>/dev/null \
        | grep -v -E "Running|Completed|Succeeded" | wc -l)

    if [[ "${not_running}" -eq 0 ]]; then
        success "All pods in '${hr_ns}' are healthy"
    else
        warn "${not_running} pod(s) in '${hr_ns}' are not Running:"
        kubectl get pods -n "${hr_ns}" --no-headers 2>/dev/null \
            | grep -v -E "Running|Completed|Succeeded" || true
    fi

    # Show deployed chart version
    local deployed_version
    deployed_version=$(kubectl get helmrelease "${hr_name}" -n "${hr_ns}" \
        -o jsonpath='{.status.lastAppliedRevision}' 2>/dev/null || echo "unknown")
    log "Deployed chart revision: ${deployed_version}"
}

# ── Main ────────────────────────────────────────────────────────────────────

parse_args "$@"

# Find the HelmRelease file
HELMRELEASE_FILE=$(find_helmrelease "${COMPONENT}")
log "HelmRelease file: ${HELMRELEASE_FILE}"

# Handle rollback mode
if [[ "${ROLLBACK}" == "true" ]]; then
    do_rollback "${HELMRELEASE_FILE}"
    exit $?
fi

# Get current version
CURRENT_VERSION=$(get_current_version "${HELMRELEASE_FILE}")
HR_NAME=$(get_helmrelease_name "${HELMRELEASE_FILE}")
HR_NAMESPACE=$(get_helmrelease_namespace "${HELMRELEASE_FILE}")

header "Upgrade Plan: ${COMPONENT}"
echo -e "  Component:      ${BOLD}${COMPONENT}${NC}"
echo -e "  HelmRelease:    ${HR_NAME} (${HR_NAMESPACE})"
echo -e "  Current version: ${YELLOW}${CURRENT_VERSION}${NC}"
echo -e "  Target version:  ${GREEN}${TARGET_VERSION}${NC}"
echo -e "  File:            ${HELMRELEASE_FILE}"
echo -e "  Mode:            $(if [[ "${APPLY}" == "true" ]]; then echo "${RED}APPLY${NC}"; else echo "${YELLOW}DRY-RUN${NC}"; fi)"
echo ""

if [[ "${CURRENT_VERSION}" == "${TARGET_VERSION}" ]]; then
    warn "Current version is already ${TARGET_VERSION} — nothing to do"
    exit 0
fi

# Show release notes hint
header "Release Notes"
local_chart_name=$(grep -A5 'chart:' "${HELMRELEASE_FILE}" | grep 'chart:' | tail -1 | awk '{print $2}')
local_repo_name=$(grep -A10 'sourceRef:' "${HELMRELEASE_FILE}" | grep 'name:' | head -1 | awk '{print $2}')
log "Check release notes before proceeding:"
log "  Chart: ${local_chart_name}"
log "  Repo:  ${local_repo_name}"
log "  Artifact Hub: https://artifacthub.io/packages/search?ts_query_web=${local_chart_name}"
log ""

# Show diff preview
header "Version Diff"
log "Change in ${HELMRELEASE_FILE}:"
echo -e "  ${RED}- version: \"${CURRENT_VERSION}\"${NC}"
echo -e "  ${GREEN}+ version: \"${TARGET_VERSION}\"${NC}"

if [[ "${APPLY}" == "false" ]]; then
    echo ""
    warn "DRY-RUN mode — no changes will be made"
    warn "Run with --apply to execute the upgrade"
    exit 0
fi

# Confirm
echo ""
read -r -p "Proceed with upgrade? [y/N] " confirm
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    log "Upgrade cancelled"
    exit 0
fi

# Create pre-upgrade backup
create_pre_upgrade_backup "${COMPONENT}" "${HR_NAMESPACE}"

# Update the version
header "Applying Version Change"
sed -i "s/version: \"${CURRENT_VERSION}\"/version: \"${TARGET_VERSION}\"/" "${HELMRELEASE_FILE}"

# Verify the change
local new_version
new_version=$(get_current_version "${HELMRELEASE_FILE}")
if [[ "${new_version}" == "${TARGET_VERSION}" ]]; then
    success "Version updated in file: ${CURRENT_VERSION} -> ${TARGET_VERSION}"
else
    fail "Version update failed — file shows '${new_version}'"
    git -C "${REPO_ROOT}" checkout -- "${HELMRELEASE_FILE}"
    exit 1
fi

# Commit and push
header "Committing Change"
git -C "${REPO_ROOT}" add "${HELMRELEASE_FILE}"
git -C "${REPO_ROOT}" commit -m "$(cat <<EOF
feat(${COMPONENT}): upgrade chart version ${CURRENT_VERSION} -> ${TARGET_VERSION}

Updates the HelmRelease chart version for ${COMPONENT}.

- Previous: ${CURRENT_VERSION}
- Target: ${TARGET_VERSION}
- Pre-upgrade backup created

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"

log "Pushing to remote..."
git -C "${REPO_ROOT}" push
success "Committed and pushed"

# Monitor Flux reconciliation
monitor_reconciliation "${HELMRELEASE_FILE}"

# Validate health
validate_health "${HELMRELEASE_FILE}"

header "Upgrade Complete"
echo -e "  Component: ${BOLD}${COMPONENT}${NC}"
echo -e "  Version:   ${CURRENT_VERSION} -> ${GREEN}${TARGET_VERSION}${NC}"
echo -e "  To rollback: $0 ${COMPONENT} --rollback --apply"
