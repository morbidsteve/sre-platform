#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Initialize OpenBao
# ============================================================================
# Detects OpenBao deployment mode and initializes + unseals as needed.
#
# Modes:
#   - dev:        Auto-initialized, auto-unsealed. Skips init.
#   - standalone: Single pod with Raft storage. Init + unseal one pod.
#   - ha:         Multi-pod Raft cluster. Init leader, unseal all replicas.
#
# Idempotent — checks if already initialized via `bao status`.
#
# Usage:
#   ./scripts/init-openbao.sh
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - jq available for JSON parsing
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

log()     { echo -e "${BLUE}[openbao]${NC} $*"; }
success() { echo -e "${GREEN}[openbao]${NC} $*"; }
warn()    { echo -e "${YELLOW}[openbao]${NC} $*"; }
error()   { echo -e "${RED}[openbao]${NC} $*" >&2; }
fatal()   { error "$*"; exit 1; }

NAMESPACE="openbao"

# ============================================================================
# Detect Deployment Mode
# ============================================================================

echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Initialize OpenBao ═══${NC}\n"

# Wait for at least one OpenBao pod to exist
log "Waiting for OpenBao pods..."
WAIT_ELAPSED=0
while true; do
    POD_COUNT=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=openbao --no-headers 2>/dev/null | wc -l || echo "0")
    if (( POD_COUNT > 0 )); then
        break
    fi
    if (( WAIT_ELAPSED >= 300 )); then
        fatal "No OpenBao pods found after 300s. Is the HelmRelease deployed?"
    fi
    sleep 10
    WAIT_ELAPSED=$((WAIT_ELAPSED + 10))
    printf "\r  Waiting for pods... (%ds)" "$WAIT_ELAPSED"
done
echo

# Detect mode from pod labels and count
OPENBAO_PODS=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=openbao -o jsonpath='{.items[*].metadata.name}')
POD_ARRAY=($OPENBAO_PODS)
POD_COUNT=${#POD_ARRAY[@]}

# Check if dev mode by inspecting env vars on the first pod
DEV_MODE=$(kubectl get pod "${POD_ARRAY[0]}" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].env[?(@.name=="VAULT_DEV_ROOT_TOKEN_ID")].value}' 2>/dev/null || echo "")

if [[ -n "$DEV_MODE" ]]; then
    MODE="dev"
elif (( POD_COUNT == 1 )); then
    MODE="standalone"
else
    MODE="ha"
fi

log "Detected mode: ${BOLD}$MODE${NC} ($POD_COUNT pod(s))"

# ============================================================================
# Dev Mode — Skip init
# ============================================================================

if [[ "$MODE" == "dev" ]]; then
    success "Dev mode — OpenBao is auto-initialized and auto-unsealed."
    log "Root token: root (dev mode default)"

    # Still configure KV v2 and K8s auth if not already done
    LEADER="${POD_ARRAY[0]}"

    log "Enabling KV v2 secrets engine at sre/..."
    kubectl exec -n "$NAMESPACE" "$LEADER" -- bao secrets enable -path=sre kv-v2 2>/dev/null || warn "KV v2 at sre/ already enabled."

    log "Enabling Kubernetes auth method..."
    kubectl exec -n "$NAMESPACE" "$LEADER" -- bao auth enable kubernetes 2>/dev/null || warn "Kubernetes auth already enabled."

    success "OpenBao dev mode ready."
    exit 0
fi

# ============================================================================
# Wait for pods to be Running
# ============================================================================

log "Waiting for all OpenBao pods to be Running..."
for pod in "${POD_ARRAY[@]}"; do
    kubectl wait --for=condition=Ready=false pod/"$pod" -n "$NAMESPACE" --timeout=120s 2>/dev/null || true
done

# ============================================================================
# Check if already initialized
# ============================================================================

LEADER="${POD_ARRAY[0]}"

INIT_STATUS=$(kubectl exec -n "$NAMESPACE" "$LEADER" -- bao status -format=json 2>/dev/null || echo '{"initialized": false}')
IS_INITIALIZED=$(echo "$INIT_STATUS" | jq -r '.initialized // false')

if [[ "$IS_INITIALIZED" == "true" ]]; then
    IS_SEALED=$(echo "$INIT_STATUS" | jq -r '.sealed // true')
    if [[ "$IS_SEALED" == "false" ]]; then
        success "OpenBao is already initialized and unsealed."
        exit 0
    fi
    log "OpenBao is initialized but sealed. Attempting unseal..."

    # Check if unseal keys are stored in a K8s secret
    if kubectl get secret openbao-unseal-keys -n "$NAMESPACE" > /dev/null 2>&1; then
        UNSEAL_KEY=$(kubectl get secret openbao-unseal-keys -n "$NAMESPACE" -o jsonpath='{.data.unseal-key-0}' | base64 -d)
        for pod in "${POD_ARRAY[@]}"; do
            log "Unsealing $pod..."
            kubectl exec -n "$NAMESPACE" "$pod" -- bao operator unseal "$UNSEAL_KEY" > /dev/null 2>&1 || warn "Failed to unseal $pod"
        done
        success "OpenBao unsealed."
    else
        error "No unseal keys found in secret openbao-unseal-keys."
        error "Manually unseal with: kubectl exec -n openbao <pod> -- bao operator unseal <key>"
        exit 1
    fi
    exit 0
fi

# ============================================================================
# Initialize OpenBao
# ============================================================================

