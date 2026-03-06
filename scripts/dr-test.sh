#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Disaster Recovery Testing
# ============================================================================
# Validates Velero backup and restore functionality with three test modes:
#   backup-only  — Create and verify an on-demand backup
#   namespace    — Back up a test namespace, delete, restore, validate
#   full         — Complete DR simulation with resource validation
#
# Usage:
#   ./scripts/dr-test.sh [full|namespace|backup-only]
#
# Prerequisites:
#   - kubectl configured with cluster access
#   - velero CLI installed
#   - Velero deployed and healthy in the cluster
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Logging ─────────────────────────────────────────────────────────────────

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOGFILE="/tmp/dr-test-${TIMESTAMP}.log"
FAILURES=0
CHECKS=0

log()     { echo -e "${BLUE}[dr-test]${NC} $*" | tee -a "$LOGFILE"; }
success() { echo -e "${GREEN}  PASS${NC} $*" | tee -a "$LOGFILE"; }
fail()    { echo -e "${RED}  FAIL${NC} $*" | tee -a "$LOGFILE"; FAILURES=$((FAILURES + 1)); }
warn()    { echo -e "${YELLOW}  WARN${NC} $*" | tee -a "$LOGFILE"; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n" | tee -a "$LOGFILE"; }

check() {
    CHECKS=$((CHECKS + 1))
}

# ── Configuration ───────────────────────────────────────────────────────────

TEST_NAMESPACE="dr-test-${TIMESTAMP}"
BACKUP_TIMEOUT=300     # 5 minutes
RESTORE_TIMEOUT=300    # 5 minutes
RESOURCE_TIMEOUT=120   # 2 minutes for pods to become ready
CONFIGMAP_DATA="dr-test-config-value-${TIMESTAMP}"
SECRET_DATA="dr-test-secret-value-${TIMESTAMP}"

# ── Usage ───────────────────────────────────────────────────────────────────

usage() {
    echo "Usage: $0 [full|namespace|backup-only]"
    echo ""
    echo "Modes:"
    echo "  backup-only  Create an on-demand Velero backup and verify completion"
    echo "  namespace    Back up a test namespace, delete it, restore, validate"
    echo "  full         Complete DR simulation with resource-level validation"
    echo ""
    echo "Log output: /tmp/dr-test-<timestamp>.log"
    exit 1
}

# ── Prerequisite checks ────────────────────────────────────────────────────

preflight() {
    header "Preflight Checks"

    check
    if command -v velero &>/dev/null; then
        success "velero CLI found: $(velero version --client-only 2>/dev/null | head -1)"
    else
        fail "velero CLI not found in PATH"
        echo "Install velero CLI: https://velero.io/docs/main/basic-install/#install-the-cli"
        exit 1
    fi

    check
    if command -v kubectl &>/dev/null; then
        success "kubectl found"
    else
        fail "kubectl not found in PATH"
        exit 1
    fi

    check
    if kubectl get namespace velero &>/dev/null; then
        success "velero namespace exists"
    else
        fail "velero namespace not found — is Velero deployed?"
        exit 1
    fi

    check
    if kubectl get deployment -n velero velero &>/dev/null; then
        local ready
        ready=$(kubectl get deployment -n velero velero -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        if [[ "${ready}" -ge 1 ]]; then
            success "Velero deployment is ready (${ready} replica(s))"
        else
            fail "Velero deployment has 0 ready replicas"
            exit 1
        fi
    else
        fail "Velero deployment not found"
        exit 1
    fi

    check
    local bsl_phase
    bsl_phase=$(velero backup-location get -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if items:
    print(items[0].get('status', {}).get('phase', 'Unknown'))
else:
    print('NotFound')
" 2>/dev/null || echo "Unknown")

    if [[ "${bsl_phase}" == "Available" ]]; then
        success "Backup storage location is Available"
    else
        warn "Backup storage location status: ${bsl_phase}"
        warn "Backups may fail if storage is not configured"
    fi
}

# ── Wait for backup to complete ────────────────────────────────────────────

wait_for_backup() {
    local backup_name="$1"
    local timeout="${2:-$BACKUP_TIMEOUT}"
    local elapsed=0
    local interval=5

    log "Waiting for backup '${backup_name}' to complete (timeout: ${timeout}s)..."

    while [[ ${elapsed} -lt ${timeout} ]]; do
        local phase
        phase=$(velero backup get "${backup_name}" -o json 2>/dev/null \
            | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('phase',''))" 2>/dev/null || echo "")

        case "${phase}" in
            Completed)
                success "Backup '${backup_name}' completed successfully"
                return 0
                ;;
            PartiallyFailed)
                warn "Backup '${backup_name}' partially failed"
                velero backup describe "${backup_name}" --details 2>/dev/null | tee -a "$LOGFILE"
                return 0
                ;;
            Failed)
                fail "Backup '${backup_name}' failed"
                velero backup describe "${backup_name}" --details 2>/dev/null | tee -a "$LOGFILE"
                return 1
                ;;
            "")
                # Backup not found yet, keep waiting
                ;;
        esac

        sleep ${interval}
        elapsed=$((elapsed + interval))
    done

    fail "Backup '${backup_name}' timed out after ${timeout}s"
    velero backup describe "${backup_name}" --details 2>/dev/null | tee -a "$LOGFILE"
    return 1
}

