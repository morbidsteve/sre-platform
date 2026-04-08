#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# DEPRECATION NOTICE: This script is superseded by the SRE Dashboard UI.
# Use the dashboard at https://dashboard.apps.sre.example.com instead.
# This script remains as a CLI fallback for when the dashboard is unavailable.
# ──────────────────────────────────────────────────────────────────────────────
# onboard-tenant.sh — Full tenant onboarding: manifests + Istio AuthZ + Harbor project/robot + Keycloak groups + OpenBao path + kubectl apply
# Usage: ./scripts/onboard-tenant.sh <team-name>
#
# This script is idempotent — safe to run multiple times for the same team.

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors and helpers
# ---------------------------------------------------------------------------
source "$(dirname "${BASH_SOURCE[0]}")/lib/colors.sh"
RESET="$NC"  # This script uses RESET instead of NC

# Override with script-specific log functions
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[SKIP]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ---------------------------------------------------------------------------
# Configuration — adjust these for your environment
# ---------------------------------------------------------------------------
SRE_DOMAIN="${SRE_DOMAIN:-$(kubectl get cm sre-domain-config -n flux-system -o jsonpath='{.data.SRE_DOMAIN}' 2>/dev/null || echo 'apps.sre.example.com')}"
HARBOR_URL="${HARBOR_URL:-https://harbor.${SRE_DOMAIN}}"
HARBOR_USER="${HARBOR_USER:-admin}"
HARBOR_PASS="${HARBOR_PASS:-Harbor12345}"
OPENBAO_NAMESPACE="${OPENBAO_NAMESPACE:-openbao}"
OPENBAO_POD="${OPENBAO_POD:-openbao-0}"

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANTS_DIR="${REPO_ROOT}/apps/tenants"
ISTIO_AUTHZ_DIR="${REPO_ROOT}/platform/core/istio-config/authorization-policies/tenants"

# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------
if [[ $# -ne 1 ]]; then
  error "Usage: $0 <team-name>"
  error "Example: $0 team-gamma"
  exit 1
fi

TEAM_NAME="$1"

if ! [[ "${TEAM_NAME}" =~ ^[a-z][a-z0-9-]*$ ]]; then
  error "Team name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens."
  error "Got: '${TEAM_NAME}'"
  exit 1
fi

TENANT_DIR="${TENANTS_DIR}/${TEAM_NAME}"

# ---------------------------------------------------------------------------
# Track what we did for the summary
# ---------------------------------------------------------------------------
declare -a ACTIONS=()

# ###########################################################################
# STEP 1 — Generate Kubernetes manifests
# ###########################################################################
info "Step 1: Generating Kubernetes manifests for '${TEAM_NAME}'..."

mkdir -p "${TENANT_DIR}/network-policies"
mkdir -p "${TENANT_DIR}/apps"

# ---- namespace.yaml -------------------------------------------------------
cat > "${TENANT_DIR}/namespace.yaml" <<EOF
---
apiVersion: v1
kind: Namespace
metadata:
  name: ${TEAM_NAME}
  labels:
    istio-injection: enabled
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: ${TEAM_NAME}
    sre.io/network-policy-configured: "true"
    # PSS: privileged enforcement required for Istio init containers
    # (NET_ADMIN/NET_RAW not allowed even at baseline level)
    # Kyverno policies enforce restricted-level rules at the pod level
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
EOF

# ---- resource-quota.yaml --------------------------------------------------
cat > "${TENANT_DIR}/resource-quota.yaml" <<EOF
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ${TEAM_NAME}-quota
  namespace: ${TEAM_NAME}
spec:
  hard:
    pods: "10"
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    services: "10"
    persistentvolumeclaims: "10"
EOF

# ---- limit-range.yaml -----------------------------------------------------
cat > "${TENANT_DIR}/limit-range.yaml" <<EOF
---
apiVersion: v1
kind: LimitRange
metadata:
  name: ${TEAM_NAME}-limits
  namespace: ${TEAM_NAME}
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "2"
        memory: 4Gi
      min:
        cpu: 50m
        memory: 64Mi
EOF

# ---- network-policies/default-deny.yaml -----------------------------------
cat > "${TENANT_DIR}/network-policies/default-deny.yaml" <<EOF
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
EOF

# ---- network-policies/allow-base.yaml -------------------------------------
cat > "${TENANT_DIR}/network-policies/allow-base.yaml" <<EOF
---
# Allow DNS resolution
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
---
# Allow Prometheus scraping from monitoring namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
---
# Allow traffic from Istio ingress gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-istio-gateway
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
          podSelector:
            matchLabels:
              istio: gateway
---
# Allow inter-pod communication within the namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
---
# Allow Istio sidecar egress to istiod control plane
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-istio-control-plane
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
      ports:
        - port: 15012
          protocol: TCP
        - port: 15014
          protocol: TCP
---
# Allow HTTPS egress (for external APIs)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-https-egress
  namespace: ${TEAM_NAME}
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
          protocol: TCP
EOF

# ---- rbac.yaml -------------------------------------------------------------
cat > "${TENANT_DIR}/rbac.yaml" <<EOF
---
# Developers can manage most resources in their namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${TEAM_NAME}-developers
  namespace: ${TEAM_NAME}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: ${TEAM_NAME}-developers
---
# Viewers have read-only access
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${TEAM_NAME}-viewers
  namespace: ${TEAM_NAME}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: ${TEAM_NAME}-viewers
EOF

# ---- kustomization.yaml ---------------------------------------------------
cat > "${TENANT_DIR}/kustomization.yaml" <<EOF
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - rbac.yaml
  - resource-quota.yaml
  - limit-range.yaml
  - network-policies/default-deny.yaml
  - network-policies/allow-base.yaml
EOF

# ---- .gitkeep in apps/ ----------------------------------------------------
touch "${TENANT_DIR}/apps/.gitkeep"

success "Manifests written to apps/tenants/${TEAM_NAME}/"
ACTIONS+=("Created Kubernetes manifests in apps/tenants/${TEAM_NAME}/")

# ###########################################################################
# STEP 1b — Register tenant in parent kustomization.yaml
# ###########################################################################
TENANTS_KUSTOMIZATION="${TENANTS_DIR}/kustomization.yaml"

if [[ -f "${TENANTS_KUSTOMIZATION}" ]]; then
  if grep -q "^  - ${TEAM_NAME}$" "${TENANTS_KUSTOMIZATION}" 2>/dev/null; then
    warn "Tenant already listed in apps/tenants/kustomization.yaml"
  else
    echo "  - ${TEAM_NAME}" >> "${TENANTS_KUSTOMIZATION}"
    success "Added '${TEAM_NAME}' to apps/tenants/kustomization.yaml"
    ACTIONS+=("Registered tenant in apps/tenants/kustomization.yaml")
  fi
else
  cat > "${TENANTS_KUSTOMIZATION}" <<EOF
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ${TEAM_NAME}
EOF
  success "Created apps/tenants/kustomization.yaml"
  ACTIONS+=("Created apps/tenants/kustomization.yaml")
fi

# ###########################################################################
# STEP 1c — Add Istio AuthorizationPolicy entries for tenant
# ###########################################################################
add_istio_authz_policy() {
  local file="$1"
  local tenant="$2"
  local yaml_block="$3"

  if ! [[ -f "${file}" ]]; then
    warn "Istio AuthorizationPolicy file not found: ${file}"
    return 1
  fi

  if grep -q "namespace: ${tenant}$" "${file}" 2>/dev/null; then
    return 0  # Already exists
  fi

  printf '\n%s' "${yaml_block}" >> "${file}"
  return 2  # Added
}

info "Step 1c: Adding Istio AuthorizationPolicy entries for '${TEAM_NAME}'..."

if [[ -d "${ISTIO_AUTHZ_DIR}" ]]; then
  AUTHZ_ADDED=0
  AUTHZ_SKIPPED=0

  # --- default-deny ---
  BLOCK_DEFAULT_DENY=$(cat <<AUTHZEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: default-deny
  namespace: ${TEAM_NAME}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, AC-4, SC-7"
spec: {}
AUTHZEOF
)
  add_istio_authz_policy "${ISTIO_AUTHZ_DIR}/default-deny.yaml" "${TEAM_NAME}" "${BLOCK_DEFAULT_DENY}"
  rc=$?; if [[ $rc -eq 2 ]]; then ((AUTHZ_ADDED+=1)); else ((AUTHZ_SKIPPED+=1)); fi

  # --- allow-gateway-ingress ---
  BLOCK_GATEWAY=$(cat <<AUTHZEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-gateway-ingress
  namespace: ${TEAM_NAME}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, SC-7"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
AUTHZEOF
)
  add_istio_authz_policy "${ISTIO_AUTHZ_DIR}/allow-gateway-ingress.yaml" "${TEAM_NAME}" "${BLOCK_GATEWAY}"
  rc=$?; if [[ $rc -eq 2 ]]; then ((AUTHZ_ADDED+=1)); else ((AUTHZ_SKIPPED+=1)); fi

  # --- allow-prometheus-scrape ---
  BLOCK_PROMETHEUS=$(cat <<AUTHZEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: ${TEAM_NAME}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AU-2, CA-7, SI-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - monitoring
      to:
        - operation:
            ports:
              - "8080"
              - "9090"
              - "15014"
              - "15090"
AUTHZEOF
)
  add_istio_authz_policy "${ISTIO_AUTHZ_DIR}/allow-prometheus-scrape.yaml" "${TEAM_NAME}" "${BLOCK_PROMETHEUS}"
  rc=$?; if [[ $rc -eq 2 ]]; then ((AUTHZ_ADDED+=1)); else ((AUTHZ_SKIPPED+=1)); fi

  # --- allow-same-namespace ---
  BLOCK_SAME_NS=$(cat <<AUTHZEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-same-namespace
  namespace: ${TEAM_NAME}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, AC-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - ${TEAM_NAME}
AUTHZEOF
)
  add_istio_authz_policy "${ISTIO_AUTHZ_DIR}/allow-same-namespace.yaml" "${TEAM_NAME}" "${BLOCK_SAME_NS}"
  rc=$?; if [[ $rc -eq 2 ]]; then ((AUTHZ_ADDED+=1)); else ((AUTHZ_SKIPPED+=1)); fi

  # --- allow-istio-control-plane ---
  BLOCK_ISTIOD=$(cat <<AUTHZEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-istio-control-plane
  namespace: ${TEAM_NAME}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "SC-8, SC-12"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
AUTHZEOF
)
  add_istio_authz_policy "${ISTIO_AUTHZ_DIR}/allow-istio-control-plane.yaml" "${TEAM_NAME}" "${BLOCK_ISTIOD}"
  rc=$?; if [[ $rc -eq 2 ]]; then ((AUTHZ_ADDED+=1)); else ((AUTHZ_SKIPPED+=1)); fi

  if [[ ${AUTHZ_ADDED} -gt 0 ]]; then
    success "Added ${AUTHZ_ADDED} Istio AuthorizationPolicy entries for '${TEAM_NAME}'"
    ACTIONS+=("Added ${AUTHZ_ADDED} Istio AuthorizationPolicy entries")
  else
    warn "All Istio AuthorizationPolicy entries already exist for '${TEAM_NAME}'"
  fi

  # --- Backfill: check existing tenants from kustomization.yaml ---
  if [[ -f "${TENANTS_DIR}/kustomization.yaml" ]]; then
    BACKFILL_COUNT=0
    while IFS= read -r existing_tenant; do
      # Skip blank lines and the current tenant (already handled above)
      [[ -z "${existing_tenant}" || "${existing_tenant}" == "${TEAM_NAME}" ]] && continue

      for policy_file in default-deny allow-gateway-ingress allow-prometheus-scrape allow-same-namespace allow-istio-control-plane; do
        if [[ -f "${ISTIO_AUTHZ_DIR}/${policy_file}.yaml" ]] && \
           ! grep -q "namespace: ${existing_tenant}$" "${ISTIO_AUTHZ_DIR}/${policy_file}.yaml" 2>/dev/null; then
          # Generate the block for the existing tenant using the same templates
          case "${policy_file}" in
            default-deny)
              BACKFILL_BLOCK=$(cat <<BFEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: default-deny
  namespace: ${existing_tenant}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, AC-4, SC-7"
spec: {}
BFEOF
)
              ;;
            allow-gateway-ingress)
              BACKFILL_BLOCK=$(cat <<BFEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-gateway-ingress
  namespace: ${existing_tenant}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, SC-7"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
BFEOF
)
              ;;
            allow-prometheus-scrape)
              BACKFILL_BLOCK=$(cat <<BFEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: ${existing_tenant}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AU-2, CA-7, SI-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - monitoring
      to:
        - operation:
            ports:
              - "8080"
              - "9090"
              - "15014"
              - "15090"
BFEOF
)
              ;;
            allow-same-namespace)
              BACKFILL_BLOCK=$(cat <<BFEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-same-namespace
  namespace: ${existing_tenant}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, AC-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - ${existing_tenant}
BFEOF
)
              ;;
            allow-istio-control-plane)
              BACKFILL_BLOCK=$(cat <<BFEOF
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-istio-control-plane
  namespace: ${existing_tenant}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "SC-8, SC-12"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
BFEOF
)
              ;;
          esac
          printf '\n%s' "${BACKFILL_BLOCK}" >> "${ISTIO_AUTHZ_DIR}/${policy_file}.yaml"
          ((BACKFILL_COUNT+=1))
        fi
      done
    done < <(grep '^\s*- ' "${TENANTS_DIR}/kustomization.yaml" | sed 's/^[[:space:]]*- //')

    if [[ ${BACKFILL_COUNT} -gt 0 ]]; then
      success "Backfilled ${BACKFILL_COUNT} missing Istio AuthorizationPolicy entries for existing tenants"
      ACTIONS+=("Backfilled ${BACKFILL_COUNT} Istio AuthorizationPolicy entries for existing tenants")
    fi
  fi
