#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$REPO_ROOT/scripts/lib/colors.sh"

SRE_DOMAIN="${SRE_DOMAIN:-$(kubectl get cm sre-domain-config -n flux-system -o jsonpath='{.data.SRE_DOMAIN}' 2>/dev/null || echo 'apps.sre.example.com')}"
REGISTRY="${HARBOR_REGISTRY:-harbor.${SRE_DOMAIN}}"
PROJECT="${HARBOR_PROJECT:-platform}"
TAG="${1:-v1.0.0}"

log "Building demo-fullstack components with tag ${TAG}..."

# Build backend
log "Building demo-backend..."
cd "$SCRIPT_DIR/backend"
docker build -t "${REGISTRY}/${PROJECT}/demo-backend:${TAG}" .
docker push "${REGISTRY}/${PROJECT}/demo-backend:${TAG}"

# Build frontend
log "Building demo-frontend..."
cd "$SCRIPT_DIR/frontend"
docker build -t "${REGISTRY}/${PROJECT}/demo-frontend:${TAG}" .
docker push "${REGISTRY}/${PROJECT}/demo-frontend:${TAG}"

# Update k8s manifests
log "Updating image tags in HelmReleases..."
sed -i "s|tag: \".*\"|tag: \"${TAG}\"|" "$SCRIPT_DIR/k8s/backend-helmrelease.yaml"
sed -i "s|tag: \".*\"|tag: \"${TAG}\"|" "$SCRIPT_DIR/k8s/frontend-helmrelease.yaml"

# Commit and push
log "Committing and pushing..."
cd "$REPO_ROOT"
git add "$SCRIPT_DIR/k8s/backend-helmrelease.yaml" "$SCRIPT_DIR/k8s/frontend-helmrelease.yaml"
git commit -m "feat(demo-fullstack): release ${TAG}

Update demo-fullstack images to ${REGISTRY}/${PROJECT}/demo-backend:${TAG} and demo-frontend:${TAG}"
git push

log "Done! Flux will deploy ${TAG} automatically."
echo ""
info "    Monitor: flux get kustomizations sre-demo-fullstack"
info "    Pods:    kubectl get pods -n team-demo -l 'app.kubernetes.io/name in (demo-frontend,demo-backend,demo-db)'"
