#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Secret Rotation Script
# ============================================================================
# Rotates credentials for platform components. Supports individual component
# rotation or rotating all secrets at once.
#
# Usage:
#   ./scripts/rotate-secrets.sh --component harbor          # Rotate Harbor robot
#   ./scripts/rotate-secrets.sh --component keycloak         # Rotate Keycloak admin
#   ./scripts/rotate-secrets.sh --component cosign           # Rotate Cosign key pair
#   ./scripts/rotate-secrets.sh --component all              # Rotate everything
#   ./scripts/rotate-secrets.sh --component harbor --dry-run # Preview changes only
#
# NIST Controls: IA-5 (Authenticator Management), SC-12 (Cryptographic Key Mgmt)
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

# ── Logging ─────────────────────────────────────────────────────────────────
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOGFILE="/tmp/rotate-secrets-${TIMESTAMP}.log"

log()     { echo -e "${BLUE}[rotate]${NC} $*" | tee -a "$LOGFILE"; }
success() { echo -e "${GREEN}  OK${NC} $*" | tee -a "$LOGFILE"; }
warn()    { echo -e "${YELLOW}  WARN${NC} $*" | tee -a "$LOGFILE"; }
fail()    { echo -e "${RED}  FAIL${NC} $*" | tee -a "$LOGFILE"; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n" | tee -a "$LOGFILE"; }

# ── Configuration ───────────────────────────────────────────────────────────
DRY_RUN=false
COMPONENT=""
HARBOR_URL="${HARBOR_URL:-https://harbor.apps.sre.example.com}"
HARBOR_ADMIN_USER="${HARBOR_ADMIN_USER:-admin}"
HARBOR_ADMIN_PASS="${HARBOR_ADMIN_PASS:-Harbor12345}"
KEYCLOAK_URL="${KEYCLOAK_URL:-https://keycloak.apps.sre.example.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-sre}"

# ── Usage ───────────────────────────────────────────────────────────────────
usage() {
    echo "Usage: $0 --component <harbor|keycloak|cosign|all> [--dry-run]"
    echo ""
    echo "Options:"
    echo "  --component <name>  Component to rotate (harbor, keycloak, cosign, all)"
    echo "  --dry-run           Preview changes without executing them"
    echo "  -h, --help          Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 --component harbor              # Rotate Harbor robot credentials"
    echo "  $0 --component all --dry-run        # Preview all rotations"
    exit 1
}

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --component) COMPONENT="$2"; shift 2 ;;
        --dry-run)   DRY_RUN=true; shift ;;
        -h|--help)   usage ;;
        *)           echo "Unknown option: $1" >&2; usage ;;
    esac
done

if [[ -z "$COMPONENT" ]]; then
    echo "ERROR: --component is required" >&2
    usage
fi

# ── Prerequisite checks ────────────────────────────────────────────────────
check_prerequisites() {
    header "Prerequisite Checks"

    if ! command -v kubectl &>/dev/null; then
        fail "kubectl not found in PATH"
        exit 1
    fi
    success "kubectl found"

    if ! kubectl cluster-info &>/dev/null; then
        fail "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    success "Cluster connection OK"

    if [[ "$DRY_RUN" == true ]]; then
        warn "DRY RUN MODE — no changes will be made"
    fi
}

# ── Generate random password ───────────────────────────────────────────────
generate_password() {
    local length="${1:-32}"
    openssl rand -base64 "$length" | tr -d '/+=' | head -c "$length"
}

