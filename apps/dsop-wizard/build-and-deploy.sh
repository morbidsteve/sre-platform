#!/usr/bin/env bash
# Build the DSOP Wizard container image, push to Harbor, and deploy via GitOps.
#
# Flow: docker build → docker push to Harbor → update deployment.yaml tag → git commit+push → Flux deploys
#
# Prerequisites:
#   - Docker installed locally
#   - docker login harbor.apps.sre.example.com (done once)
#   - Git configured with push access to the repo
#
# Usage:
#   ./build-and-deploy.sh              # Auto-increments patch version
#   ./build-and-deploy.sh v2.5.0       # Explicit version tag

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="harbor.apps.sre.example.com"  # External URL for docker push from dev machine
PROJECT="platform"
IMAGE_NAME="dsop-wizard"
DEPLOYMENT_FILE="$SCRIPT_DIR/k8s/deployment.yaml"

# Determine image tag
if [[ "${1:-}" != "" ]]; then
    IMAGE_TAG="$1"
else
    # Auto-detect current tag and increment patch version
    CURRENT_TAG=$(grep -oP 'image:.*dsop-wizard:\K[v0-9.]+' "$DEPLOYMENT_FILE" 2>/dev/null || echo "v0.0.0")
    MAJOR=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f1)
    MINOR=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f2)
    PATCH=$(echo "$CURRENT_TAG" | sed 's/v//' | cut -d. -f3)
    IMAGE_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"
    echo "Auto-incrementing version: ${CURRENT_TAG} → ${IMAGE_TAG}"
fi

FULL_IMAGE="${REGISTRY}/${PROJECT}/${IMAGE_NAME}:${IMAGE_TAG}"

cd "$SCRIPT_DIR"

# Step 1: Build
echo "==> Building Docker image ${FULL_IMAGE}..."
docker build -t "${FULL_IMAGE}" .

# Step 2: Push to Harbor
echo "==> Pushing to Harbor..."
docker push "${FULL_IMAGE}"

# Step 3: Update deployment.yaml with new image tag
echo "==> Updating deployment.yaml to ${FULL_IMAGE}..."
sed -i "s|image: .*dsop-wizard:.*|image: ${FULL_IMAGE}|" "$DEPLOYMENT_FILE"

# Step 4: Update package.json version
SEMVER="${IMAGE_TAG#v}"
sed -i "s|\"version\": \".*\"|\"version\": \"${SEMVER}\"|" "$SCRIPT_DIR/package.json"

# Step 5: Commit and push
echo "==> Committing and pushing to Git..."
cd "$REPO_ROOT"
git add "$DEPLOYMENT_FILE" "$SCRIPT_DIR/package.json"
git commit -m "feat(dsop-wizard): release ${IMAGE_TAG}

Update dsop-wizard image to ${FULL_IMAGE}"
git push

echo ""
echo "==> Done! Flux will deploy ${IMAGE_TAG} automatically."
echo ""
echo "    Monitor with: flux get kustomizations -A"
echo "    Or watch:     kubectl get pods -n sre-dsop -w"
echo ""
echo "    DSOP Wizard URL: https://dsop.apps.sre.example.com"
