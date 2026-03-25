#!/usr/bin/env bash
# morning-health-check.sh — SRE Platform daily health check
# Runs 12 operational checks and reports colored PASS/WARN/FAIL status.
# Supports --json flag for machine-readable output.
#
# Usage:
#   ./scripts/morning-health-check.sh          # colored terminal output
#   ./scripts/morning-health-check.sh --json   # JSON output for automation
#
# NIST Controls: CA-7 (Continuous Monitoring), SI-4 (System Monitoring)

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

JSON_MODE=false
if [[ "${1:-}" == "--json" ]]; then
  JSON_MODE=true
fi

# Accumulators for JSON output
declare -a JSON_RESULTS=()
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

# ── Helpers ───────────────────────────────────────────────────────────────

log_result() {
  local check_name="$1"
  local status="$2"  # PASS, WARN, FAIL
  local detail="$3"

  if $JSON_MODE; then
    JSON_RESULTS+=("{\"check\":\"${check_name}\",\"status\":\"${status}\",\"detail\":\"$(echo "$detail" | sed 's/"/\\"/g' | tr '\n' ' ')\"}")
  else
    case "$status" in
      PASS) echo -e "  ${GREEN}[PASS]${NC} ${check_name}: ${detail}" ;;
      WARN) echo -e "  ${YELLOW}[WARN]${NC} ${check_name}: ${detail}" ;;
      FAIL) echo -e "  ${RED}[FAIL]${NC} ${check_name}: ${detail}" ;;
    esac
  fi

  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
  esac
}

# ── Header ────────────────────────────────────────────────────────────────
if ! $JSON_MODE; then
  echo ""
  echo -e "${BOLD}${BLUE}========================================${NC}"
  echo -e "${BOLD}  SRE Platform Morning Health Check${NC}"
  echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
  echo -e "${BOLD}${BLUE}========================================${NC}"
  echo ""
fi

# ── Check 1: Flux HelmReleases ───────────────────────────────────────────
check_flux_helmreleases() {
  if ! command -v kubectl &>/dev/null; then
    log_result "Flux HelmReleases" "FAIL" "kubectl not found"
    return
  fi
  local output
  output=$(kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o json 2>/dev/null) || {
    log_result "Flux HelmReleases" "FAIL" "Cannot query HelmReleases (Flux CRDs not installed or kubectl not configured)"
    return
  }
  local total ready not_ready
  total=$(echo "$output" | jq '.items | length')
  ready=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status=="True"))] | length')
  not_ready=$((total - ready))
  if [[ "$not_ready" -eq 0 ]]; then
    log_result "Flux HelmReleases" "PASS" "${ready}/${total} ready"
  elif [[ "$not_ready" -le 2 ]]; then
    local names
    names=$(echo "$output" | jq -r '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status!="True")) | .metadata.name] | join(", ")')
    log_result "Flux HelmReleases" "WARN" "${ready}/${total} ready (degraded: ${names})"
  else
    log_result "Flux HelmReleases" "FAIL" "${ready}/${total} ready — ${not_ready} not ready"
  fi
}

# ── Check 2: Flux Kustomizations ─────────────────────────────────────────
check_flux_kustomizations() {
  local output
  output=$(kubectl get kustomizations.kustomize.toolkit.fluxcd.io -A -o json 2>/dev/null) || {
    log_result "Flux Kustomizations" "FAIL" "Cannot query Kustomizations"
    return
  }
  local total ready not_ready
  total=$(echo "$output" | jq '.items | length')
  ready=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status=="True"))] | length')
  not_ready=$((total - ready))
  if [[ "$not_ready" -eq 0 ]]; then
    log_result "Flux Kustomizations" "PASS" "${ready}/${total} ready"
  else
    log_result "Flux Kustomizations" "FAIL" "${ready}/${total} ready — ${not_ready} not ready"
  fi
}

# ── Check 3: Node Health ─────────────────────────────────────────────────
check_node_health() {
  local output
  output=$(kubectl get nodes -o json 2>/dev/null) || {
    log_result "Node Health" "FAIL" "Cannot query nodes"
    return
  }
  local total ready not_ready
  total=$(echo "$output" | jq '.items | length')
  ready=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status=="True"))] | length')
  not_ready=$((total - ready))
  if [[ "$not_ready" -eq 0 ]]; then
    log_result "Node Health" "PASS" "${ready}/${total} nodes ready"
  else
    local names
    names=$(echo "$output" | jq -r '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status!="True")) | .metadata.name] | join(", ")')
    log_result "Node Health" "FAIL" "${ready}/${total} nodes ready (not ready: ${names})"
  fi
}

