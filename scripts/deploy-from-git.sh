#!/usr/bin/env bash
# Deploy an application from a Git repository URL to the SRE platform.
# Creates a Flux GitRepository + HelmRelease or Kustomization automatically.
#
# Usage:
#   ./scripts/deploy-from-git.sh <team> <app-name> <git-url> [branch]
#
# Example:
#   ./scripts/deploy-from-git.sh team-alpha my-api https://github.com/org/my-api.git main
#
# The Git repo should contain either:
#   - A Helm chart (Chart.yaml at root or in chart/)
#   - Kubernetes manifests in k8s/ or deploy/
#   - A kustomization.yaml at root

set -euo pipefail

if [ $# -lt 3 ]; then
    echo "Usage: $0 <team> <app-name> <git-url> [branch]"
    echo ""
    echo "Example: $0 team-alpha my-api https://github.com/org/my-api.git main"
    exit 1
fi

TEAM="$1"
APP_NAME="$2"
GIT_URL="$3"
BRANCH="${4:-main}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TENANT_DIR="$REPO_DIR/apps/tenants/$TEAM"
APP_DIR="$TENANT_DIR/$APP_NAME"

if [ ! -d "$TENANT_DIR" ]; then
    echo "ERROR: Tenant $TEAM not found at $TENANT_DIR"
    echo "Run ./scripts/onboard-tenant.sh $TEAM first"
    exit 1
fi

if [ -d "$APP_DIR" ]; then
    echo "WARNING: App directory $APP_DIR already exists. Updating..."
fi

mkdir -p "$APP_DIR"

echo "==> Creating Flux GitRepository for $APP_NAME..."
cat > "$APP_DIR/gitrepository.yaml" << EOF
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: ${APP_NAME}
  namespace: ${TEAM}
spec:
  interval: 5m
  url: ${GIT_URL}
  ref:
    branch: ${BRANCH}
EOF

echo "==> Creating Flux Kustomization for $APP_NAME..."
cat > "$APP_DIR/kustomization-flux.yaml" << EOF
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: ${APP_NAME}
  namespace: ${TEAM}
spec:
  interval: 5m
  path: "./"
  prune: true
  sourceRef:
    kind: GitRepository
    name: ${APP_NAME}
  targetNamespace: ${TEAM}
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: ${APP_NAME}
      namespace: ${TEAM}
EOF

echo "==> Creating Kustomize kustomization.yaml..."
cat > "$APP_DIR/kustomization.yaml" << EOF
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - gitrepository.yaml
  - kustomization-flux.yaml
EOF

echo "==> Applying to cluster..."
kubectl apply -k "$APP_DIR"

echo ""
echo "==> App $APP_NAME deployed for team $TEAM"
echo "    Source: $GIT_URL ($BRANCH)"
echo "    Namespace: $TEAM"
echo ""
echo "    Monitor: flux get kustomizations -n $TEAM"
echo "    Logs: flux logs --kind=Kustomization --name=$APP_NAME -n $TEAM"
