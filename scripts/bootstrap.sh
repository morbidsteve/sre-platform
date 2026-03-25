#!/usr/bin/env bash
set -euo pipefail

# Bootstrap SRE Platform on a fresh RKE2 cluster
# Usage: ./scripts/bootstrap.sh
# Prerequisites: kubectl configured, GITHUB_TOKEN env var set

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/colors.sh" 2>/dev/null || true

GITHUB_OWNER="${GITHUB_OWNER:-morbidsteve}"
GITHUB_REPO="${GITHUB_REPO:-sre-platform}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
SRE_DOMAIN="${SRE_DOMAIN:-apps.sre.example.com}"

info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*"; }
error() { echo "[ERROR] $*" >&2; }

echo "============================================"
echo "  SRE Platform Bootstrap"
echo "============================================"
echo ""
echo "  Repo: ${GITHUB_OWNER}/${GITHUB_REPO}"
echo "  Branch: ${GITHUB_BRANCH}"
echo "  Domain: ${SRE_DOMAIN}"
echo ""

# Step 1: Check prerequisites
info "[1/6] Checking prerequisites..."
command -v kubectl >/dev/null 2>&1 || { error "kubectl not found"; exit 1; }
command -v flux >/dev/null 2>&1 || {
  info "Installing Flux CLI..."
  curl -s https://fluxcd.io/install.sh | bash
}

info "Running Flux pre-checks..."
flux check --pre || { error "Flux prerequisites not met"; exit 1; }

# Step 2: Bootstrap Flux
info "[2/6] Bootstrapping Flux CD..."
flux bootstrap github \
  --owner="${GITHUB_OWNER}" \
  --repository="${GITHUB_REPO}" \
  --branch="${GITHUB_BRANCH}" \
  --path=platform/flux-system \
  --personal \
  --token-auth

# Step 3: Wait for core platform
info "[3/6] Waiting for core platform services (this may take 10-15 minutes)..."
kubectl wait --for=condition=ready kustomization/flux-system -n flux-system --timeout=120s || true

# Wait for key services
for ks in sre-istio sre-cert-manager sre-kyverno sre-monitoring; do
  info "  Waiting for $ks..."
  kubectl wait --for=condition=ready kustomization/$ks -n flux-system --timeout=600s 2>/dev/null || warn "$ks not ready yet"
done

# Step 4: Verify health
info "[4/6] Verifying platform health..."
flux get kustomizations -A 2>&1 | head -30

# Step 5: Run post-bootstrap setup
info "[5/6] Running post-bootstrap configuration..."
if [ -f "$SCRIPT_DIR/sre-deploy.sh" ]; then
  info "  Running sre-deploy.sh for post-bootstrap setup..."
  bash "$SCRIPT_DIR/sre-deploy.sh" 2>&1 | tail -5 || warn "Post-bootstrap setup had warnings"
fi

# Step 6: Summary
info "[6/6] Bootstrap complete!"
echo ""
echo "============================================"
echo "  Platform URLs"
echo "============================================"
echo "  Dashboard:  https://dashboard.${SRE_DOMAIN}"
echo "  Grafana:    https://grafana.${SRE_DOMAIN}"
echo "  Harbor:     https://harbor.${SRE_DOMAIN}"
echo "  Keycloak:   https://keycloak.${SRE_DOMAIN}"
echo ""
echo "  Next steps:"
echo "  1. Configure DNS or /etc/hosts for *.${SRE_DOMAIN}"
echo "  2. Run: ./scripts/configure-keycloak-sso.sh"
echo "  3. Create your first tenant: ./scripts/onboard-tenant.sh my-team"
echo "============================================"
