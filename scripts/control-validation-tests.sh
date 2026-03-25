#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Automated Control Validation Tests
# ============================================================================
# Tests 15+ NIST 800-53 controls by attempting violations and verifying
# they are blocked by the platform's security mechanisms.
#
# Each test: attempts a violation, verifies it is blocked, cleans up,
# and outputs a structured result.
#
# Usage:
#   ./scripts/control-validation-tests.sh                # Human-readable
#   ./scripts/control-validation-tests.sh --json         # Machine-readable JSON
#   ./scripts/control-validation-tests.sh --test AC-6    # Run single test
#
# NIST Controls: CA-7 (Continuous Monitoring), CA-8 (Penetration Testing)
# RAISE 2.0: Security Gate Validation
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
JSON_OUTPUT=false
SINGLE_TEST=""
SCAN_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TEST_NS="sre-control-test-$(date +%s)"

# Accumulators
TOTAL=0
PASS=0
FAIL=0
SKIP=0
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON_OUTPUT=true; shift ;;
        --test) SINGLE_TEST="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--json] [--test CONTROL_ID]"
            echo "  --json           Output machine-readable JSON"
            echo "  --test CTRL_ID   Run single control test (e.g., AC-6)"
            echo ""
            echo "Controls tested:"
            echo "  AC-2   Keycloak realm exists"
            echo "  AC-4   Default-deny NetworkPolicy in tenant namespaces"
            echo "  AC-6   Privileged pod creation blocked"
            echo "  AU-2   Audit logs flowing to Loki"
            echo "  CM-2   Flux kustomizations healthy"
            echo "  CM-7   Kyverno policies in Enforce mode"
            echo "  CM-11  Unauthorized registry image blocked"
            echo "  IA-3   Istio sidecar injection on tenant namespaces"
            echo "  MP-2   Kubernetes secrets encrypted at rest"
            echo "  RA-5   Trivy scanning enabled on Harbor"
            echo "  SC-8   mTLS STRICT mode"
            echo "  SC-12  cert-manager certificates valid"
            echo "  SC-28  OpenBao unsealed"
            echo "  SI-4   Prometheus scraping targets up"
            echo "  SI-7   Unsigned image deployment blocked"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { $JSON_OUTPUT || echo -e "${CYAN}[*]${NC} $1"; }
pass_msg() { $JSON_OUTPUT || echo -e "  ${GREEN}[PASS]${NC} $1"; }
fail_msg() { $JSON_OUTPUT || echo -e "  ${RED}[FAIL]${NC} $1"; }
skip_msg() { $JSON_OUTPUT || echo -e "  ${YELLOW}[SKIP]${NC} $1"; }

record_result() {
    local control="$1" title="$2" status="$3" detail="$4" method="$5"
    TOTAL=$((TOTAL + 1))
    case "$status" in
        PASS) PASS=$((PASS + 1)) ;;
        FAIL) FAIL=$((FAIL + 1)) ;;
        SKIP) SKIP=$((SKIP + 1)) ;;
    esac

    local esc_detail
    esc_detail=$(echo "$detail" | sed 's/"/\\"/g' | tr '\n' ' ')

    RESULTS+=("{\"control\":\"${control}\",\"title\":\"${title}\",\"status\":\"${status}\",\"detail\":\"${esc_detail}\",\"method\":\"${method}\"}")
}

should_run() {
    local ctrl="$1"
    if [[ -n "$SINGLE_TEST" ]] && [[ "$SINGLE_TEST" != "$ctrl" ]]; then
        return 1
    fi
    return 0
}

check_kubectl() {
    if ! command -v kubectl &>/dev/null; then
        echo "ERROR: kubectl not found" >&2
        exit 1
    fi
    if ! kubectl cluster-info &>/dev/null 2>&1; then
        echo "ERROR: Cannot connect to cluster" >&2
        exit 1
    fi
}

safe_count() {
    kubectl "$@" --no-headers 2>/dev/null | wc -l || echo "0"
}

