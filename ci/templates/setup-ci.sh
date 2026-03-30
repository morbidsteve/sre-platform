#!/usr/bin/env bash
# SRE Platform — CI Pipeline Setup Helper
# Copies the appropriate CI template to your project and configures it.
# Usage: ./setup-ci.sh [--github | --gitlab]
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse args
CI_SYSTEM="${1:-}"
if [[ "$CI_SYSTEM" == "--help" || "$CI_SYSTEM" == "-h" ]]; then
  echo "Usage: $0 [--github | --gitlab]"
  echo ""
  echo "Copies an SRE Platform CI template to your project directory."
  echo "Run this from your project root (where your Dockerfile is)."
  exit 0
fi

if [[ -z "$CI_SYSTEM" ]]; then
  echo "Select your CI system:"
  echo "  1) GitHub Actions"
  echo "  2) GitLab CI"
  read -rp "Choice [1/2]: " choice
  case "$choice" in
    1) CI_SYSTEM="--github" ;;
    2) CI_SYSTEM="--gitlab" ;;
    *) error "Invalid choice" ;;
  esac
fi

# Collect info
read -rp "Team name (e.g., team-alpha): " TEAM_NAME
read -rp "App name (e.g., my-app): " APP_NAME
HARBOR_PROJECT="${TEAM_NAME}"

case "$CI_SYSTEM" in
  --github)
    SRC="${SCRIPT_DIR}/github-actions/harbor-build.yaml"
    DEST=".github/workflows/harbor-build.yaml"
    [[ -f "$SRC" ]] || error "Template not found: $SRC"
    mkdir -p "$(dirname "$DEST")"
    sed -e "s/HARBOR_PROJECT: \"team-alpha\"/HARBOR_PROJECT: \"${HARBOR_PROJECT}\"/" \
        -e "s/IMAGE_NAME: \"my-app\"/IMAGE_NAME: \"${APP_NAME}\"/" \
        "$SRC" > "$DEST"
    success "Created $DEST"
    ;;
  --gitlab)
    SRC="${SCRIPT_DIR}/gitlab-ci/harbor-build.gitlab-ci.yml"
    DEST=".gitlab-ci.yml"
    [[ -f "$SRC" ]] || error "Template not found: $SRC"
    cp "$SRC" "$DEST"
    success "Created $DEST"
    info "Set these variables in GitLab CI/CD settings:"
    info "  HARBOR_PROJECT = ${HARBOR_PROJECT}"
    info "  IMAGE_NAME = ${APP_NAME}"
    ;;
  *) error "Unknown option: $CI_SYSTEM (use --github or --gitlab)" ;;
esac

echo ""
info "Next steps:"
echo ""
echo "  1. Create a Harbor robot account:"
echo "     Harbor UI → ${HARBOR_PROJECT} → Robot Accounts → New"
echo "     Permissions: push, pull"
echo ""
echo "  2. Generate Cosign keys:"
echo "     cosign generate-key-pair"
echo ""
echo "  3. Add secrets to your CI system:"
if [[ "$CI_SYSTEM" == "--github" ]]; then
  echo "     GitHub → Settings → Secrets → Actions:"
  echo "       HARBOR_USERNAME  = robot\$${HARBOR_PROJECT}-ci"
  echo "       HARBOR_PASSWORD  = (from Harbor robot account)"
  echo "       COSIGN_PRIVATE_KEY = (contents of cosign.key)"
  echo "       COSIGN_PASSWORD    = (passphrase from key generation)"
else
  echo "     GitLab → Settings → CI/CD → Variables:"
  echo "       HARBOR_REGISTRY  = harbor.apps.sre.example.com"
  echo "       HARBOR_USERNAME  = robot\$${HARBOR_PROJECT}-ci"
  echo "       HARBOR_PASSWORD  = (from Harbor robot account, masked)"
  echo "       COSIGN_PRIVATE_KEY = (upload cosign.key as file variable)"
  echo "       COSIGN_PASSWORD    = (passphrase, masked)"
fi
echo ""
echo "  4. Push a version tag to trigger the pipeline:"
echo "     git tag v1.0.0 && git push origin v1.0.0"
echo ""
echo "  5. After the image is in Harbor, deploy via:"
echo "     - Portal Quick Deploy: https://portal.apps.sre.example.com"
echo "     - DSOP Wizard Easy Mode: https://dsop-wizard.apps.sre.example.com"
echo "     - CLI: task deploy-app -- your-contract.yaml"
