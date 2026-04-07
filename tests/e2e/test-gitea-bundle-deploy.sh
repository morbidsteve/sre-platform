#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# E2E Test: Gitea Bundle Deployment via DSOP Pipeline
#
# Tests the full flow a developer would follow:
#   1. Clean up any existing gitea deployment
#   2. Upload the gitea bundle to the DSOP pipeline
#   3. Wait for scanning gates to complete
#   4. Approve ISSM review (with security exceptions)
#   5. Deploy
#   6. Validate pod starts, security context is correct, app is accessible
#   7. Clean up
#
# USAGE:
#   ./tests/e2e/test-gitea-bundle-deploy.sh [--keep]
#
#   --keep    Don't clean up after test (leave gitea running for inspection)
#
# PREREQUISITES:
#   - Dashboard running and accessible
#   - kubectl configured for the cluster
#   - Bundle file at tools/developer-kit/examples/05-gitea-self-hosted/
#     with images/gitea.tar (linux/amd64)
#   - curl, jq installed
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Config
DASHBOARD_URL="${DASHBOARD_URL:-https://dashboard.apps.sre.example.com}"
TEAM="team-demo"
APP_NAME="gitea"
NAMESPACE="${TEAM}"
BUNDLE_DIR="${REPO_ROOT}/tools/developer-kit/examples/05-gitea-self-hosted"
INGRESS_HOST="gitea.apps.sre.example.com"
KEEP=false
TIMEOUT_PIPELINE=300   # 5 min for pipeline scanning
TIMEOUT_DEPLOY=180     # 3 min for deployment
TIMEOUT_POD=120        # 2 min for pod readiness

# Auth — uses SSO credentials
AUTH_USER="${SRE_USER:-sre-admin}"
AUTH_PASS="${SRE_PASS:-SreAdmin123!}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