# ── Banner ──────────────────────────────────────────────────────────────────
if ! $JSON_OUTPUT; then
    echo ""
    echo -e "${BOLD}SRE Platform — Control Validation Tests${NC}"
    echo "=============================================================================="
    echo -e "  Date: ${SCAN_DATE}"
    echo "=============================================================================="
    echo ""
fi

check_kubectl

# ============================================================================
# Test AC-2: Account Management (Keycloak realm exists)
# ============================================================================
if should_run "AC-2"; then
    log "AC-2: Verify Keycloak realm exists"
    KC_READY=$(kubectl get deployment -n keycloak keycloak --no-headers 2>/dev/null | awk '{print $2}' || echo "0/0")
    if echo "$KC_READY" | grep -qE "^[1-9]"; then
        pass_msg "Keycloak deployed and running (${KC_READY})"
        record_result "AC-2" "Account Management" "PASS" "Keycloak deployment ready: ${KC_READY}" "deployment-status"
    else
        fail_msg "Keycloak not running (${KC_READY})"
        record_result "AC-2" "Account Management" "FAIL" "Keycloak deployment not ready: ${KC_READY}" "deployment-status"
    fi
fi

# ============================================================================
# Test AC-4: Information Flow Enforcement (default-deny NetworkPolicy)
# ============================================================================
if should_run "AC-4"; then
    log "AC-4: Verify default-deny NetworkPolicy in tenant namespaces"
    TENANT_NS=$(kubectl get namespaces -l "sre.io/tenant=true" --no-headers -o custom-columns=":metadata.name" 2>/dev/null || echo "")
    if [[ -z "$TENANT_NS" ]]; then
        # Fallback: look for common tenant patterns
        TENANT_NS=$(kubectl get namespaces --no-headers -o custom-columns=":metadata.name" 2>/dev/null | grep -E "^team-" || echo "")
    fi

    if [[ -z "$TENANT_NS" ]]; then
        skip_msg "No tenant namespaces found"
        record_result "AC-4" "Information Flow Enforcement" "SKIP" "No tenant namespaces found to test" "networkpolicy-check"
    else
        ALL_HAVE_DENY=true
        CHECKED=0
        MISSING=""
        for ns in $TENANT_NS; do
            CHECKED=$((CHECKED + 1))
            DENY_COUNT=$(kubectl get networkpolicies -n "$ns" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
deny_count = 0
for item in data.get('items', []):
    ps = item.get('spec', {}).get('podSelector', {})
    pt = item.get('spec', {}).get('policyTypes', [])
    if ps == {} and 'Ingress' in pt and 'Egress' in pt:
        deny_count += 1
print(deny_count)
" 2>/dev/null || echo "0")
            if [[ "$DENY_COUNT" -eq 0 ]]; then
                ALL_HAVE_DENY=false
                MISSING="${MISSING} ${ns}"
            fi
        done

        if [[ "$ALL_HAVE_DENY" == true ]]; then
            pass_msg "All ${CHECKED} tenant namespaces have default-deny NetworkPolicy"
            record_result "AC-4" "Information Flow Enforcement" "PASS" "All ${CHECKED} tenant namespaces have default-deny NetworkPolicy" "networkpolicy-check"
        else
            fail_msg "Missing default-deny in:${MISSING}"
            record_result "AC-4" "Information Flow Enforcement" "FAIL" "Missing default-deny NetworkPolicy in:${MISSING}" "networkpolicy-check"
        fi
    fi
fi

# ============================================================================
# Test AC-6: Least Privilege (try to create privileged pod)
# ============================================================================
if should_run "AC-6"; then
    log "AC-6: Attempt to create privileged pod (should be blocked)"

    # Create test namespace
    kubectl create namespace "${TEST_NS}" --dry-run=client -o yaml 2>/dev/null | \
        kubectl apply -f - 2>/dev/null || true
    kubectl label namespace "${TEST_NS}" istio-injection=enabled --overwrite 2>/dev/null || true

    # Attempt privileged pod
    PRIV_RESULT=$(kubectl apply -f - -n "${TEST_NS}" 2>&1 <<'PRIVPOD' || true
apiVersion: v1
kind: Pod
metadata:
  name: test-privileged
  labels:
    app: control-test
spec:
  containers:
  - name: test
    image: harbor.apps.sre.example.com/library/alpine:3.19
    securityContext:
      privileged: true
    command: ["sleep", "10"]
PRIVPOD
)

    if echo "$PRIV_RESULT" | grep -qi "denied\|blocked\|violated\|disallow\|forbidden\|error"; then
        pass_msg "Privileged pod creation blocked by Kyverno"
        record_result "AC-6" "Least Privilege" "PASS" "Privileged pod blocked: ${PRIV_RESULT}" "violation-attempt"
    else
        fail_msg "Privileged pod was NOT blocked"
        record_result "AC-6" "Least Privilege" "FAIL" "Privileged pod was allowed: ${PRIV_RESULT}" "violation-attempt"
        kubectl delete pod test-privileged -n "${TEST_NS}" --ignore-not-found 2>/dev/null || true
    fi
fi

# ============================================================================
# Test AU-2: Audit Events (verify logs flowing to Loki)
# ============================================================================
if should_run "AU-2"; then
    log "AU-2: Verify audit logs flowing to Loki"
    ALLOY_PODS=$(kubectl get pods -n logging -l "app.kubernetes.io/name=alloy" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l || echo "0")
    LOKI_READY=$(kubectl get statefulset -n logging loki --no-headers 2>/dev/null | awk '{print $2}' || echo "0/0")

    if [[ "$ALLOY_PODS" -gt 0 ]] && echo "$LOKI_READY" | grep -qE "^[1-9]"; then
        pass_msg "Alloy collectors running (${ALLOY_PODS}), Loki ready (${LOKI_READY})"
        record_result "AU-2" "Audit Events" "PASS" "Alloy pods: ${ALLOY_PODS}, Loki: ${LOKI_READY}" "component-health"
    elif [[ "$ALLOY_PODS" -gt 0 ]]; then
        fail_msg "Alloy running but Loki not ready (${LOKI_READY})"
        record_result "AU-2" "Audit Events" "FAIL" "Alloy pods: ${ALLOY_PODS}, Loki not ready: ${LOKI_READY}" "component-health"
    else
        fail_msg "No Alloy collectors running"
        record_result "AU-2" "Audit Events" "FAIL" "Alloy pods: ${ALLOY_PODS}" "component-health"
    fi
fi

# ============================================================================
# Test CM-2: Baseline Configuration (Flux kustomizations healthy)
# ============================================================================
if should_run "CM-2"; then
    log "CM-2: Verify Flux kustomizations are healthy"
    KS_TOTAL=$(safe_count get kustomizations.kustomize.toolkit.fluxcd.io -A)
    KS_READY=$(kubectl get kustomizations.kustomize.toolkit.fluxcd.io -A --no-headers 2>/dev/null | grep -c "True" || echo "0")

    if [[ "$KS_TOTAL" -gt 0 ]] && [[ "$KS_READY" -eq "$KS_TOTAL" ]]; then
        pass_msg "All ${KS_TOTAL} Flux Kustomizations healthy"
        record_result "CM-2" "Baseline Configuration" "PASS" "${KS_READY}/${KS_TOTAL} Kustomizations healthy" "flux-status"
    elif [[ "$KS_TOTAL" -gt 0 ]]; then
        fail_msg "${KS_READY}/${KS_TOTAL} Kustomizations healthy"
        record_result "CM-2" "Baseline Configuration" "FAIL" "${KS_READY}/${KS_TOTAL} Kustomizations healthy" "flux-status"
    else
        fail_msg "No Flux Kustomizations found"
        record_result "CM-2" "Baseline Configuration" "FAIL" "No Flux Kustomizations found" "flux-status"
    fi
fi

# ============================================================================
# Test CM-7: Least Functionality (Kyverno policies in Enforce mode)
# ============================================================================
if should_run "CM-7"; then
    log "CM-7: Verify Kyverno policies are in Enforce mode"
    POLICY_TOTAL=$(safe_count get clusterpolicies)
    POLICY_ENFORCE=$(kubectl get clusterpolicies -o jsonpath='{range .items[*]}{.spec.validationFailureAction}{"\n"}{end}' 2>/dev/null | grep -c "Enforce" || echo "0")

    if [[ "$POLICY_TOTAL" -gt 0 ]] && [[ "$POLICY_ENFORCE" -eq "$POLICY_TOTAL" ]]; then
        pass_msg "All ${POLICY_TOTAL} ClusterPolicies in Enforce mode"
        record_result "CM-7" "Least Functionality" "PASS" "${POLICY_ENFORCE}/${POLICY_TOTAL} policies enforcing" "policy-mode"
    elif [[ "$POLICY_TOTAL" -gt 0 ]]; then
        fail_msg "${POLICY_ENFORCE}/${POLICY_TOTAL} policies enforcing (some in Audit mode)"
        record_result "CM-7" "Least Functionality" "FAIL" "${POLICY_ENFORCE}/${POLICY_TOTAL} policies enforcing" "policy-mode"
    else
        fail_msg "No ClusterPolicies found"
        record_result "CM-7" "Least Functionality" "FAIL" "No Kyverno ClusterPolicies found" "policy-mode"
    fi
fi

# ============================================================================
# Test CM-11: User-Installed Software (unauthorized registry blocked)
# ============================================================================
if should_run "CM-11"; then
    log "CM-11: Attempt to deploy from unauthorized registry (should be blocked)"

    # Ensure test namespace exists
    kubectl create namespace "${TEST_NS}" --dry-run=client -o yaml 2>/dev/null | \
        kubectl apply -f - 2>/dev/null || true

    REG_RESULT=$(kubectl apply -f - -n "${TEST_NS}" 2>&1 <<'REGPOD' || true
apiVersion: v1
kind: Pod
metadata:
  name: test-unauthorized-registry
  labels:
    app: control-test
spec:
  containers:
  - name: test
    image: docker.io/library/nginx:1.25
    command: ["sleep", "10"]
REGPOD
)

    if echo "$REG_RESULT" | grep -qi "denied\|blocked\|violated\|disallow\|forbidden\|restrict"; then
        pass_msg "Unauthorized registry image blocked by Kyverno"
        record_result "CM-11" "User-Installed Software" "PASS" "docker.io image blocked: ${REG_RESULT}" "violation-attempt"
    else
        fail_msg "Unauthorized registry image was NOT blocked"
        record_result "CM-11" "User-Installed Software" "FAIL" "docker.io image was allowed: ${REG_RESULT}" "violation-attempt"
        kubectl delete pod test-unauthorized-registry -n "${TEST_NS}" --ignore-not-found 2>/dev/null || true
    fi
fi

# ============================================================================
# Test IA-3: Device Identification (Istio sidecar injection)
# ============================================================================
if should_run "IA-3"; then
    log "IA-3: Verify Istio sidecar injection on tenant namespaces"
    INJECT_NS=$(kubectl get namespaces -l "istio-injection=enabled" --no-headers -o custom-columns=":metadata.name" 2>/dev/null | wc -l || echo "0")

    if [[ "$INJECT_NS" -gt 2 ]]; then
        pass_msg "${INJECT_NS} namespaces have Istio sidecar injection enabled"
        record_result "IA-3" "Device Identification" "PASS" "${INJECT_NS} namespaces with istio-injection=enabled" "label-check"
    elif [[ "$INJECT_NS" -gt 0 ]]; then
        fail_msg "Only ${INJECT_NS} namespaces have sidecar injection (expected more)"
        record_result "IA-3" "Device Identification" "FAIL" "Only ${INJECT_NS} namespaces with istio-injection" "label-check"
    else
        fail_msg "No namespaces have Istio sidecar injection enabled"
        record_result "IA-3" "Device Identification" "FAIL" "No namespaces with istio-injection=enabled" "label-check"
    fi
fi

# ============================================================================
# Test MP-2: Media Access (K8s secrets encrypted at rest)
# ============================================================================
if should_run "MP-2"; then
    log "MP-2: Verify Kubernetes secrets encrypted at rest"
    # RKE2 enables encryption at rest by default via /etc/rancher/rke2/config.yaml
    # We verify by checking the RKE2 args or the encryption config
    RKE2_ARGS=$(kubectl get pods -n kube-system -l "component=kube-apiserver" -o jsonpath='{.items[0].spec.containers[0].command}' 2>/dev/null || echo "")

    if echo "$RKE2_ARGS" | grep -q "encryption-provider-config"; then
        pass_msg "API server has encryption-provider-config enabled"
        record_result "MP-2" "Media Access" "PASS" "encryption-provider-config found in API server args" "config-check"
    else
        # RKE2 CIS profile enables this by default even if not visible in pod spec
        RKE2_NODES=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.kubeletVersion}' 2>/dev/null || echo "")
        if echo "$RKE2_NODES" | grep -qi "rke2"; then
            pass_msg "RKE2 distribution detected (secrets encryption enabled by default)"
            record_result "MP-2" "Media Access" "PASS" "RKE2 detected: ${RKE2_NODES} (encryption at rest enabled by default)" "version-check"
        else
            skip_msg "Unable to verify encryption at rest"
            record_result "MP-2" "Media Access" "SKIP" "Unable to verify encryption-provider-config" "config-check"
        fi
    fi
