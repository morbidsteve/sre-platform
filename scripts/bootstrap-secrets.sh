#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Bootstrap Secrets
# ============================================================================
# Generates random passwords and creates K8s Secrets for platform components.
# Idempotent — skips secrets that already exist.
#
# Usage:
#   ./scripts/bootstrap-secrets.sh
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - openssl available for password generation
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

log()     { echo -e "${BLUE}[secrets]${NC} $*"; }
success() { echo -e "${GREEN}[secrets]${NC} $*"; }
warn()    { echo -e "${YELLOW}[secrets]${NC} $*"; }
error()   { echo -e "${RED}[secrets]${NC} $*" >&2; }

# Generate a random password
gen_password() {
    openssl rand -base64 24 | tr -d '/+=' | head -c 24
}

# Create a K8s Secret if it doesn't already exist
# Usage: create_secret <namespace> <secret-name> <key>=<value> [<key>=<value>...]
create_secret() {
    local namespace="$1"
    local name="$2"
    shift 2

    # Ensure namespace exists
    kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

    if kubectl get secret "$name" -n "$namespace" > /dev/null 2>&1; then
        warn "Secret $namespace/$name already exists — skipping."
        return 0
    fi

    local args=()
    for kv in "$@"; do
        args+=("--from-literal=$kv")
    done

    kubectl create secret generic "$name" -n "$namespace" "${args[@]}"
    success "Created secret: $namespace/$name"
}

# ============================================================================
# Generate Passwords
# ============================================================================

echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Bootstrap Secrets ═══${NC}\n"

GRAFANA_PASS=$(gen_password)
KEYCLOAK_PASS=$(gen_password)
HARBOR_PASS=$(gen_password)
HARBOR_SECRET_KEY=$(gen_password)

# ============================================================================
# Create Secrets
# ============================================================================

log "Creating platform secrets..."
echo

# Grafana admin password
# kube-prometheus-stack expects: adminPassword key in a secret
create_secret monitoring grafana-admin-credentials \
    "adminPassword=$GRAFANA_PASS"

# Keycloak admin password
# Bitnami Keycloak chart expects: admin-password key
create_secret keycloak keycloak-admin-credentials \
    "admin-password=$KEYCLOAK_PASS"

# Harbor admin password and secret key
# Harbor chart expects: HARBOR_ADMIN_PASSWORD and secretKey
create_secret harbor harbor-credentials \
    "HARBOR_ADMIN_PASSWORD=$HARBOR_PASS" \
    "secretKey=$HARBOR_SECRET_KEY"

# ============================================================================
# Summary
# ============================================================================

echo
echo -e "${BOLD}${CYAN}═══ Generated Credentials ═══${NC}"
echo
echo -e "  ${BOLD}Grafana:${NC}"
echo -e "    Username: admin"
echo -e "    Password: $GRAFANA_PASS"
echo
echo -e "  ${BOLD}Keycloak:${NC}"
echo -e "    Username: admin"
echo -e "    Password: $KEYCLOAK_PASS"
echo
echo -e "  ${BOLD}Harbor:${NC}"
echo -e "    Username: admin"
echo -e "    Password: $HARBOR_PASS"
echo
echo -e "${YELLOW}  IMPORTANT: Save these credentials now. They cannot be retrieved later.${NC}"
echo -e "${YELLOW}  Store them in a password manager or secrets vault.${NC}"
echo

success "Bootstrap secrets created."
