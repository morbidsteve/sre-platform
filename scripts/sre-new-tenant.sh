#!/usr/bin/env bash
# sre-new-tenant.sh — Create a new tenant namespace from the team-alpha template
# Usage: ./scripts/sre-new-tenant.sh <team-name>

set -euo pipefail

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# Resolve repo root (script lives in scripts/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANTS_DIR="${REPO_ROOT}/apps/tenants"
TEMPLATE_DIR="${TENANTS_DIR}/team-alpha"

# ---------- Argument validation ----------
if [[ $# -ne 1 ]]; then
  error "Usage: $0 <team-name>"
  error "Example: $0 team-gamma"
  exit 1
fi

TEAM_NAME="$1"

# Validate name: lowercase alphanumeric + hyphens, must start with a letter
if ! [[ "${TEAM_NAME}" =~ ^[a-z][a-z0-9-]*$ ]]; then
  error "Team name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens."
  error "Got: '${TEAM_NAME}'"
  exit 1
fi

# Check template exists
if [[ ! -d "${TEMPLATE_DIR}" ]]; then
  error "Template directory not found: ${TEMPLATE_DIR}"
  exit 1
fi

# Check tenant does not already exist
NEW_TENANT_DIR="${TENANTS_DIR}/${TEAM_NAME}"
if [[ -d "${NEW_TENANT_DIR}" ]]; then
  error "Tenant '${TEAM_NAME}' already exists at ${NEW_TENANT_DIR}"
  exit 1
fi

# ---------- Create tenant ----------
info "Creating tenant '${TEAM_NAME}' from team-alpha template..."

# Copy the template directory
cp -r "${TEMPLATE_DIR}" "${NEW_TENANT_DIR}"
success "Copied template to ${NEW_TENANT_DIR}"

# Replace all occurrences of "team-alpha" with the new team name in all files
find "${NEW_TENANT_DIR}" -type f -not -name '.gitkeep' -exec \
  sed -i "s/team-alpha/${TEAM_NAME}/g" {} +
success "Replaced 'team-alpha' with '${TEAM_NAME}' in all manifests"

# Remove demo app and any other app files (those are team-alpha specific)
rm -f "${NEW_TENANT_DIR}"/apps/*.yaml
success "Cleared apps/ directory (demo-app is team-alpha specific)"

# Ensure .gitkeep exists in the empty apps/ directory
touch "${NEW_TENANT_DIR}/apps/.gitkeep"

# Remove the copied README (each team should write their own, or it still references team-alpha)
# We keep it but it was already sed-replaced above, so the name references are correct.

# ---------- Register the tenant in kustomization.yaml ----------
TENANTS_KUSTOMIZATION="${TENANTS_DIR}/kustomization.yaml"

if [[ -f "${TENANTS_KUSTOMIZATION}" ]]; then
  # Check if already listed (shouldn't be, but guard against re-runs)
  if grep -q "^  - ${TEAM_NAME}$" "${TENANTS_KUSTOMIZATION}" 2>/dev/null; then
    info "Tenant already listed in ${TENANTS_KUSTOMIZATION}"
  else
    echo "  - ${TEAM_NAME}" >> "${TENANTS_KUSTOMIZATION}"
    success "Added '${TEAM_NAME}' to ${TENANTS_KUSTOMIZATION}"
  fi
else
  # Create the kustomization.yaml if it does not exist
  cat > "${TENANTS_KUSTOMIZATION}" <<EOF
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - team-alpha
  - team-beta
  - ${TEAM_NAME}
EOF
  success "Created ${TENANTS_KUSTOMIZATION} with all tenants"
fi

# ---------- Summary ----------
echo ""
echo -e "${GREEN}${BOLD}Tenant '${TEAM_NAME}' created successfully!${RESET}"
echo ""
info "Files created:"
find "${NEW_TENANT_DIR}" -type f | sort | while read -r f; do
  echo -e "  ${CYAN}${f#"${REPO_ROOT}/"}${RESET}"
done

echo ""
info "Next steps:"
echo -e "  1. Review the generated manifests in ${CYAN}apps/tenants/${TEAM_NAME}/${RESET}"
echo -e "  2. Adjust resource quotas and limit ranges as needed"
echo -e "  3. To deploy an app, create a HelmRelease in ${CYAN}apps/tenants/${TEAM_NAME}/apps/${RESET}"
echo -e "     (see ${CYAN}apps/tenants/team-alpha/apps/demo-app.yaml${RESET} for an example)"
echo -e "  4. Add the app to ${CYAN}apps/tenants/${TEAM_NAME}/kustomization.yaml${RESET} under resources"
echo -e "  5. Commit and push:"
echo -e "       ${BOLD}git add apps/tenants/${TEAM_NAME} apps/tenants/kustomization.yaml${RESET}"
echo -e "       ${BOLD}git commit -m \"feat(tenants): onboard ${TEAM_NAME}\"${RESET}"
echo -e "       ${BOLD}git push${RESET}"
echo ""
info "Flux will automatically reconcile the new tenant namespace on the cluster."