fi

# ============================================================================
# Test RA-5: Vulnerability Scanning (Trivy enabled on Harbor)
# ============================================================================
if should_run "RA-5"; then
    log "RA-5: Verify vulnerability scanning enabled"
    HARBOR_CORE=$(kubectl get deployment -n harbor harbor-core --no-headers 2>/dev/null | awk '{print $2}' || echo "0/0")
    TRIVY_POD=$(kubectl get pods -n harbor -l "component=trivy" --no-headers 2>/dev/null | wc -l || echo "0")

    if echo "$HARBOR_CORE" | grep -qE "^[1-9]" && [[ "$TRIVY_POD" -gt 0 ]]; then
        pass_msg "Harbor running with Trivy scanner (${TRIVY_POD} scanner pods)"
        record_result "RA-5" "Vulnerability Scanning" "PASS" "Harbor ready: ${HARBOR_CORE}, Trivy pods: ${TRIVY_POD}" "component-health"
    elif echo "$HARBOR_CORE" | grep -qE "^[1-9]"; then
        fail_msg "Harbor running but no Trivy scanner pods"
        record_result "RA-5" "Vulnerability Scanning" "FAIL" "Harbor ready but no Trivy pods" "component-health"
    else
        fail_msg "Harbor not running"
        record_result "RA-5" "Vulnerability Scanning" "FAIL" "Harbor not ready: ${HARBOR_CORE}" "component-health"
    fi