# ── Check 4: CrashLooping Pods ───────────────────────────────────────────
check_crashlooping_pods() {
  local output
  output=$(kubectl get pods -A -o json 2>/dev/null) || {
    log_result "CrashLooping Pods" "FAIL" "Cannot query pods"
    return
  }
  local crashlooping
  crashlooping=$(echo "$output" | jq '[.items[] | select(.status.containerStatuses[]? | select(.state.waiting.reason == "CrashLoopBackOff")) | "\(.metadata.namespace)/\(.metadata.name)"] | unique')
  local count
  count=$(echo "$crashlooping" | jq 'length')
  if [[ "$count" -eq 0 ]]; then
    log_result "CrashLooping Pods" "PASS" "No CrashLoopBackOff pods"
  else
    local names
    names=$(echo "$crashlooping" | jq -r 'join(", ")')
    log_result "CrashLooping Pods" "FAIL" "${count} pod(s) in CrashLoopBackOff: ${names}"
  fi
}

# ── Check 5: Pending Pods ────────────────────────────────────────────────
check_pending_pods() {
  local output
  output=$(kubectl get pods -A --field-selector=status.phase=Pending -o json 2>/dev/null) || {
    log_result "Pending Pods" "FAIL" "Cannot query pods"
    return
  }
  local count
  count=$(echo "$output" | jq '.items | length')
  if [[ "$count" -eq 0 ]]; then
    log_result "Pending Pods" "PASS" "No pending pods"
  elif [[ "$count" -le 3 ]]; then
    log_result "Pending Pods" "WARN" "${count} pod(s) pending"
  else
    log_result "Pending Pods" "FAIL" "${count} pod(s) stuck in Pending"
  fi
}

# ── Check 6: Certificate Expiry ──────────────────────────────────────────
check_cert_expiry() {
  local output
  output=$(kubectl get certificates -A -o json 2>/dev/null) || {
    log_result "Certificate Expiry" "WARN" "Cannot query certificates (cert-manager CRDs not installed?)"
    return
  }
  local total
  total=$(echo "$output" | jq '.items | length')
  if [[ "$total" -eq 0 ]]; then
    log_result "Certificate Expiry" "PASS" "No certificates to check"
    return
  fi
  local not_ready
  not_ready=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status!="True"))] | length')
  local expiring_soon
  expiring_soon=$(echo "$output" | jq --argjson threshold "$(( $(date +%s) + 30*86400 ))" '[.items[] | select(.status.notAfter) | select((.status.notAfter | fromdateiso8601) < $threshold) | .metadata.name] | length')
  if [[ "$not_ready" -gt 0 ]]; then
    log_result "Certificate Expiry" "FAIL" "${not_ready}/${total} certificates not ready"
  elif [[ "$expiring_soon" -gt 0 ]]; then
    log_result "Certificate Expiry" "WARN" "${expiring_soon} certificate(s) expiring within 30 days"
  else
    log_result "Certificate Expiry" "PASS" "All ${total} certificates valid"
  fi
}

# ── Check 7: Velero Backup Status ────────────────────────────────────────
check_velero_backup() {
  local output
  output=$(kubectl get backups.velero.io -n velero --sort-by=.status.completionTimestamp -o json 2>/dev/null) || {
    log_result "Velero Backup" "WARN" "Cannot query Velero backups (Velero not installed?)"
    return
  }
  local count
  count=$(echo "$output" | jq '.items | length')
  if [[ "$count" -eq 0 ]]; then
    log_result "Velero Backup" "WARN" "No backups found"
    return
  fi
  local latest_phase latest_name
  latest_phase=$(echo "$output" | jq -r '.items[-1].status.phase // "Unknown"')
  latest_name=$(echo "$output" | jq -r '.items[-1].metadata.name // "unknown"')
  if [[ "$latest_phase" == "Completed" ]]; then
    log_result "Velero Backup" "PASS" "Latest backup (${latest_name}) completed successfully"
  elif [[ "$latest_phase" == "InProgress" ]]; then
    log_result "Velero Backup" "WARN" "Backup ${latest_name} in progress"
  else
    log_result "Velero Backup" "FAIL" "Latest backup (${latest_name}) status: ${latest_phase}"
  fi
}

