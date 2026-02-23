#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Verify Deployment
# ============================================================================
# Validates that all platform components are deployed and healthy.
#
# Checks:
#   - All HelmReleases are Ready
#   - All pods are Running (no CrashLoopBackOff)
#   - Istio Gateway responds
#   - VirtualService endpoints accessible
#   - cert-manager Certificate is Ready
#
# Usage:
#   ./scripts/verify-deployment.sh [--domain <domain>]
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - curl available for HTTP checks
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

log()     { echo -e "${BLUE}[verify]${NC} $*"; }
success() { echo -e "${GREEN}  ✓${NC} $*"; }
fail()    { echo -e "${RED}  ✗${NC} $*"; FAILURES=$((FAILURES + 1)); }
warn()    { echo -e "${YELLOW}  !${NC} $*"; }

FAILURES=0
CHECKS=0

check() {
    CHECKS=$((CHECKS + 1))
}

# ── Parse args ──────────────────────────────────────────────────────────────

SRE_DOMAIN="${SRE_DOMAIN:-}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) SRE_DOMAIN="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# ============================================================================
# Check HelmReleases
# ============================================================================

echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Deployment Verification ═══${NC}\n"

log "Checking HelmReleases..."
echo

if command -v flux &>/dev/null; then
    # Use flux CLI if available
    while IFS= read -r line; do
        check
        name=$(echo "$line" | awk '{print $2}')
        ns=$(echo "$line" | awk '{print $1}')
        ready=$(echo "$line" | awk '{print $3}')
        if [[ "$ready" == "True" ]]; then
            success "HelmRelease $ns/$name"
        else
            fail "HelmRelease $ns/$name — not Ready"
        fi
    done < <(flux get helmreleases -A --no-header 2>/dev/null || true)
else
    # Fall back to kubectl
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        check
        ns=$(echo "$line" | awk '{print $1}')
        name=$(echo "$line" | awk '{print $2}')
        ready=$(echo "$line" | awk '{print $3}')
        if [[ "$ready" == "True" ]]; then
            success "HelmRelease $ns/$name"
        else
            fail "HelmRelease $ns/$name — not Ready"
        fi
    done < <(kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status' --no-headers 2>/dev/null || true)
fi

# ============================================================================
# Check Pods
# ============================================================================

echo
log "Checking for unhealthy pods..."
echo

PLATFORM_NS="istio-system cert-manager kyverno monitoring logging openbao external-secrets neuvector tempo velero harbor keycloak flux-system"
UNHEALTHY=0

for ns in $PLATFORM_NS; do
    if ! kubectl get namespace "$ns" > /dev/null 2>&1; then
        continue
    fi

    CRASHLOOP=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | grep -c "CrashLoopBackOff\|Error\|ImagePullBackOff" || true)
    NOT_READY=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | grep -v "Running\|Completed" | grep -c "" || true)

    check
    if (( CRASHLOOP > 0 )); then
        fail "Namespace $ns: $CRASHLOOP pod(s) in CrashLoop/Error state"
        UNHEALTHY=$((UNHEALTHY + CRASHLOOP))
    elif (( NOT_READY > 0 )); then
        warn "Namespace $ns: $NOT_READY pod(s) not yet Running"
    else
        success "Namespace $ns: all pods healthy"
    fi
done

# ============================================================================
# Check Certificate
# ============================================================================

echo
log "Checking TLS certificates..."
echo

check
CERT_READY=$(kubectl get certificate sre-wildcard-tls -n istio-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
if [[ "$CERT_READY" == "True" ]]; then
    success "Certificate istio-system/sre-wildcard-tls is Ready"
else
    fail "Certificate istio-system/sre-wildcard-tls is not Ready (status: $CERT_READY)"
fi

# ============================================================================
# Check Istio Gateway
# ============================================================================

echo
log "Checking Istio Gateway..."
echo

check
GW_EXISTS=$(kubectl get gateway main -n istio-system -o name 2>/dev/null || echo "")
if [[ -n "$GW_EXISTS" ]]; then
    success "Istio Gateway istio-system/main exists"
else
    fail "Istio Gateway istio-system/main not found"
fi

# ============================================================================
# Check VirtualServices
# ============================================================================

echo
log "Checking VirtualServices..."
echo

for vs_info in \
    "monitoring/grafana" \
    "openbao/openbao" \
    "neuvector/neuvector" \
    "harbor/harbor" \
    "keycloak/keycloak"; do

    ns="${vs_info%%/*}"
    name="${vs_info##*/}"
    check
    if kubectl get virtualservice "$name" -n "$ns" > /dev/null 2>&1; then
        success "VirtualService $ns/$name"
    else
        fail "VirtualService $ns/$name not found"
    fi
done

# ============================================================================
# Check HTTP endpoints (if domain is configured)
# ============================================================================

if [[ -n "$SRE_DOMAIN" ]]; then
    echo
    log "Checking HTTPS endpoints at $SRE_DOMAIN..."
    echo

    # Find the Istio gateway service IP/port
    GW_IP=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    GW_NODEPORT=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")

    if [[ -n "$GW_IP" ]]; then
        TARGET="$GW_IP:443"
    elif [[ -n "$GW_NODEPORT" ]]; then
        # Use first node IP
        NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "127.0.0.1")
        TARGET="$NODE_IP:$GW_NODEPORT"
    else
        warn "Could not determine Istio gateway address. Skipping HTTP checks."
        TARGET=""
    fi

    if [[ -n "$TARGET" ]]; then
        for endpoint in grafana openbao neuvector harbor keycloak; do
            check
            HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" \
                --resolve "${endpoint}.${SRE_DOMAIN}:443:${TARGET%%:*}" \
                "https://${endpoint}.${SRE_DOMAIN}:${TARGET##*:}/" \
                --connect-timeout 5 --max-time 10 2>/dev/null || echo "000")

            if [[ "$HTTP_CODE" =~ ^(200|301|302|303|307|308)$ ]]; then
                success "https://${endpoint}.${SRE_DOMAIN} — HTTP $HTTP_CODE"
            elif [[ "$HTTP_CODE" == "000" ]]; then
                fail "https://${endpoint}.${SRE_DOMAIN} — connection failed"
            else
                warn "https://${endpoint}.${SRE_DOMAIN} — HTTP $HTTP_CODE"
            fi
        done
    fi
fi

# ============================================================================
# Summary
# ============================================================================

echo
echo -e "${BOLD}${CYAN}═══ Verification Summary ═══${NC}"
echo
PASSED=$((CHECKS - FAILURES))
echo -e "  ${BOLD}Total checks:${NC}  $CHECKS"
echo -e "  ${GREEN}Passed:${NC}        $PASSED"
if (( FAILURES > 0 )); then
    echo -e "  ${RED}Failed:${NC}        $FAILURES"
    echo
    exit 1
else
    echo -e "  ${RED}Failed:${NC}        0"
    echo
    success "All checks passed."
    exit 0
fi