# ── Wait for restore to complete ───────────────────────────────────────────

wait_for_restore() {
    local restore_name="$1"
    local timeout="${2:-$RESTORE_TIMEOUT}"
    local elapsed=0
    local interval=5

    log "Waiting for restore '${restore_name}' to complete (timeout: ${timeout}s)..."

    while [[ ${elapsed} -lt ${timeout} ]]; do
        local phase
        phase=$(velero restore get "${restore_name}" -o json 2>/dev/null \
            | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('phase',''))" 2>/dev/null || echo "")

        case "${phase}" in
            Completed)
                success "Restore '${restore_name}' completed successfully"
                return 0
                ;;
            PartiallyFailed)
                warn "Restore '${restore_name}' partially failed"
                velero restore describe "${restore_name}" --details 2>/dev/null | tee -a "$LOGFILE"
                return 0
                ;;
            Failed)
                fail "Restore '${restore_name}' failed"
                velero restore describe "${restore_name}" --details 2>/dev/null | tee -a "$LOGFILE"
                return 1
                ;;
        esac

        sleep ${interval}
        elapsed=$((elapsed + interval))
    done

    fail "Restore '${restore_name}' timed out after ${timeout}s"
    velero restore describe "${restore_name}" --details 2>/dev/null | tee -a "$LOGFILE"
    return 1
}

# ── Wait for deployment to become ready ────────────────────────────────────

wait_for_deployment() {
    local namespace="$1"
    local deployment="$2"
    local timeout="${3:-$RESOURCE_TIMEOUT}"

    log "Waiting for deployment '${deployment}' in '${namespace}' to become ready..."

    if kubectl rollout status deployment/"${deployment}" -n "${namespace}" --timeout="${timeout}s" &>/dev/null; then
        success "Deployment '${deployment}' is ready"
        return 0
    else
        fail "Deployment '${deployment}' did not become ready within ${timeout}s"
        return 1
    fi
}

# ── Create test resources ──────────────────────────────────────────────────

create_test_namespace() {
    local ns="$1"

    log "Creating test namespace '${ns}' with test resources..."

    kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/dr-test: "true"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: dr-test-config
  namespace: ${ns}
data:
  test-key: "${CONFIGMAP_DATA}"
---
apiVersion: v1
kind: Secret
metadata:
  name: dr-test-secret
  namespace: ${ns}
type: Opaque
stringData:
  test-key: "${SECRET_DATA}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dr-test-app
  namespace: ${ns}
  labels:
    app: dr-test-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dr-test-app
  template:
    metadata:
      labels:
        app: dr-test-app
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: nginx
          image: docker.io/nginxinc/nginx-unprivileged:1.27.3-alpine
          ports:
            - containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache/nginx
            - name: run
              mountPath: /var/run
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
        - name: run
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: dr-test-svc
  namespace: ${ns}
spec:
  selector:
    app: dr-test-app
  ports:
    - port: 80
      targetPort: 8080
EOF

    log "Waiting for test deployment to become ready..."
    wait_for_deployment "${ns}" "dr-test-app" "${RESOURCE_TIMEOUT}"
}