log "Initializing OpenBao on $LEADER..."

# Initialize with 1 key share and 1 threshold for simplicity
# Production should use Shamir's Secret Sharing with 5 shares / 3 threshold
INIT_OUTPUT=$(kubectl exec -n "$NAMESPACE" "$LEADER" -- bao operator init \
    -key-shares=1 \
    -key-threshold=1 \
    -format=json 2>&1) || fatal "Failed to initialize OpenBao: $INIT_OUTPUT"

UNSEAL_KEY=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')

if [[ -z "$UNSEAL_KEY" || -z "$ROOT_TOKEN" ]]; then
    fatal "Initialization succeeded but could not parse keys. Output: $INIT_OUTPUT"
fi

success "OpenBao initialized."

# Store unseal keys and root token in K8s Secret
log "Storing unseal keys and root token in K8s Secret..."
kubectl create secret generic openbao-unseal-keys -n "$NAMESPACE" \
    --from-literal="unseal-key-0=$UNSEAL_KEY" \
    --from-literal="root-token=$ROOT_TOKEN" \
    > /dev/null 2>&1
success "Unseal keys stored in secret: $NAMESPACE/openbao-unseal-keys"

# ============================================================================
# Unseal All Pods
# ============================================================================

log "Unsealing all OpenBao pods..."
for pod in "${POD_ARRAY[@]}"; do
    log "Unsealing $pod..."
    kubectl exec -n "$NAMESPACE" "$pod" -- bao operator unseal "$UNSEAL_KEY" > /dev/null 2>&1 || warn "Failed to unseal $pod (may need raft join first)"
done

# For HA mode, join non-leader pods to the Raft cluster
if [[ "$MODE" == "ha" && ${#POD_ARRAY[@]} -gt 1 ]]; then
    log "Joining non-leader pods to Raft cluster..."
    LEADER_ADDR="http://${LEADER}.openbao-internal:8200"
    for pod in "${POD_ARRAY[@]:1}"; do
        log "Joining $pod to Raft cluster..."
        kubectl exec -n "$NAMESPACE" "$pod" -- bao operator raft join "$LEADER_ADDR" 2>/dev/null || warn "$pod may already be joined"
        kubectl exec -n "$NAMESPACE" "$pod" -- bao operator unseal "$UNSEAL_KEY" > /dev/null 2>&1 || warn "Failed to unseal $pod after join"
    done
fi

success "All pods unsealed."

# ============================================================================
# Configure OpenBao
# ============================================================================

log "Configuring OpenBao..."
export BAO_TOKEN="$ROOT_TOKEN"

# Enable KV v2 at sre/ path
log "Enabling KV v2 secrets engine at sre/..."
kubectl exec -n "$NAMESPACE" "$LEADER" -- \
    env "BAO_TOKEN=$ROOT_TOKEN" \
    bao secrets enable -path=sre kv-v2 2>/dev/null || warn "KV v2 at sre/ already enabled."

# Enable Kubernetes auth
log "Enabling Kubernetes auth method..."
kubectl exec -n "$NAMESPACE" "$LEADER" -- \
    env "BAO_TOKEN=$ROOT_TOKEN" \
    bao auth enable kubernetes 2>/dev/null || warn "Kubernetes auth already enabled."

# Configure Kubernetes auth
log "Configuring Kubernetes auth method..."
kubectl exec -n "$NAMESPACE" "$LEADER" -- \
    env "BAO_TOKEN=$ROOT_TOKEN" \
    bao write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc:443" 2>/dev/null || warn "Kubernetes auth config may already exist."

# Create ESO policy
log "Creating external-secrets-operator policy..."
kubectl exec -n "$NAMESPACE" "$LEADER" -- sh -c "
    export BAO_TOKEN='$ROOT_TOKEN'
    bao policy write eso-policy - <<'POLICY'
path \"sre/*\" {
  capabilities = [\"read\", \"list\"]
}
POLICY
" 2>/dev/null || warn "ESO policy may already exist."

# Create ESO role
log "Creating external-secrets-operator Kubernetes auth role..."
kubectl exec -n "$NAMESPACE" "$LEADER" -- \
    env "BAO_TOKEN=$ROOT_TOKEN" \
    bao write auth/kubernetes/role/eso-role \
    bound_service_account_names=external-secrets \
    bound_service_account_namespaces=external-secrets \
    policies=eso-policy \
    ttl=1h 2>/dev/null || warn "ESO role may already exist."

# ============================================================================
# Summary
# ============================================================================

echo
echo -e "${BOLD}${CYAN}═══ OpenBao Initialized ═══${NC}"
echo
echo -e "  ${BOLD}Mode:${NC}         $MODE"
echo -e "  ${BOLD}Root Token:${NC}   $ROOT_TOKEN"
echo -e "  ${BOLD}Unseal Key:${NC}   $UNSEAL_KEY"
echo -e "  ${BOLD}Secrets:${NC}      KV v2 enabled at sre/"
echo -e "  ${BOLD}Auth:${NC}         Kubernetes auth enabled"
echo -e "  ${BOLD}ESO Role:${NC}     eso-role (external-secrets SA)"
echo
echo -e "${YELLOW}  IMPORTANT: Save the root token and unseal key.${NC}"
echo -e "${YELLOW}  They are stored in K8s Secret: $NAMESPACE/openbao-unseal-keys${NC}"
echo

success "OpenBao initialization complete."