# ── Check 8: OpenBao Seal Status ─────────────────────────────────────────
check_openbao_seal() {
  local pods
  pods=$(kubectl get pods -n openbao -l app.kubernetes.io/name=openbao -o jsonpath='{.items[*].metadata.name}' 2>/dev/null) || {
    log_result "OpenBao Seal" "WARN" "Cannot query OpenBao pods (not installed?)"
    return
  }
  if [[ -z "$pods" ]]; then
    log_result "OpenBao Seal" "WARN" "No OpenBao pods found"
    return
  fi
  local sealed_count=0
  local total_count=0
  for pod in $pods; do
    total_count=$((total_count + 1))
    local status
    status=$(kubectl exec -n openbao "$pod" -- bao status -format=json 2>/dev/null | jq -r '.sealed' 2>/dev/null) || status="true"
    if [[ "$status" == "true" ]]; then
      sealed_count=$((sealed_count + 1))
    fi
  done
  if [[ "$sealed_count" -eq 0 ]]; then
    log_result "OpenBao Seal" "PASS" "All ${total_count} instance(s) unsealed"
  else
    log_result "OpenBao Seal" "FAIL" "${sealed_count}/${total_count} instance(s) are sealed"
  fi
}

# ── Check 9: Active Prometheus Alerts ────────────────────────────────────
check_prometheus_alerts() {
  # Try to get alerts from Alertmanager
  local am_svc
  am_svc=$(kubectl get svc -n monitoring -l app.kubernetes.io/name=alertmanager -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) || {
    log_result "Prometheus Alerts" "WARN" "Cannot find Alertmanager service"
    return
  }
  local output
  output=$(kubectl exec -n monitoring deploy/kube-prometheus-stack-kube-prometheus -- wget -q -O - "http://${am_svc}:9093/api/v2/alerts?active=true" 2>/dev/null) || {
    # Fallback: check via kubectl port-forward is not practical in script, just check firing alerts via promql
    local firing
    firing=$(kubectl get prometheusrules -A -o json 2>/dev/null | jq '.items | length') || firing="?"
    log_result "Prometheus Alerts" "WARN" "Cannot reach Alertmanager directly; ${firing} PrometheusRules configured"
    return
  }
  local count
  count=$(echo "$output" | jq 'length' 2>/dev/null) || count=0
  if [[ "$count" -eq 0 ]]; then
    log_result "Prometheus Alerts" "PASS" "No active alerts"
  elif [[ "$count" -le 3 ]]; then
    log_result "Prometheus Alerts" "WARN" "${count} active alert(s)"
  else
    log_result "Prometheus Alerts" "FAIL" "${count} active alerts firing"
  fi
}

# ── Check 10: Loki Ingestion ─────────────────────────────────────────────
check_loki_ingestion() {
  local pods
  pods=$(kubectl get pods -n logging -l app.kubernetes.io/name=loki -o jsonpath='{.items[*].status.phase}' 2>/dev/null) || {
    log_result "Loki Ingestion" "WARN" "Cannot query Loki pods (not installed?)"
    return
  }
  if [[ -z "$pods" ]]; then
    log_result "Loki Ingestion" "WARN" "No Loki pods found"
    return
  fi
  local running=0
  local total=0
  for phase in $pods; do
    total=$((total + 1))
    if [[ "$phase" == "Running" ]]; then
      running=$((running + 1))
    fi
  done
  # Also check Alloy (log collector) pods
  local alloy_pods
  alloy_pods=$(kubectl get pods -n logging -l app.kubernetes.io/name=alloy -o jsonpath='{.items[*].status.phase}' 2>/dev/null) || alloy_pods=""
  local alloy_running=0
  local alloy_total=0
  for phase in $alloy_pods; do
    alloy_total=$((alloy_total + 1))
    if [[ "$phase" == "Running" ]]; then
      alloy_running=$((alloy_running + 1))
    fi
  done
  if [[ "$running" -eq "$total" ]] && [[ "$alloy_running" -eq "$alloy_total" || "$alloy_total" -eq 0 ]]; then
    log_result "Loki Ingestion" "PASS" "Loki ${running}/${total} running, Alloy ${alloy_running}/${alloy_total} running"
  else
    log_result "Loki Ingestion" "WARN" "Loki ${running}/${total} running, Alloy ${alloy_running}/${alloy_total} running"
  fi
}