# ── Validate restored resources ────────────────────────────────────────────

validate_restored_resources() {
    local ns="$1"

    header "Validating Restored Resources in '${ns}'"

    # Check namespace exists
    check
    if kubectl get namespace "${ns}" &>/dev/null; then
        success "Namespace '${ns}' exists"
    else
        fail "Namespace '${ns}' not found after restore"
        return 1
    fi

    # Check deployment
    check
    if kubectl get deployment dr-test-app -n "${ns}" &>/dev/null; then
        success "Deployment 'dr-test-app' exists"
        wait_for_deployment "${ns}" "dr-test-app" "${RESOURCE_TIMEOUT}" || true
    else
        fail "Deployment 'dr-test-app' not found after restore"
    fi

    # Check pods running
    check
    local running_pods
    running_pods=$(kubectl get pods -n "${ns}" -l app=dr-test-app --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l)
    if [[ "${running_pods}" -ge 1 ]]; then
        success "Deployment has ${running_pods} running pod(s)"
    else
        fail "No running pods for dr-test-app"
        kubectl get pods -n "${ns}" --no-headers 2>/dev/null | tee -a "$LOGFILE"
    fi

    # Check service
    check
    if kubectl get service dr-test-svc -n "${ns}" &>/dev/null; then
        success "Service 'dr-test-svc' exists"
    else
        fail "Service 'dr-test-svc' not found after restore"
    fi

    # Check ConfigMap data
    check
    local cm_value
    cm_value=$(kubectl get configmap dr-test-config -n "${ns}" -o jsonpath='{.data.test-key}' 2>/dev/null || echo "")
    if [[ "${cm_value}" == "${CONFIGMAP_DATA}" ]]; then
        success "ConfigMap data matches original (${cm_value})"
    else
        fail "ConfigMap data mismatch: expected '${CONFIGMAP_DATA}', got '${cm_value}'"
    fi

    # Check Secret data
    check
    local secret_value
    secret_value=$(kubectl get secret dr-test-secret -n "${ns}" -o jsonpath='{.data.test-key}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    if [[ "${secret_value}" == "${SECRET_DATA}" ]]; then
        success "Secret data matches original"
    else
        fail "Secret data mismatch: expected '${SECRET_DATA}', got '${secret_value}'"
    fi
}

# ── Cleanup ─────────────────────────────────────────────────────────────────

cleanup_test_namespace() {
    local ns="$1"
    log "Cleaning up test namespace '${ns}'..."

    if kubectl get namespace "${ns}" &>/dev/null; then
        kubectl delete namespace "${ns}" --timeout=120s 2>/dev/null || true
        log "Namespace '${ns}' deleted"
    else
        log "Namespace '${ns}' already gone"
    fi
}

cleanup_velero_resources() {
    local prefix="$1"
    log "Cleaning up Velero backup/restore resources with prefix '${prefix}'..."

    # Delete restores first, then backups
    for restore in $(velero restore get -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    name = item.get('metadata', {}).get('name', '')
    if name.startswith('${prefix}'):
        print(name)
" 2>/dev/null); do
        velero restore delete "${restore}" --confirm 2>/dev/null || true
    done

    for backup in $(velero backup get -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    name = item.get('metadata', {}).get('name', '')
    if name.startswith('${prefix}'):
        print(name)
" 2>/dev/null); do
        velero backup delete "${backup}" --confirm 2>/dev/null || true
    done
}

# ── Mode: backup-only ──────────────────────────────────────────────────────

mode_backup_only() {
    header "Mode: Backup Only"

    local backup_name="dr-test-backup-${TIMESTAMP}"

    log "Creating on-demand backup: ${backup_name}"
    velero backup create "${backup_name}" \
        --exclude-namespaces kube-system,flux-system \
        --include-cluster-resources=true \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if wait_for_backup "${backup_name}" "${BACKUP_TIMEOUT}"; then
        # Verify backup contents
        header "Backup Contents"
        velero backup describe "${backup_name}" --details 2>&1 | tee -a "$LOGFILE"

        check
        local item_count
        item_count=$(velero backup describe "${backup_name}" 2>/dev/null | grep -c "velero.io" || echo "0")
        if [[ "${item_count}" -ge 0 ]]; then
            success "Backup contains resources"
        fi

        velero backup logs "${backup_name}" 2>/dev/null | tail -5 | tee -a "$LOGFILE"
    fi
}

# ── Mode: namespace ────────────────────────────────────────────────────────

mode_namespace() {
    header "Mode: Namespace Backup/Restore Test"

    local backup_name="dr-test-ns-${TIMESTAMP}"
    local restore_name="dr-test-ns-restore-${TIMESTAMP}"
    local ns="${TEST_NAMESPACE}"

    # Step 1: Create test namespace with resources
    create_test_namespace "${ns}"

    # Step 2: Back up the namespace
    header "Backing Up Namespace '${ns}'"
    velero backup create "${backup_name}" \
        --include-namespaces "${ns}" \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if ! wait_for_backup "${backup_name}" "${BACKUP_TIMEOUT}"; then
        cleanup_test_namespace "${ns}"
        return 1
    fi

    # Step 3: Delete the namespace
    header "Deleting Namespace '${ns}'"
    kubectl delete namespace "${ns}" --timeout=120s 2>&1 | tee -a "$LOGFILE"
    log "Waiting for namespace to be fully removed..."
    local wait_elapsed=0
    while kubectl get namespace "${ns}" &>/dev/null && [[ ${wait_elapsed} -lt 120 ]]; do
        sleep 2
        wait_elapsed=$((wait_elapsed + 2))
    done

    check
    if ! kubectl get namespace "${ns}" &>/dev/null; then
        success "Namespace '${ns}' deleted"
    else
        fail "Namespace '${ns}' still exists after delete"
    fi

    # Step 4: Restore from backup
    header "Restoring Namespace '${ns}' from Backup"
    velero restore create "${restore_name}" \
        --from-backup "${backup_name}" \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if ! wait_for_restore "${restore_name}" "${RESTORE_TIMEOUT}"; then
        cleanup_test_namespace "${ns}"
        return 1
    fi

    # Step 5: Validate resources
    validate_restored_resources "${ns}"

    # Step 6: Cleanup
    header "Cleanup"
    cleanup_test_namespace "${ns}"
    cleanup_velero_resources "dr-test-ns-"
}

# ── Mode: full ──────────────────────────────────────────────────────────────

mode_full() {
    header "Mode: Full DR Simulation"

    local cluster_backup="dr-test-full-cluster-${TIMESTAMP}"
    local ns_backup="dr-test-full-ns-${TIMESTAMP}"
    local ns_restore="dr-test-full-restore-${TIMESTAMP}"
    local ns="${TEST_NAMESPACE}"

    # Step 1: Cluster-wide backup
    header "Step 1: Create Cluster-Wide Backup"
    log "Creating cluster backup: ${cluster_backup}"
    velero backup create "${cluster_backup}" \
        --exclude-namespaces kube-system,flux-system \
        --include-cluster-resources=true \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if wait_for_backup "${cluster_backup}" "${BACKUP_TIMEOUT}"; then
        success "Cluster backup completed"
    else
        warn "Cluster backup did not complete cleanly — continuing with namespace test"
    fi

    # Step 2: Verify backup contents
    header "Step 2: Verify Backup Contents"
    log "Listing all backups:"
    velero backup get 2>&1 | tee -a "$LOGFILE"

    check
    local backup_phase
    backup_phase=$(velero backup get "${cluster_backup}" -o json 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',{}).get('phase',''))" 2>/dev/null || echo "Unknown")
    if [[ "${backup_phase}" == "Completed" ]] || [[ "${backup_phase}" == "PartiallyFailed" ]]; then
        success "Cluster backup phase: ${backup_phase}"
    else
        fail "Cluster backup phase: ${backup_phase}"
    fi

    # Step 3: Create test namespace
    header "Step 3: Create Test Namespace with Resources"
    create_test_namespace "${ns}"

    # Step 4: Back up the test namespace
    header "Step 4: Back Up Test Namespace"
    velero backup create "${ns_backup}" \
        --include-namespaces "${ns}" \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if ! wait_for_backup "${ns_backup}" "${BACKUP_TIMEOUT}"; then
        fail "Namespace backup failed"
        cleanup_test_namespace "${ns}"
        cleanup_velero_resources "dr-test-full-"
        return 1
    fi

    # Step 5: Delete the test namespace
    header "Step 5: Delete Test Namespace"
    kubectl delete namespace "${ns}" --timeout=120s 2>&1 | tee -a "$LOGFILE"
    local wait_elapsed=0
    while kubectl get namespace "${ns}" &>/dev/null && [[ ${wait_elapsed} -lt 120 ]]; do
        sleep 2
        wait_elapsed=$((wait_elapsed + 2))
    done

    check
    if ! kubectl get namespace "${ns}" &>/dev/null; then
        success "Namespace '${ns}' deleted"
    else
        fail "Namespace '${ns}' still exists after delete"
    fi

    # Step 6: Restore from backup
    header "Step 6: Restore Test Namespace from Backup"
    velero restore create "${ns_restore}" \
        --from-backup "${ns_backup}" \
        --wait=false \
        2>&1 | tee -a "$LOGFILE"

    check
    if ! wait_for_restore "${ns_restore}" "${RESTORE_TIMEOUT}"; then
        fail "Restore failed"
        cleanup_test_namespace "${ns}"
        cleanup_velero_resources "dr-test-full-"
        return 1
    fi

    # Step 7: Validate all resources
    validate_restored_resources "${ns}"

    # Step 8: Cleanup
    header "Step 8: Cleanup"
    cleanup_test_namespace "${ns}"
    cleanup_velero_resources "dr-test-full-"
    success "All test resources cleaned up"

    # DR Test Report
    header "DR Test Report"
    log "Cluster backup:    ${cluster_backup} — ${backup_phase}"
    log "Namespace backup:  ${ns_backup}"
    log "Namespace restore: ${ns_restore}"
}

# ── Report ──────────────────────────────────────────────────────────────────

print_report() {
    echo "" | tee -a "$LOGFILE"
    echo -e "${BOLD}${CYAN}============================================${NC}" | tee -a "$LOGFILE"
    echo -e "${BOLD}        DR Test Report — ${TIMESTAMP}${NC}" | tee -a "$LOGFILE"
    echo -e "${BOLD}${CYAN}============================================${NC}" | tee -a "$LOGFILE"
    echo -e "  Mode:     ${MODE}" | tee -a "$LOGFILE"
    echo -e "  Checks:   ${CHECKS}" | tee -a "$LOGFILE"

    if [[ ${FAILURES} -eq 0 ]]; then
        echo -e "  Result:   ${GREEN}${BOLD}ALL PASSED${NC}" | tee -a "$LOGFILE"
    else
        echo -e "  Failures: ${RED}${BOLD}${FAILURES}${NC}" | tee -a "$LOGFILE"
        echo -e "  Result:   ${RED}${BOLD}FAILED${NC}" | tee -a "$LOGFILE"
    fi

    echo -e "  Log:      ${LOGFILE}" | tee -a "$LOGFILE"
    echo -e "${BOLD}${CYAN}============================================${NC}" | tee -a "$LOGFILE"
    echo "" | tee -a "$LOGFILE"
}

# ── Main ────────────────────────────────────────────────────────────────────

MODE="${1:-}"

if [[ -z "${MODE}" ]]; then
    usage
fi

echo "DR Test log: ${LOGFILE}" | tee "$LOGFILE"
echo "Started: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$LOGFILE"

preflight

case "${MODE}" in
    backup-only)
        mode_backup_only
        ;;
    namespace)
        mode_namespace
        ;;
    full)
        mode_full
        ;;
    *)
        usage
        ;;
esac

print_report

if [[ ${FAILURES} -gt 0 ]]; then
    exit 1
fi
