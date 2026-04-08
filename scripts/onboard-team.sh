#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# DEPRECATION NOTICE: This script is superseded by the SRE Dashboard UI.
# Use the dashboard at https://dashboard.apps.sre.example.com instead.
# This script remains as a CLI fallback for when the dashboard is unavailable.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/colors.sh"
die() { error "$@"; exit 1; }
command -v yq >/dev/null 2>&1 || die "yq not installed"
[[ "$(yq --version 2>&1)" == *"v4"* ]] || die "yq v4 required"
[[ $# -ge 1 ]] || die "Usage: onboard-team.sh <team-contract.yaml>"
CONTRACT="$1"; [[ -f "$CONTRACT" ]] || die "File not found: $CONTRACT"
TEAM="$(yq '.metadata.name // ""' "$CONTRACT")"
QUOTA="$(yq '.spec.quota // "small"' "$CONTRACT")"
DISPLAY_NAME="$(yq '.spec.displayName // ""' "$CONTRACT")"
CONTACT_EMAIL="$(yq '.spec.contactEmail // ""' "$CONTRACT")"
[[ -n "$TEAM" ]] || die "metadata.name is required"
[[ "$TEAM" =~ ^team-[a-z][a-z0-9-]*$ ]] || die "Team name must match team-<kebab-case>"
TENANT_DIR="${REPO_ROOT}/apps/tenants/${TEAM}"
[[ ! -d "$TENANT_DIR" ]] || die "Tenant directory already exists: ${TENANT_DIR}"
case "$QUOTA" in
  small)  REQ_CPU=4;  REQ_MEM=8Gi;  LIM_CPU=8;  LIM_MEM=16Gi;  PODS=20; SVCS=10; PVCS=10 ;;
  medium) REQ_CPU=8;  REQ_MEM=16Gi; LIM_CPU=16; LIM_MEM=32Gi;  PODS=40; SVCS=20; PVCS=20 ;;
  large)  REQ_CPU=16; REQ_MEM=32Gi; LIM_CPU=32; LIM_MEM=64Gi;  PODS=80; SVCS=40; PVCS=40 ;;
  custom)
    REQ_CPU="$(yq '.spec.customQuota.cpu // ""' "$CONTRACT")"
    REQ_MEM="$(yq '.spec.customQuota.memory // ""' "$CONTRACT")"
    PODS="$(yq '.spec.customQuota.pods // 0' "$CONTRACT")"
    SVCS="$(yq '.spec.customQuota.services // 0' "$CONTRACT")"
    PVCS="$(yq '.spec.customQuota.pvcs // 0' "$CONTRACT")"
    [[ -n "$REQ_CPU" && -n "$REQ_MEM" && "$PODS" -gt 0 ]] || die "customQuota incomplete"
    LIM_CPU="$REQ_CPU"; LIM_MEM="$REQ_MEM" ;;
  *) die "Unknown quota: $QUOTA" ;;
esac
info "Creating tenant: ${TEAM}"
mkdir -p "${TENANT_DIR}/apps"; touch "${TENANT_DIR}/apps/.gitkeep"
cat > "${TENANT_DIR}/apps/kustomization.yaml" << 'EOF'
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: []
EOF
# Generate kustomization.yaml — matches _base overlay pattern from team-alpha
T="$TEAM"
cat > "${TENANT_DIR}/kustomization.yaml" << KEOF
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../_base
  - apps/

patches:
  - target: { kind: Namespace, name: TENANT_NAME }
    patch: |
      - op: replace
        path: /metadata/name
        value: ${T}
      - op: replace
        path: /metadata/labels/sre.io~1team
        value: ${T}
  - target: { kind: ResourceQuota, name: tenant-quota }
    patch: |
      - op: replace
        path: /metadata/name
        value: ${T}-quota
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: LimitRange, name: tenant-limits }
    patch: |
      - op: replace
        path: /metadata/name
        value: ${T}-limits
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: RoleBinding, name: tenant-developers }
    patch: |
      - op: replace
        path: /metadata/name
        value: ${T}-developers
      - op: replace
        path: /metadata/namespace
        value: ${T}
      - op: replace
        path: /subjects/0/name
        value: ${T}-developers
  - target: { kind: RoleBinding, name: tenant-viewers }
    patch: |
      - op: replace
        path: /metadata/name
        value: ${T}-viewers
      - op: replace
        path: /metadata/namespace
        value: ${T}
      - op: replace
        path: /subjects/0/name
        value: ${T}-viewers
  - target: { kind: NetworkPolicy, name: default-deny-all }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-dns }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-monitoring }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-istio-gateway }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-same-namespace }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-istio-control-plane }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
  - target: { kind: NetworkPolicy, name: allow-https-egress }
    patch: |
      - op: replace
        path: /metadata/namespace
        value: ${T}
KEOF
if [[ "$QUOTA" != "small" ]]; then
  cat >> "${TENANT_DIR}/kustomization.yaml" << QEOF

  - target: { kind: ResourceQuota, name: tenant-quota }
    patch: |
      - op: replace
        path: /spec/hard/requests.cpu
        value: "${REQ_CPU}"
      - op: replace
        path: /spec/hard/requests.memory
        value: "${REQ_MEM}"
      - op: replace
        path: /spec/hard/limits.cpu
        value: "${LIM_CPU}"
      - op: replace
        path: /spec/hard/limits.memory
        value: "${LIM_MEM}"
      - op: replace
        path: /spec/hard/pods
        value: "${PODS}"
      - op: replace
        path: /spec/hard/services
        value: "${SVCS}"
      - op: replace
        path: /spec/hard/persistentvolumeclaims
        value: "${PVCS}"
QEOF
fi
log "Tenant ${TEAM} created successfully"
info "  Quota: ${QUOTA} (cpu: ${REQ_CPU}/${LIM_CPU}, mem: ${REQ_MEM}/${LIM_MEM}, pods: ${PODS})"
[[ -z "$DISPLAY_NAME" ]] || info "  Display: ${DISPLAY_NAME}"
[[ -z "$CONTACT_EMAIL" ]] || info "  Contact: ${CONTACT_EMAIL}"
warn "Next steps:"
echo "  1. Create Keycloak groups: ${TEAM}-developers, ${TEAM}-viewers"
echo "  2. Add to apps/tenants/kustomization.yaml: - ${TEAM}/"
echo "  3. Commit and push — Flux reconciles the namespace"
echo "  4. Create Harbor project: ${TEAM}"
echo "  5. Create OpenBao path: sre/${TEAM}/"
