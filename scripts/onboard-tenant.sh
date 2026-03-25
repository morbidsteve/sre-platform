#!/usr/bin/env bash
# onboard-tenant.sh — Full tenant onboarding: manifests + Harbor project + OpenBao path + kubectl apply
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
# STEP 4 — Apply manifests with kubectl
# ###########################################################################
info "Step 4: Applying Kubernetes manifests..."

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
# STEP 5 — Summary
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
echo -e "${BOLD}Files created:${RESET}"
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

echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo -e "  1. Review manifests in ${CYAN}apps/tenants/${TEAM_NAME}/${RESET}"
echo -e "  2. Create Keycloak groups: ${CYAN}${TEAM_NAME}-developers${RESET} and ${CYAN}${TEAM_NAME}-viewers${RESET}"
echo -e "  3. To deploy an app, create a HelmRelease in ${CYAN}apps/tenants/${TEAM_NAME}/apps/${RESET}"
echo -e "     (see ${CYAN}apps/tenants/team-alpha/apps/${RESET} for examples)"
echo -e "  4. Add the app to ${CYAN}apps/tenants/${TEAM_NAME}/kustomization.yaml${RESET} under resources"
echo -e "  5. Commit and push:"
echo -e "       ${BOLD}git add apps/tenants/${TEAM_NAME} apps/tenants/kustomization.yaml${RESET}"
echo -e "       ${BOLD}git commit -m \"feat(tenants): onboard ${TEAM_NAME}\"${RESET}"
echo -e "       ${BOLD}git push${RESET}"
echo ""
info "Flux will automatically reconcile the new tenant namespace on the cluster."