# ── Rotate Harbor robot account ────────────────────────────────────────────
rotate_harbor_robot() {
    header "Rotating Harbor Robot Account Credentials"

    local robot_name="robot\$ci-push"

    log "Checking existing robot accounts in Harbor..."

    # List robot accounts
    local robots
    robots=$(curl -sk -u "${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}" \
        "${HARBOR_URL}/api/v2.0/robots" 2>/dev/null || echo "[]")

    local robot_id
    robot_id=$(echo "$robots" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data:
    if r.get('name') == 'robot\$ci-push':
        print(r['id'])
        break
" 2>/dev/null || echo "")

    if [[ -z "$robot_id" ]]; then
        warn "Robot account 'ci-push' not found in Harbor — skipping"
        return
    fi

    log "Found robot account ID: ${robot_id}"

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would regenerate secret for robot account ${robot_id}"
        log "[DRY RUN] Would update Kubernetes secrets in affected namespaces"
        return
    fi

    # Regenerate the robot account secret
    local new_secret_response
    new_secret_response=$(curl -sk -X PATCH \
        -u "${HARBOR_ADMIN_USER}:${HARBOR_ADMIN_PASS}" \
        -H "Content-Type: application/json" \
        -d '{"secret": ""}' \
        "${HARBOR_URL}/api/v2.0/robots/${robot_id}" 2>/dev/null)

    local new_secret
    new_secret=$(echo "$new_secret_response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('secret', ''))
" 2>/dev/null || echo "")

    if [[ -z "$new_secret" ]]; then
        fail "Failed to regenerate Harbor robot secret"
        log "Response: ${new_secret_response}"
        return
    fi

    success "Harbor robot secret regenerated"

    # Update Kubernetes secrets in all namespaces that have harbor pull secrets
    log "Updating Kubernetes pull secrets in affected namespaces..."
    local namespaces
    namespaces=$(kubectl get secrets -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
seen = set()
for item in data.get('items', []):
    name = item['metadata'].get('name', '')
    ns = item['metadata'].get('namespace', '')
    if 'harbor' in name.lower() and item.get('type') == 'kubernetes.io/dockerconfigjson':
        if ns not in seen:
            seen.add(ns)
            print(ns)
" 2>/dev/null || echo "")

    for ns in $namespaces; do
        kubectl create secret docker-registry harbor-pull-secret \
            -n "$ns" \
            --docker-server=harbor.apps.sre.example.com \
            --docker-username="${robot_name}" \
            --docker-password="${new_secret}" \
            --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null
        success "Updated harbor-pull-secret in namespace ${ns}"
    done

    log "New robot secret: ${new_secret}"
    warn "Store the new secret securely — it will not be shown again"
}

# ── Rotate Cosign key pair ─────────────────────────────────────────────────
rotate_cosign_key() {
    header "Rotating Cosign Signing Key Pair"

    if ! command -v cosign &>/dev/null; then
        fail "cosign CLI not found in PATH — install cosign first"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would generate a new Cosign key pair"
        log "[DRY RUN] Would update the cosign-keys secret in the sre-builds namespace"
        log "[DRY RUN] Would update Kyverno verify-image-signatures policy with new public key"
        return
    fi

    local tmpdir
    tmpdir=$(mktemp -d)
    trap "rm -rf ${tmpdir}" RETURN

    log "Generating new Cosign key pair..."
    COSIGN_PASSWORD="" cosign generate-key-pair --output-key-prefix="${tmpdir}/cosign" 2>/dev/null

    if [[ ! -f "${tmpdir}/cosign.key" ]] || [[ ! -f "${tmpdir}/cosign.pub" ]]; then
        fail "Failed to generate Cosign key pair"
        return
    fi

    success "New Cosign key pair generated"

    # Update the Kubernetes secret
    log "Updating cosign-keys secret in sre-builds namespace..."
    kubectl create secret generic cosign-keys \
        -n sre-builds \
        --from-file=cosign.key="${tmpdir}/cosign.key" \
        --from-file=cosign.pub="${tmpdir}/cosign.pub" \
        --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null

    success "cosign-keys secret updated in sre-builds namespace"

    # Display the new public key for updating Kyverno policy
    log "New public key (update Kyverno verify-image-signatures policy):"
    cat "${tmpdir}/cosign.pub" | tee -a "$LOGFILE"
    echo ""
    warn "You MUST update the Kyverno verify-image-signatures policy with the new public key"
    warn "Update: policies/custom/verify-image-signatures.yaml"
}

# ── Rotate Keycloak admin password ─────────────────────────────────────────
rotate_keycloak_admin() {
    header "Rotating Keycloak Admin Password"

    log "Checking Keycloak availability..."

    # Get admin token with current password
    local current_pass
    current_pass=$(kubectl get secret -n keycloak keycloak-admin-credentials \
        -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

    if [[ -z "$current_pass" ]]; then
        warn "Could not read current admin password from keycloak-admin-credentials secret"
        current_pass="${KEYCLOAK_ADMIN_PASS:-admin}"
        log "Falling back to default/env password"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would generate new admin password"
        log "[DRY RUN] Would update Keycloak admin password via API"
        log "[DRY RUN] Would update keycloak-admin-credentials Kubernetes secret"
        return
    fi

    local new_pass
    new_pass=$(generate_password 24)

    # Get admin token
    local token
    token=$(curl -sk -X POST \
        "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "username=admin" \
        -d "password=${current_pass}" \
        -d "grant_type=password" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('access_token', ''))
" 2>/dev/null || echo "")

    if [[ -z "$token" ]]; then
        fail "Could not authenticate to Keycloak — check current admin password"
        return
    fi

    success "Authenticated to Keycloak"

    # Get admin user ID
    local admin_id
    admin_id=$(curl -sk -H "Authorization: Bearer ${token}" \
        "${KEYCLOAK_URL}/admin/realms/master/users?username=admin" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for u in data:
    if u.get('username') == 'admin':
        print(u['id'])
        break
" 2>/dev/null || echo "")

    if [[ -z "$admin_id" ]]; then
        fail "Could not find admin user in Keycloak"
        return
    fi

    # Update the password
    local status
    status=$(curl -sk -o /dev/null -w "%{http_code}" -X PUT \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"password\",\"temporary\":false,\"value\":\"${new_pass}\"}" \
        "${KEYCLOAK_URL}/admin/realms/master/users/${admin_id}/reset-password" 2>/dev/null)

    if [[ "$status" == "204" ]]; then
        success "Keycloak admin password updated"
    else
        fail "Failed to update Keycloak admin password (HTTP ${status})"
        return
    fi

    # Update Kubernetes secret
    kubectl create secret generic keycloak-admin-credentials \
        -n keycloak \
        --from-literal=admin-password="${new_pass}" \
        --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null

    success "keycloak-admin-credentials secret updated"

    log "New admin password: ${new_pass}"
    warn "Store the new password securely — update any documentation or automation"
}

# ── Main ────────────────────────────────────────────────────────────────────
echo "Secret rotation log: ${LOGFILE}" | tee "$LOGFILE"
echo "Started: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$LOGFILE"

check_prerequisites

case "$COMPONENT" in
    harbor)
        rotate_harbor_robot
        ;;
    cosign)
        rotate_cosign_key
        ;;
    keycloak)
        rotate_keycloak_admin
        ;;
    all)
        rotate_harbor_robot
        rotate_cosign_key
        rotate_keycloak_admin
        ;;
    *)
        echo "ERROR: Unknown component '${COMPONENT}'" >&2
        echo "Valid components: harbor, keycloak, cosign, all" >&2
        exit 1
        ;;
esac

header "Rotation Complete"
log "Log file: ${LOGFILE}"

if [[ "$DRY_RUN" == true ]]; then
    warn "DRY RUN — no changes were made. Re-run without --dry-run to execute."
fi