pass() { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${CYAN}ℹ${NC} $*"; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

FAILURES=0

# Parse args
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=true ;;
  esac
done

# ── Helper: API calls via OAuth2 Proxy session cookie ──
COOKIE_JAR=$(mktemp)
trap "rm -f ${COOKIE_JAR} 2>/dev/null" EXIT

# Authenticate through OAuth2 Proxy → Keycloak and get session cookies
oauth2_login() {
  local KEYCLOAK_URL="${KEYCLOAK_URL:-https://keycloak.apps.sre.example.com}"

  # Follow redirects to Keycloak login page
  local KC_LOGIN_URL
  KC_LOGIN_URL=$(curl -sk -L -o /dev/null -w "%{url_effective}" \
    "${DASHBOARD_URL}/oauth2/start?rd=/api/health" \
    -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" 2>/dev/null)

  # Extract the form action URL from the login page
  local KC_ACTION_URL
  KC_ACTION_URL=$(curl -sk "${KC_LOGIN_URL}" \
    -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" 2>/dev/null \
    | grep -oP 'action="[^"]*"' | head -1 \
    | sed 's/action="//;s/"$//' | sed 's/&amp;/\&/g')

  # Submit credentials and follow redirects back to dashboard
  curl -sk -L -o /dev/null \
    -d "username=${AUTH_USER}" -d "password=${AUTH_PASS}" \
    -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" \
    "${KC_ACTION_URL}" 2>/dev/null
}

api() {
  local method="$1" path="$2"
  shift 2
  curl -sk -X "$method" \
    -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" \
    -H "Content-Type: application/json" \
    "${DASHBOARD_URL}${path}" "$@"
}

api_raw() {
  local method="$1" path="$2"
  shift 2
  curl -sk -X "$method" \
    -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" \
    "${DASHBOARD_URL}${path}" "$@"
}

# ── Helper: wait for condition ──
wait_for() {
  local description="$1" timeout="$2" check_cmd="$3"
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if eval "$check_cmd" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    printf "."
  done
  echo ""
  return 1
}

echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║   E2E Test: Gitea Bundle Deploy via DSOP      ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ──────────────────────────────────────────────────────────────────────────────
step "Step 0: Prerequisites"
# ──────────────────────────────────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  fail "jq not installed"; exit 1
fi
pass "jq installed"

if ! command -v kubectl &>/dev/null; then
  fail "kubectl not installed"; exit 1
fi
pass "kubectl available"

if ! kubectl get nodes &>/dev/null; then
  fail "kubectl cannot reach cluster"; exit 1
fi
pass "Cluster reachable"

BUNDLE_TARBALL="${BUNDLE_DIR}/gitea.bundle.tar.gz"
if [ ! -f "${BUNDLE_TARBALL}" ]; then
  # Try to build the bundle
  if [ -f "${BUNDLE_DIR}/images/gitea.tar" ] && [ -f "${BUNDLE_DIR}/bundle.yaml" ]; then
    info "Building bundle tarball..."
    (cd "${BUNDLE_DIR}" && tar czf gitea.bundle.tar.gz bundle.yaml images/)
  else
    fail "Bundle not found at ${BUNDLE_TARBALL}"
    fail "Run: cd ${BUNDLE_DIR} && mkdir -p images && docker buildx build --platform linux/amd64 --no-cache --pull -t gitea-amd64:1.22.0 --load -f- . <<< 'FROM gitea/gitea:1.22.0' && docker save gitea-amd64:1.22.0 -o images/gitea.tar && tar czf gitea.bundle.tar.gz bundle.yaml images/"
    exit 1
  fi
fi
pass "Bundle tarball exists: ${BUNDLE_TARBALL}"

# ──────────────────────────────────────────────────────────────────────────────
step "Step 1: Authenticate with dashboard"
# ──────────────────────────────────────────────────────────────────────────────

oauth2_login

HEALTH_CODE=$(api GET "/api/health" -o /dev/null -w "%{http_code}" 2>/dev/null)
if [ "$HEALTH_CODE" = "200" ]; then
  pass "Authenticated as ${AUTH_USER} (OAuth2 Proxy + Keycloak)"
else
  fail "Dashboard API returned HTTP ${HEALTH_CODE} after OAuth2 login"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 2: Clean up any existing gitea deployment"
# ──────────────────────────────────────────────────────────────────────────────

# Clean up stale pipeline runs (prevent concurrency limit)
api POST "/api/pipeline/cleanup" 2>/dev/null >/dev/null || true

# Delete via dashboard API first
api DELETE "/api/apps/${NAMESPACE}/${APP_NAME}" 2>/dev/null || true

# Fallback: kubectl cleanup
kubectl delete helmrelease "${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
kubectl delete pvc "${APP_NAME}-${APP_NAME}-data" -n "${NAMESPACE}" 2>/dev/null || true

# Wait for HelmRelease to be fully deleted (async via Flux)
info "Waiting for cleanup to complete..."
printf "  "
if wait_for "cleanup" 60 \
  "! kubectl get helmrelease ${APP_NAME} -n ${NAMESPACE} --no-headers 2>/dev/null | grep -q ."; then
  echo ""
  pass "No existing gitea deployment"
else
  echo ""
  # Force delete if still hanging
  kubectl patch helmrelease "${APP_NAME}" -n "${NAMESPACE}" --type=merge -p '{"metadata":{"finalizers":null}}' 2>/dev/null || true
  kubectl delete helmrelease "${APP_NAME}" -n "${NAMESPACE}" --force --grace-period=0 2>/dev/null || true
  sleep 5
  pass "Cleaned up gitea (forced)"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 3: Upload bundle to DSOP pipeline"
# ──────────────────────────────────────────────────────────────────────────────

UPLOAD_RESP=$(api_raw POST "/api/bundle/upload" \
  -F "bundle=@${BUNDLE_TARBALL}" 2>/dev/null)
UPLOAD_ID=$(echo "$UPLOAD_RESP" | jq -r '.uploadId // empty')
BUNDLE_NAME=$(echo "$UPLOAD_RESP" | jq -r '.manifest.metadata.name // empty')

if [ -n "$UPLOAD_ID" ]; then
  pass "Bundle uploaded: uploadId=${UPLOAD_ID}, name=${BUNDLE_NAME}"
else
  fail "Bundle upload failed: ${UPLOAD_RESP}"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 4: Create pipeline run"
# ──────────────────────────────────────────────────────────────────────────────

RUN_RESP=$(api POST "/api/pipeline/runs" -d "{
  \"appName\": \"${APP_NAME}\",
  \"team\": \"${TEAM}\",
  \"sourceType\": \"bundle\",
  \"bundleUploadId\": \"${UPLOAD_ID}\",
  \"classification\": \"UNCLASSIFIED\"
}")
RUN_ID=$(echo "$RUN_RESP" | jq -r '.run.id // .id // empty')

if [ -n "$RUN_ID" ]; then
  pass "Pipeline run created: ${RUN_ID}"
else
  fail "Pipeline run creation failed: ${RUN_RESP}"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 5: Wait for pipeline scanning to complete"
# ──────────────────────────────────────────────────────────────────────────────

info "Waiting for scanning gates to finish (timeout: ${TIMEOUT_PIPELINE}s)..."
printf "  "
# Wait for all automated gates to complete (scanning status ends, or we see review_pending/failed/approved)
if wait_for "pipeline scanning" $TIMEOUT_PIPELINE \
  "api GET '/api/pipeline/runs/${RUN_ID}' 2>/dev/null | jq -e '
    .status == \"review_pending\" or .status == \"approved\" or .status == \"deployed\" or .status == \"failed\" or
    ([.gates[]? | select(.short_name != \"ISSM_REVIEW\" and .short_name != \"IMAGE_SIGNING\") | .status] | all(. == \"passed\" or . == \"failed\" or . == \"skipped\" or . == \"warning\"))
  '"; then
  echo ""
  RUN_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status')
  pass "Pipeline scanning complete — status: ${RUN_STATUS}"
  api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.gates[]? | "    \(.short_name): \(.status)"' 2>/dev/null
else
  echo ""
  RUN_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status // "unknown"')
  fail "Pipeline scanning timed out — status: ${RUN_STATUS}"
  api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.gates[]? | "    \(.short_name): \(.status)"' 2>/dev/null
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 6: Handle security exceptions and ISSM review"
# ──────────────────────────────────────────────────────────────────────────────

if [ "$RUN_STATUS" = "review_pending" ] || [ "$RUN_STATUS" = "scanning" ]; then
  # Mark all CVE findings as false positives (in real life, developer resolves these)
  FINDINGS_COUNT=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '[.findings[]?] | length')
  if [ "${FINDINGS_COUNT:-0}" -gt 0 ]; then
    BULK_RESP=$(api POST "/api/pipeline/runs/${RUN_ID}/findings/bulk" -d '{
      "disposition": "false_positive",
      "mitigation": "E2E test: marking all CVEs as false positives"
    }' 2>/dev/null)
    UPDATED=$(echo "$BULK_RESP" | jq -r '.updated // 0')
    info "Marked ${UPDATED} CVE findings as false positives"
  fi

  # Submit for ISSM review
  info "Submitting for ISSM review..."
  api POST "/api/pipeline/runs/${RUN_ID}/submit-review" 2>/dev/null >/dev/null || true
  sleep 3

  # Wait for review_pending status
  wait_for "review pending" 60 \
    "api GET '/api/pipeline/runs/${RUN_ID}' 2>/dev/null | jq -e '.status == \"review_pending\"'" || true
  RUN_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status')

  # Add security exceptions (run_as_root + writable_filesystem)
  EXC_RESP=$(api POST "/api/pipeline/runs/${RUN_ID}/exceptions" -d '{
    "exceptions": [
      {"type": "run_as_root", "justification": "E2E test: gitea root image requires uid 0"},
      {"type": "writable_filesystem", "justification": "E2E test: gitea writes temp files and caches"}
    ]
  }' 2>/dev/null)
  info "Security exceptions requested"

  # ISSM approve
  REVIEW_RESP=$(api POST "/api/pipeline/runs/${RUN_ID}/review" -d '{
    "decision": "approved",
    "comment": "E2E test auto-approval"
  }' 2>/dev/null)

  if echo "$REVIEW_RESP" | jq -e '.status == "approved" or .message' &>/dev/null; then
    pass "ISSM review approved"
  else
    fail "ISSM review failed: ${REVIEW_RESP}"
    exit 1
  fi
elif [ "$RUN_STATUS" = "approved" ]; then
  pass "Already approved (auto-deploy may be enabled)"
elif [ "$RUN_STATUS" = "deployed" ]; then
  pass "Already deployed"
else
  fail "Unexpected status: ${RUN_STATUS}"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 7: Deploy"
# ──────────────────────────────────────────────────────────────────────────────

RUN_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status')
if [ "$RUN_STATUS" = "approved" ]; then
  DEPLOY_RESP=$(api POST "/api/pipeline/runs/${RUN_ID}/deploy" 2>/dev/null)
  if echo "$DEPLOY_RESP" | jq -e '.message' &>/dev/null; then
    pass "Deployment triggered"
  else
    fail "Deploy trigger failed: ${DEPLOY_RESP}"
    exit 1
  fi
elif [ "$RUN_STATUS" = "deploying" ] || [ "$RUN_STATUS" = "deployed" ]; then
  pass "Already deploying/deployed"
else
  info "Status is ${RUN_STATUS}, waiting..."
fi

# Wait for deployment to complete
info "Waiting for deployment (timeout: ${TIMEOUT_DEPLOY}s)..."
printf "  "
if wait_for "deployment" $TIMEOUT_DEPLOY \
  "api GET '/api/pipeline/runs/${RUN_ID}' 2>/dev/null | jq -e '.status == \"deployed\" or .status == \"deployed_partial\" or .status == \"deployed_unhealthy\"'"; then
  echo ""
  FINAL_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status')
  pass "Deployment complete — status: ${FINAL_STATUS}"
else
  echo ""
  FINAL_STATUS=$(api GET "/api/pipeline/runs/${RUN_ID}" 2>/dev/null | jq -r '.status // "unknown"')
  fail "Deployment timed out — status: ${FINAL_STATUS}"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 8: Validate HelmRelease"
# ──────────────────────────────────────────────────────────────────────────────

HR_STATUS=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "NotFound")
if [ "$HR_STATUS" = "True" ]; then
  pass "HelmRelease is Ready"
else
  HR_MSG=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "N/A")
  fail "HelmRelease not ready: ${HR_MSG}"
fi

# Check security context in HelmRelease
HR_PRIVILEGED=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.values.containerSecurityContext.privileged}' 2>/dev/null || echo "N/A")
HR_RUN_AS_ROOT=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.values.containerSecurityContext.runAsNonRoot}' 2>/dev/null || echo "N/A")
HR_RUN_AS_USER=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.values.containerSecurityContext.runAsUser}' 2>/dev/null || echo "N/A")
HR_IMAGE=$(kubectl get helmrelease "${APP_NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.values.app.image.repository}' 2>/dev/null || echo "N/A")

if [ "$HR_PRIVILEGED" != "true" ]; then
  pass "Not privileged (privileged=${HR_PRIVILEGED:-unset})"
else
  fail "HelmRelease has privileged: true — should NOT be privileged for run-as-root"
fi

if [ "$HR_RUN_AS_ROOT" = "false" ]; then
  pass "runAsNonRoot: false (correct for root container)"
else
  fail "runAsNonRoot should be false, got: ${HR_RUN_AS_ROOT}"
fi

if [ "$HR_RUN_AS_USER" = "0" ]; then
  pass "runAsUser: 0 (root)"
else
  fail "runAsUser should be 0, got: ${HR_RUN_AS_USER}"
fi

if echo "$HR_IMAGE" | grep -q "harbor.apps.sre.example.com"; then
  pass "Image from external Harbor URL: ${HR_IMAGE}"
else
  fail "Image should use harbor.apps.sre.example.com, got: ${HR_IMAGE}"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 9: Validate pod is running"
# ──────────────────────────────────────────────────────────────────────────────

info "Waiting for pod readiness (timeout: ${TIMEOUT_POD}s)..."
printf "  "
if wait_for "pod ready" $TIMEOUT_POD \
  "kubectl get pods -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME} -o jsonpath='{.items[0].status.containerStatuses[?(@.name==\"${APP_NAME}\")].ready}' 2>/dev/null | grep -q 'true'"; then
  echo ""
  POD_NAME=$(kubectl get pods -n "${NAMESPACE}" -l "app.kubernetes.io/name=${APP_NAME}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  pass "Pod running: ${POD_NAME}"
else
  echo ""
  POD_STATUS=$(kubectl get pods -n "${NAMESPACE}" -l "app.kubernetes.io/name=${APP_NAME}" --no-headers 2>/dev/null || echo "No pods found")
  fail "Pod not ready: ${POD_STATUS}"

  # Show events for debugging
  POD_NAME=$(kubectl get pods -n "${NAMESPACE}" -l "app.kubernetes.io/name=${APP_NAME}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [ -n "$POD_NAME" ]; then
    echo -e "\n  ${YELLOW}Pod events:${NC}"
    kubectl get events -n "${NAMESPACE}" --field-selector "involvedObject.name=${POD_NAME}" --sort-by='.lastTimestamp' 2>/dev/null | tail -10 | sed 's/^/    /'
    echo -e "\n  ${YELLOW}Container logs:${NC}"
    kubectl logs -n "${NAMESPACE}" "${POD_NAME}" -c "${APP_NAME}" --tail=5 2>/dev/null | sed 's/^/    /' || true
  fi
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 10: Validate app is accessible"
# ──────────────────────────────────────────────────────────────────────────────

# Give ingress a moment to propagate
sleep 5

# Access through OAuth2 Proxy (uses session cookies from Step 1)
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -b "${COOKIE_JAR}" "https://${INGRESS_HOST}/" --max-time 10 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  pass "Gitea accessible at https://${INGRESS_HOST}/ (HTTP ${HTTP_CODE})"
elif [ "$HTTP_CODE" = "403" ]; then
  # OAuth2 Proxy may need a fresh login for this hostname
  KC_LOGIN_URL=$(curl -sk -L -o /dev/null -w "%{url_effective}" \
    "https://${INGRESS_HOST}/oauth2/start?rd=/" \
    -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" 2>/dev/null)
  KC_ACTION_URL=$(curl -sk "${KC_LOGIN_URL}" \
    -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" 2>/dev/null \
    | grep -oP 'action="[^"]*"' | head -1 \
    | sed 's/action="//;s/"$//' | sed 's/&amp;/\&/g')
  if [ -n "$KC_ACTION_URL" ]; then
    curl -sk -L -o /dev/null \
      -d "username=${AUTH_USER}" -d "password=${AUTH_PASS}" \
      -c "${COOKIE_JAR}" -b "${COOKIE_JAR}" \
      "${KC_ACTION_URL}" 2>/dev/null
  fi
  HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -b "${COOKIE_JAR}" "https://${INGRESS_HOST}/" --max-time 10 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    pass "Gitea accessible at https://${INGRESS_HOST}/ (HTTP ${HTTP_CODE})"
  else
    fail "Gitea not accessible (HTTP ${HTTP_CODE})"
  fi
elif [ "$HTTP_CODE" = "503" ]; then
  info "Got 503, waiting 15s for Istio routing..."
  sleep 15
  HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -b "${COOKIE_JAR}" "https://${INGRESS_HOST}/" --max-time 10 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    pass "Gitea accessible at https://${INGRESS_HOST}/ (HTTP ${HTTP_CODE})"
  else
    fail "Gitea not accessible (HTTP ${HTTP_CODE})"
  fi
else
  fail "Gitea not accessible at https://${INGRESS_HOST}/ (HTTP ${HTTP_CODE})"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Step 11: Validate PolicyException was created"
# ──────────────────────────────────────────────────────────────────────────────

PE_EXISTS=$(kubectl get policyexception -n "${NAMESPACE}" -o name 2>/dev/null | grep -c "${APP_NAME}" || echo "0")
if [ "$PE_EXISTS" -gt 0 ]; then
  PE_NAME=$(kubectl get policyexception -n "${NAMESPACE}" -o name 2>/dev/null | grep "${APP_NAME}" | head -1)
  pass "PolicyException exists: ${PE_NAME}"
  PE_POLICIES=$(kubectl get "${PE_NAME}" -n "${NAMESPACE}" -o jsonpath='{range .spec.exceptions[*]}{.policyName}{" "}{end}' 2>/dev/null)
  info "Exempted policies: ${PE_POLICIES}"
else
  fail "No PolicyException found for ${APP_NAME}"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Cleanup"
# ──────────────────────────────────────────────────────────────────────────────

if [ "$KEEP" = "true" ]; then
  info "Keeping deployment (--keep flag set)"
else
  api DELETE "/api/apps/${NAMESPACE}/${APP_NAME}" 2>/dev/null || true
  kubectl delete helmrelease "${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
  kubectl delete pvc "${APP_NAME}-${APP_NAME}-data" -n "${NAMESPACE}" 2>/dev/null || true
  pass "Cleaned up gitea deployment"
fi

# ──────────────────────────────────────────────────────────────────────────────
step "Results"
# ──────────────────────────────────────────────────────────────────────────────

echo ""
if [ $FAILURES -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}ALL CHECKS PASSED${NC}"
  exit 0
else
  echo -e "  ${RED}${BOLD}${FAILURES} CHECK(S) FAILED${NC}"
  exit 1
fi