else
  warn "Istio AuthorizationPolicy directory not found at ${ISTIO_AUTHZ_DIR} — skipping"
  ACTIONS+=("Istio AuthorizationPolicy entries SKIPPED (directory not found)")
fi

# ###########################################################################
# STEP 2 — Create Harbor project
# ###########################################################################
info "Step 2: Creating Harbor project '${TEAM_NAME}'..."

HARBOR_HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" \
  -u "${HARBOR_USER}:${HARBOR_PASS}" \
  "${HARBOR_URL}/api/v2.0/projects?name=${TEAM_NAME}" 2>/dev/null || echo "000")

if [[ "${HARBOR_HTTP_CODE}" == "000" ]]; then
  warn "Harbor API unreachable at ${HARBOR_URL} — skipping project creation"
  warn "Run manually: curl -sk -u ${HARBOR_USER}:*** -X POST ${HARBOR_URL}/api/v2.0/projects -H 'Content-Type: application/json' -d '{\"project_name\":\"${TEAM_NAME}\",\"metadata\":{\"public\":\"false\"}}'"
  ACTIONS+=("Harbor project creation SKIPPED (API unreachable)")
else
  # Check if project already exists
  EXISTING=$(curl -sk -u "${HARBOR_USER}:${HARBOR_PASS}" \
    "${HARBOR_URL}/api/v2.0/projects?name=${TEAM_NAME}" 2>/dev/null)

  if echo "${EXISTING}" | grep -q "\"name\":\"${TEAM_NAME}\""; then
    warn "Harbor project '${TEAM_NAME}' already exists"
  else
    CREATE_CODE=$(curl -sk -o /dev/null -w "%{http_code}" \
      -u "${HARBOR_USER}:${HARBOR_PASS}" \
      -X POST "${HARBOR_URL}/api/v2.0/projects" \
      -H "Content-Type: application/json" \
      -d "{\"project_name\":\"${TEAM_NAME}\",\"metadata\":{\"public\":\"false\",\"auto_scan\":\"true\"}}" 2>/dev/null || echo "000")

    if [[ "${CREATE_CODE}" == "201" ]]; then
      success "Harbor project '${TEAM_NAME}' created (private, auto-scan enabled)"
      ACTIONS+=("Created Harbor project '${TEAM_NAME}'")
    elif [[ "${CREATE_CODE}" == "409" ]]; then
      warn "Harbor project '${TEAM_NAME}' already exists"
    else
      warn "Harbor project creation returned HTTP ${CREATE_CODE} — may need manual verification"
      ACTIONS+=("Harbor project creation returned HTTP ${CREATE_CODE}")
    fi
  fi