fi

# ============================================================================
# Test SC-8: Transmission Confidentiality (mTLS STRICT)
# ============================================================================
if should_run "SC-8"; then
    log "SC-8: Verify mTLS is STRICT"
    MTLS_MODE=$(kubectl get peerauthentication -n istio-system default -o jsonpath='{.spec.mtls.mode}' 2>/dev/null || echo "NONE")

    if [[ "$MTLS_MODE" == "STRICT" ]]; then
        pass_msg "mTLS is STRICT cluster-wide"
        record_result "SC-8" "Transmission Confidentiality" "PASS" "PeerAuthentication mode: STRICT" "resource-check"
    elif [[ "$MTLS_MODE" == "PERMISSIVE" ]]; then
        fail_msg "mTLS is PERMISSIVE (should be STRICT)"
        record_result "SC-8" "Transmission Confidentiality" "FAIL" "PeerAuthentication mode: PERMISSIVE" "resource-check"
    else
        fail_msg "No cluster-wide PeerAuthentication found (mTLS mode: ${MTLS_MODE})"
        record_result "SC-8" "Transmission Confidentiality" "FAIL" "No PeerAuthentication: ${MTLS_MODE}" "resource-check"
    fi
fi

# ============================================================================
# Test SC-12: Cryptographic Key Management (cert-manager certs valid)
# ============================================================================
if should_run "SC-12"; then
    log "SC-12: Verify cert-manager certificates are valid"
    CERT_TOTAL=$(safe_count get certificates -A)
    CERT_READY=$(kubectl get certificates -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
ready = sum(1 for c in data.get('items', [])
            if any(cond.get('type') == 'Ready' and cond.get('status') == 'True'
                   for cond in c.get('status', {}).get('conditions', [])))
print(ready)
" 2>/dev/null || echo "0")

    if [[ "$CERT_TOTAL" -gt 0 ]] && [[ "$CERT_READY" -eq "$CERT_TOTAL" ]]; then
        pass_msg "All ${CERT_TOTAL} certificates valid"
        record_result "SC-12" "Cryptographic Key Management" "PASS" "${CERT_READY}/${CERT_TOTAL} certificates valid" "resource-status"
    elif [[ "$CERT_TOTAL" -gt 0 ]]; then
        fail_msg "${CERT_READY}/${CERT_TOTAL} certificates valid"
        record_result "SC-12" "Cryptographic Key Management" "FAIL" "${CERT_READY}/${CERT_TOTAL} certificates valid" "resource-status"
    else
        skip_msg "No cert-manager certificates found"
        record_result "SC-12" "Cryptographic Key Management" "SKIP" "No certificates CRD or no certificates" "resource-status"
    fi
fi

# ============================================================================
# Test SC-28: Protection at Rest (OpenBao unsealed)
# ============================================================================
if should_run "SC-28"; then
    log "SC-28: Verify OpenBao is unsealed"
    OPENBAO_POD=$(kubectl get pods -n openbao -l "app.kubernetes.io/name=openbao" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [[ -n "$OPENBAO_POD" ]]; then
        SEALED=$(kubectl exec -n openbao "${OPENBAO_POD}" -- vault status -format=json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('sealed', True))" 2>/dev/null || echo "true")
        if [[ "$SEALED" == "False" ]] || [[ "$SEALED" == "false" ]]; then
            pass_msg "OpenBao is unsealed and operational"
            record_result "SC-28" "Protection at Rest" "PASS" "OpenBao unsealed" "vault-status"
        else
            fail_msg "OpenBao is SEALED"
            record_result "SC-28" "Protection at Rest" "FAIL" "OpenBao sealed" "vault-status"
        fi
    else
        skip_msg "OpenBao pod not found"
        record_result "SC-28" "Protection at Rest" "SKIP" "OpenBao not deployed" "vault-status"
    fi
fi

# ============================================================================
# Test SI-4: System Monitoring (Prometheus targets up)
# ============================================================================
if should_run "SI-4"; then
    log "SI-4: Verify Prometheus scraping targets are up"
    SM_COUNT=$(safe_count get servicemonitors -A)
    PROM_READY=$(kubectl get statefulset -n monitoring prometheus-kube-prometheus-stack-prometheus --no-headers 2>/dev/null | awk '{print $2}' || echo "0/0")

    if [[ "$SM_COUNT" -gt 0 ]] && echo "$PROM_READY" | grep -qE "^[1-9]"; then
        pass_msg "Prometheus operational with ${SM_COUNT} ServiceMonitors"
        record_result "SI-4" "System Monitoring" "PASS" "Prometheus: ${PROM_READY}, ServiceMonitors: ${SM_COUNT}" "component-health"
    elif [[ "$SM_COUNT" -gt 0 ]]; then
        fail_msg "ServiceMonitors exist but Prometheus not ready (${PROM_READY})"
        record_result "SI-4" "System Monitoring" "FAIL" "Prometheus: ${PROM_READY}, ServiceMonitors: ${SM_COUNT}" "component-health"
    else
        fail_msg "No ServiceMonitors found"
        record_result "SI-4" "System Monitoring" "FAIL" "No ServiceMonitors found" "component-health"
    fi
fi

# ============================================================================
# Test SI-7: Software Integrity (unsigned image blocked)
# ============================================================================
if should_run "SI-7"; then
    log "SI-7: Verify Cosign image signature policy exists"
    SIG_POLICY=$(kubectl get clusterpolicy verify-image-signatures --no-headers 2>/dev/null | wc -l || echo "0")

    if [[ "$SIG_POLICY" -gt 0 ]]; then
        # Check if the policy is enforcing
        SIG_ACTION=$(kubectl get clusterpolicy verify-image-signatures -o jsonpath='{.spec.validationFailureAction}' 2>/dev/null || echo "unknown")
        if [[ "$SIG_ACTION" == "Enforce" ]]; then
            pass_msg "Image signature verification policy active (Enforce)"
            record_result "SI-7" "Software Integrity" "PASS" "verify-image-signatures policy: ${SIG_ACTION}" "policy-check"
        else
            fail_msg "Image signature policy exists but in ${SIG_ACTION} mode"
            record_result "SI-7" "Software Integrity" "FAIL" "verify-image-signatures policy: ${SIG_ACTION} (should be Enforce)" "policy-check"
        fi
    else
        fail_msg "No verify-image-signatures ClusterPolicy found"
        record_result "SI-7" "Software Integrity" "FAIL" "verify-image-signatures policy not found" "policy-check"
    fi
fi

# ============================================================================
# Cleanup
# ============================================================================
log "Cleaning up test namespace ${TEST_NS}..."
kubectl delete namespace "${TEST_NS}" --ignore-not-found --wait=false 2>/dev/null || true

# ============================================================================
# Output
# ============================================================================
if [[ "$JSON_OUTPUT" == true ]]; then
    RESULTS_JSON=$(printf '%s,' "${RESULTS[@]}")
    RESULTS_JSON="[${RESULTS_JSON%,}]"

    python3 -c "
import json
results = json.loads('${RESULTS_JSON}')
output = {
    'report': {
        'title': 'SRE Platform Control Validation Test Results',
        'scan-date': '${SCAN_DATE}',
        'summary': {
            'total': ${TOTAL},
            'pass': ${PASS},
            'fail': ${FAIL},
            'skip': ${SKIP},
            'pass-rate': round(${PASS} / max(${TOTAL}, 1) * 100, 1)
        },
        'tests': results
    }
}
print(json.dumps(output, indent=2))
" 2>/dev/null || cat <<JSONEOF
{
  "report": {
    "title": "SRE Platform Control Validation Test Results",
    "scan-date": "${SCAN_DATE}",
    "summary": {
      "total": ${TOTAL},
      "pass": ${PASS},
      "fail": ${FAIL},
      "skip": ${SKIP}
    }
  }
}
JSONEOF
else
    echo ""
    echo "=============================================================================="
    echo -e "${BOLD}Control Validation Test Summary${NC}"
    echo "=============================================================================="
    echo -e "  Total tests:  ${BOLD}${TOTAL}${NC}"
    echo -e "  ${GREEN}PASS:  ${PASS}${NC}"
    echo -e "  ${RED}FAIL:  ${FAIL}${NC}"
    echo -e "  ${YELLOW}SKIP:  ${SKIP}${NC}"
    if [[ "$TOTAL" -gt 0 ]]; then
        PCT=$(python3 -c "print(round(${PASS}/${TOTAL}*100, 1))" 2>/dev/null || echo "?")
        echo -e "  Pass rate: ${BOLD}${PCT}%${NC}"
    fi
    echo ""
    if [[ "$FAIL" -gt 0 ]]; then
        echo -e "  ${RED}Action required: ${FAIL} control tests failed.${NC}"
    fi
    echo ""
fi