# ── Check 11: ExternalSecret Sync ────────────────────────────────────────
check_externalsecret_sync() {
  local output
  output=$(kubectl get externalsecrets -A -o json 2>/dev/null) || {
    log_result "ExternalSecret Sync" "WARN" "Cannot query ExternalSecrets (ESO not installed?)"
    return
  }
  local total
  total=$(echo "$output" | jq '.items | length')
  if [[ "$total" -eq 0 ]]; then
    log_result "ExternalSecret Sync" "PASS" "No ExternalSecrets configured"
    return
  fi
  local synced
  synced=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="Ready" and .status=="True"))] | length')
  local not_synced=$((total - synced))
  if [[ "$not_synced" -eq 0 ]]; then
    log_result "ExternalSecret Sync" "PASS" "All ${total} ExternalSecrets synced"
  else
    log_result "ExternalSecret Sync" "FAIL" "${not_synced}/${total} ExternalSecrets not synced"
  fi
}

# ── Check 12: Disk Usage ─────────────────────────────────────────────────
check_disk_usage() {
  local output
  output=$(kubectl get nodes -o json 2>/dev/null) || {
    log_result "Disk Usage" "FAIL" "Cannot query nodes"
    return
  }
  local node_count
  node_count=$(echo "$output" | jq '.items | length')
  local disk_pressure_count
  disk_pressure_count=$(echo "$output" | jq '[.items[] | select(.status.conditions[]? | select(.type=="DiskPressure" and .status=="True"))] | length')
  if [[ "$disk_pressure_count" -eq 0 ]]; then
    log_result "Disk Usage" "PASS" "No disk pressure on any of ${node_count} nodes"
  else
    local names
    names=$(echo "$output" | jq -r '[.items[] | select(.status.conditions[]? | select(.type=="DiskPressure" and .status=="True")) | .metadata.name] | join(", ")')
    log_result "Disk Usage" "FAIL" "${disk_pressure_count} node(s) with disk pressure: ${names}"
  fi
}

# ── Run All Checks ───────────────────────────────────────────────────────
check_flux_helmreleases
check_flux_kustomizations
check_node_health
check_crashlooping_pods
check_pending_pods
check_cert_expiry
check_velero_backup
check_openbao_seal
check_prometheus_alerts
check_loki_ingestion
check_externalsecret_sync
check_disk_usage

# ── Summary ──────────────────────────────────────────────────────────────
TOTAL=$((PASS_COUNT + WARN_COUNT + FAIL_COUNT))

if $JSON_MODE; then
  # Output JSON
  echo "{"
  echo "  \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\","
  echo "  \"summary\": {\"total\": ${TOTAL}, \"pass\": ${PASS_COUNT}, \"warn\": ${WARN_COUNT}, \"fail\": ${FAIL_COUNT}},"
  echo "  \"checks\": ["
  local first=true
  for result in "${JSON_RESULTS[@]}"; do
    if $first; then
      first=false
    else
      echo ","
    fi
    echo -n "    ${result}"
  done
  echo ""
  echo "  ]"
  echo "}"
else
  echo ""
  echo -e "${BOLD}${BLUE}────────────────────────────────────────${NC}"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo -e "  ${RED}${BOLD}SUMMARY: ${PASS_COUNT} passed, ${WARN_COUNT} warnings, ${FAIL_COUNT} FAILED${NC}"
  elif [[ "$WARN_COUNT" -gt 0 ]]; then
    echo -e "  ${YELLOW}${BOLD}SUMMARY: ${PASS_COUNT} passed, ${WARN_COUNT} warnings${NC}"
  else
    echo -e "  ${GREEN}${BOLD}SUMMARY: All ${TOTAL} checks passed${NC}"
  fi
  echo -e "${BOLD}${BLUE}────────────────────────────────────────${NC}"
  echo ""
fi

# Exit code: 2 = failures, 1 = warnings only, 0 = all pass
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 2
elif [[ "$WARN_COUNT" -gt 0 ]]; then
  exit 1
else
  exit 0
fi
