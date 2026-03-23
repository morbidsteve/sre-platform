#!/usr/bin/env bash
set -euo pipefail

# Unified build-and-deploy script for SRE Platform applications
# Usage: ./scripts/build-app.sh <app-dir> [image-name] [version-tag]
#
# Examples:
#   ./scripts/build-app.sh apps/dashboard sre-dashboard
#   ./scripts/build-app.sh apps/portal sre-portal
#   ./scripts/build-app.sh apps/dsop-wizard dsop-wizard
#   ./scripts/build-app.sh apps/portal sre-portal v2.4.0
#
# Environment variables:
#   HARBOR_REGISTRY  — Registry hostname (default: harbor.apps.sre.example.com)
#   HARBOR_PROJECT   — Registry project  (default: platform)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source shared colors
source "$SCRIPT_DIR/lib/colors.sh"

# ── Arguments ─────────────────────────────────────────────────────────────────

APP_DIR="${1:?Usage: $0 <app-dir> [image-name] [version-tag]}"
APP_DIR="$(cd "$REPO_ROOT/$APP_DIR" 2>/dev/null && pwd)" || { error "Directory not found: $1"; exit 1; }
IMAGE_NAME="${2:-$(basename "$APP_DIR")}"
EXPLICIT_TAG="${3:-}"

# ── Configuration ─────────────────────────────────────────────────────────────

REGISTRY="${HARBOR_REGISTRY:-harbor.apps.sre.example.com}"
PROJECT="${HARBOR_PROJECT:-platform}"

# ── Auto-detect deployment file ───────────────────────────────────────────────

DEPLOYMENT_FILE=$(find "$APP_DIR/k8s" -name "deployment.yaml" -o -name "deployment*.yaml" 2>/dev/null | head -1)
if [ -z "$DEPLOYMENT_FILE" ]; then
  warn "No deployment.yaml found in $APP_DIR/k8s/ — skipping tag update"
fi

# ── Determine image tag ──────────────────────────────────────────────────────

if [[ -n "$EXPLICIT_TAG" ]]; then
    IMAGE_TAG="$EXPLICIT_TAG"
else
    # Auto-detect current tag from deployment file and increment patch version
    if [[ -n "$DEPLOYMENT_FILE" ]]; then
        CURRENT_TAG=$(grep -oP "image:.*${IMAGE_NAME}:\K[v0-9.]+" "$DEPLOYMENT_FILE" 2>/dev/null || echo "v0.0.0")
    else
        CURRENT_TAG="v0.0.0"
    fi
    MAJOR=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f1)
    MINOR=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f2)
    PATCH=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f3)
    IMAGE_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"
    log "Auto-incrementing version: ${CURRENT_TAG} -> ${IMAGE_TAG}"
fi

FULL_IMAGE="${REGISTRY}/${PROJECT}/${IMAGE_NAME}:${IMAGE_TAG}"

# ── Step 1: Build ─────────────────────────────────────────────────────────────

log "Building Docker image ${FULL_IMAGE}..."
cd "$APP_DIR"
docker build -t "${FULL_IMAGE}" .

# ── Step 2: Push to Harbor ────────────────────────────────────────────────────

log "Pushing to Harbor..."
docker push "${FULL_IMAGE}"

# ── Step 3: Update deployment.yaml with new image tag ─────────────────────────

if [ -n "$DEPLOYMENT_FILE" ]; then
    log "Updating deployment.yaml to ${FULL_IMAGE}..."
    sed -i "s|image: .*${IMAGE_NAME}:.*|image: ${REGISTRY}/${PROJECT}/${IMAGE_NAME}:${IMAGE_TAG}|" "$DEPLOYMENT_FILE"
fi

# ── Step 4: Update package.json version (if it exists) ────────────────────────

SEMVER="${IMAGE_TAG#v}"
if [[ -f "$APP_DIR/package.json" ]]; then
    log "Updating package.json version to ${SEMVER}..."
    sed -i "s|\"version\": \".*\"|\"version\": \"${SEMVER}\"|" "$APP_DIR/package.json"
fi

# ── Step 5: Commit and push ──────────────────────────────────────────────────

APP_SHORT="$(basename "$APP_DIR")"
log "Committing and pushing to Git..."
cd "$REPO_ROOT"

FILES_TO_ADD=()
[[ -n "$DEPLOYMENT_FILE" ]] && FILES_TO_ADD+=("$DEPLOYMENT_FILE")
[[ -f "$APP_DIR/package.json" ]] && FILES_TO_ADD+=("$APP_DIR/package.json")

if [[ ${#FILES_TO_ADD[@]} -gt 0 ]]; then
    git add "${FILES_TO_ADD[@]}"
    git commit -m "feat(${APP_SHORT}): release ${IMAGE_TAG}

Update ${APP_SHORT} image to ${FULL_IMAGE}"
    git push
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
log "Done! Flux will deploy ${IMAGE_TAG} automatically."
echo ""
info "    Monitor with: flux get kustomizations -A"
info "    Or watch:     kubectl get pods -n sre-${APP_SHORT} -w"
echo ""