fi

# ###########################################################################
# STEP 2b — Create Harbor robot account
# ###########################################################################
info "Step 2b: Creating Harbor robot account '${TEAM_NAME}-ci-push'..."

if [[ "${HARBOR_HTTP_CODE}" == "000" ]]; then
  warn "Harbor API unreachable — skipping robot account creation"
  ACTIONS+=("Harbor robot account creation SKIPPED (API unreachable)")
else
  # Check if robot account already exists
  EXISTING_ROBOTS=$(curl -sk -u "${HARBOR_USER}:${HARBOR_PASS}" \
    "${HARBOR_URL}/api/v2.0/robots?q=name%3D${TEAM_NAME}-ci-push" 2>/dev/null || echo "[]")

  if echo "${EXISTING_ROBOTS}" | grep -q "\"name\":\"robot\\\$${TEAM_NAME}-ci-push\"" 2>/dev/null; then
    warn "Harbor robot account '${TEAM_NAME}-ci-push' already exists"
  else
    ROBOT_RESPONSE=$(curl -sk -X POST "${HARBOR_URL}/api/v2.0/robots" \
      -u "${HARBOR_USER}:${HARBOR_PASS}" \
      -H "Content-Type: application/json" \
      -d '{
        "name": "'"${TEAM_NAME}"'-ci-push",
        "duration": -1,
        "level": "project",
        "permissions": [{"namespace": "'"${TEAM_NAME}"'", "kind": "project", "access": [
          {"resource": "repository", "action": "push"},
          {"resource": "repository", "action": "pull"},
          {"resource": "artifact", "action": "read"},
          {"resource": "tag", "action": "create"},
          {"resource": "tag", "action": "list"}
        ]}]
      }' 2>/dev/null || echo "{}")

    ROBOT_NAME=$(echo "${ROBOT_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
    ROBOT_SECRET=$(echo "${ROBOT_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('secret',''))" 2>/dev/null || echo "")

    if [[ -n "${ROBOT_NAME}" ]] && [[ -n "${ROBOT_SECRET}" ]]; then
      success "Harbor robot account created:"
      echo -e "    ${BOLD}Username:${RESET} ${ROBOT_NAME}"
      echo -e "    ${BOLD}Password:${RESET} ${ROBOT_SECRET}"
      echo -e "    ${YELLOW}IMPORTANT: Save this password now. It cannot be retrieved later.${RESET}"
      ACTIONS+=("Created Harbor robot account '${ROBOT_NAME}'")
    else
      # Check if 409 conflict (already exists)
      ROBOT_ERR=$(echo "${ROBOT_RESPONSE}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errors',[{}])[0].get('code',''))" 2>/dev/null || echo "")
      if [[ "${ROBOT_ERR}" == "CONFLICT" ]]; then
        warn "Harbor robot account '${TEAM_NAME}-ci-push' already exists"
      else
        warn "Harbor robot account creation may have failed — check Harbor admin UI"
        ACTIONS+=("Harbor robot account creation may have failed")
      fi
    fi
  fi
fi

# ###########################################################################
# STEP 3 — Create OpenBao KV path
# ###########################################################################
info "Step 3: Creating OpenBao KV path 'sre/${TEAM_NAME}/config'..."

if kubectl get pod "${OPENBAO_POD}" -n "${OPENBAO_NAMESPACE}" &>/dev/null; then
  # Check if the path already has data (vault kv get returns 0 on success)
  if kubectl exec -n "${OPENBAO_NAMESPACE}" "${OPENBAO_POD}" -- \
    vault kv get "sre/${TEAM_NAME}/config" &>/dev/null; then
    warn "OpenBao path 'sre/${TEAM_NAME}/config' already exists"
  else
    if kubectl exec -n "${OPENBAO_NAMESPACE}" "${OPENBAO_POD}" -- \
      vault kv put "sre/${TEAM_NAME}/config" initialized=true team="${TEAM_NAME}" &>/dev/null; then
      success "OpenBao KV path 'sre/${TEAM_NAME}/config' created"
      ACTIONS+=("Created OpenBao KV path 'sre/${TEAM_NAME}/config'")
    else
      warn "Failed to write to OpenBao — vault may be sealed or auth may be required"
      warn "Run manually: kubectl exec -n ${OPENBAO_NAMESPACE} ${OPENBAO_POD} -- vault kv put sre/${TEAM_NAME}/config initialized=true"
      ACTIONS+=("OpenBao KV path creation FAILED (see warning above)")
    fi
  fi
else
  warn "OpenBao pod '${OPENBAO_POD}' not found in namespace '${OPENBAO_NAMESPACE}' — skipping"
  warn "Run manually: kubectl exec -n ${OPENBAO_NAMESPACE} ${OPENBAO_POD} -- vault kv put sre/${TEAM_NAME}/config initialized=true"
  ACTIONS+=("OpenBao KV path creation SKIPPED (pod not found)")
fi

# ###########################################################################
# STEP 4 — Create Keycloak groups
# ###########################################################################
info "Step 4: Creating Keycloak groups for '${TEAM_NAME}'..."

KC_URL="https://keycloak.${SRE_DOMAIN}"
KC_TOKEN=""

# Try to get admin password and authenticate
KC_ADMIN_PASS="${KC_ADMIN_PASS:-$(kubectl get secret keycloak -n keycloak -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || echo '')}"

if [[ -n "${KC_ADMIN_PASS}" ]]; then
  KC_TOKEN=$(curl -sk --connect-timeout 5 -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "username=admin" \
    -d "password=${KC_ADMIN_PASS}" \
    -d "grant_type=password" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
fi

if [[ -n "${KC_TOKEN}" ]]; then
  KC_GROUPS_CREATED=0
  KC_GROUPS_EXISTED=0

  for group in "${TEAM_NAME}-developers" "${TEAM_NAME}-viewers"; do
    GROUP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X POST \
      "${KC_URL}/admin/realms/sre/groups" \
      -H "Authorization: Bearer ${KC_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"${group}\"}" 2>/dev/null || echo "000")

    if [[ "${GROUP_CODE}" == "201" ]]; then
      ((KC_GROUPS_CREATED+=1))
    elif [[ "${GROUP_CODE}" == "409" ]]; then
      ((KC_GROUPS_EXISTED+=1))
    else
      warn "Keycloak group '${group}' creation returned HTTP ${GROUP_CODE}"
    fi
  done

  if [[ ${KC_GROUPS_CREATED} -gt 0 ]]; then
    success "Created ${KC_GROUPS_CREATED} Keycloak group(s) in SRE realm"
    ACTIONS+=("Created Keycloak groups: ${TEAM_NAME}-developers, ${TEAM_NAME}-viewers")
  fi
  if [[ ${KC_GROUPS_EXISTED} -gt 0 ]]; then
    warn "${KC_GROUPS_EXISTED} Keycloak group(s) already existed"
  fi
else
  warn "Keycloak unreachable or authentication failed — skipping group creation"
  warn "Create groups manually in Keycloak SRE realm: ${TEAM_NAME}-developers, ${TEAM_NAME}-viewers"
  ACTIONS+=("Keycloak group creation SKIPPED (unreachable or auth failed)")
fi

# ###########################################################################
# STEP 5 — Apply manifests with kubectl
# ###########################################################################
info "Step 5: Applying Kubernetes manifests..."

if command -v kubectl &>/dev/null && kubectl cluster-info &>/dev/null; then
  kubectl apply -f "${TENANT_DIR}/namespace.yaml"
  kubectl apply -f "${TENANT_DIR}/resource-quota.yaml"
  kubectl apply -f "${TENANT_DIR}/limit-range.yaml"
  kubectl apply -f "${TENANT_DIR}/rbac.yaml"
  kubectl apply -f "${TENANT_DIR}/network-policies/default-deny.yaml"
  kubectl apply -f "${TENANT_DIR}/network-policies/allow-base.yaml"
  success "All manifests applied to cluster"
  ACTIONS+=("Applied all manifests to cluster via kubectl")
else
  warn "kubectl not available or cluster unreachable — skipping apply"
  warn "Manifests are ready; Flux will reconcile them on next sync, or apply manually:"
  warn "  kubectl apply -k apps/tenants/${TEAM_NAME}/"
  ACTIONS+=("kubectl apply SKIPPED (cluster unreachable)")
fi

# ###########################################################################
# STEP 6 — Summary
# ###########################################################################
echo ""
echo -e "${GREEN}${BOLD}============================================================${RESET}"
echo -e "${GREEN}${BOLD}  Tenant '${TEAM_NAME}' onboarding complete!${RESET}"
echo -e "${GREEN}${BOLD}============================================================${RESET}"
echo ""

echo -e "${BOLD}Actions performed:${RESET}"
for action in "${ACTIONS[@]}"; do
  echo -e "  ${GREEN}*${RESET} ${action}"
done

echo ""
echo -e "${BOLD}Files created/modified:${RESET}"
find "${TENANT_DIR}" -type f | sort | while read -r f; do
  echo -e "  ${CYAN}${f#"${REPO_ROOT}/"}${RESET}"
done

echo ""
echo -e "${BOLD}Resources created in namespace '${TEAM_NAME}':${RESET}"
echo -e "  - Namespace with Istio injection + PSS labels"
echo -e "  - ResourceQuota (10 pods, 4/8 CPU req/lim, 8/16Gi mem req/lim)"
echo -e "  - LimitRange (default: 200m/256Mi, max: 2CPU/4Gi)"
echo -e "  - NetworkPolicy: default-deny-all"
echo -e "  - NetworkPolicy: allow-dns (kube-system:53)"
echo -e "  - NetworkPolicy: allow-monitoring (monitoring namespace)"
echo -e "  - NetworkPolicy: allow-istio-gateway (istio-system)"
echo -e "  - NetworkPolicy: allow-same-namespace (intra-pod)"
echo -e "  - NetworkPolicy: allow-istio-control-plane (istiod)"
echo -e "  - NetworkPolicy: allow-https-egress (443 outbound)"
echo -e "  - RoleBinding: ${TEAM_NAME}-developers (edit, Keycloak group)"
echo -e "  - RoleBinding: ${TEAM_NAME}-viewers (view, Keycloak group)"
echo -e "  - Istio AuthorizationPolicy: default-deny"
echo -e "  - Istio AuthorizationPolicy: allow-gateway-ingress"
echo -e "  - Istio AuthorizationPolicy: allow-prometheus-scrape"
echo -e "  - Istio AuthorizationPolicy: allow-same-namespace"
echo -e "  - Istio AuthorizationPolicy: allow-istio-control-plane"
echo -e "  - Keycloak groups: ${TEAM_NAME}-developers, ${TEAM_NAME}-viewers"
echo -e "  - Harbor robot account: ${TEAM_NAME}-ci-push"

echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo -e "  1. Review manifests in ${CYAN}apps/tenants/${TEAM_NAME}/${RESET}"
echo -e "  2. To deploy an app, create a HelmRelease in ${CYAN}apps/tenants/${TEAM_NAME}/apps/${RESET}"
echo -e "     (see ${CYAN}apps/tenants/team-alpha/apps/${RESET} for examples)"
echo -e "  3. Add the app to ${CYAN}apps/tenants/${TEAM_NAME}/kustomization.yaml${RESET} under resources"
echo -e "  4. Commit and push:"
echo -e "       ${BOLD}git add apps/tenants/${TEAM_NAME} apps/tenants/kustomization.yaml${RESET}"
echo -e "       ${BOLD}git commit -m \"feat(tenants): onboard ${TEAM_NAME}\"${RESET}"
echo -e "       ${BOLD}git push${RESET}"
echo ""
info "Flux will automatically reconcile the new tenant namespace on the cluster."
