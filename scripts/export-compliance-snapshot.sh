#!/usr/bin/env bash
# ── export-compliance-snapshot.sh ────────────────────────────────────────────
# Generates a single JSON snapshot with all compliance data for offline/air-gap
# use by the RPOC ATO Portal. Collects data from cluster and dashboard API.
# NIST Controls: CA-7, CM-2, AU-6
# Usage: ./scripts/export-compliance-snapshot.sh [--dashboard URL] [--output FILE]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DASHBOARD_URL="${DASHBOARD_URL:-http://sre-dashboard.sre-dashboard.svc.cluster.local:3001}"
OUTPUT_FILE=""
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_SLUG=$(date -u +%Y%m%d-%H%M)

while [[ $# -gt 0 ]]; do
  case $1 in
    --dashboard) DASHBOARD_URL="$2"; shift 2 ;;
    --output)    OUTPUT_FILE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--dashboard URL] [--output FILE]"
      echo "  Exports all compliance data to a single JSON file for offline use."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "${OUTPUT_FILE}" ]]; then
  OUTPUT_FILE="sre-compliance-snapshot-${DATE_SLUG}.json"
fi

echo "=========================================="
echo "SRE Compliance Snapshot Export"
echo "Dashboard:  ${DASHBOARD_URL}"
echo "Output:     ${OUTPUT_FILE}"
echo "Timestamp:  ${TIMESTAMP}"
echo "=========================================="

# Helper: fetch from dashboard API with error handling
fetch_api() {
  local endpoint="$1"
  local default="${2:-null}"
  local result
  result=$(curl -sf --connect-timeout 5 --max-time 15 "${DASHBOARD_URL}${endpoint}" 2>/dev/null) || {
    echo "[WARN] Failed to fetch ${endpoint}" >&2
    echo "${default}"
    return
  }
  echo "${result}"
}

# Helper: fetch from cluster directly
fetch_cluster() {
  local cmd="$1"
  local default="${2:-[]}"
  local result
  result=$(eval "${cmd}" 2>/dev/null) || {
    echo "[WARN] Cluster query failed: ${cmd}" >&2
    echo "${default}"
    return
  }
  echo "${result}"
}

echo ""
echo "[1/8] Collecting compliance controls..."
CONTROLS=$(fetch_api "/api/compliance/controls" '{"controls":[],"summary":{}}')

echo "[2/8] Collecting compliance score..."
SCORE=$(fetch_api "/api/compliance/score" '{"overallScore":0}')

echo "[3/8] Collecting POA&M findings..."
POAM=$(fetch_api "/api/compliance/poam" '{"findings":[],"summary":{}}')

echo "[4/8] Collecting finding lifecycle data..."
FINDINGS=$(fetch_api "/api/compliance/findings/lifecycle" '{"findings":[],"total":0}')
FINDINGS_METRICS=$(fetch_api "/api/compliance/findings/metrics" '{}')

echo "[5/8] Collecting waivers and exceptions..."
WAIVERS=$(fetch_api "/api/compliance/waivers" '{"waivers":[],"summary":{}}')

echo "[6/8] Collecting RAISE status..."
RAISE=$(fetch_api "/api/compliance/raise/status" '{}')

echo "[7/8] Collecting pipeline certification..."
CERTIFICATION=$(fetch_api "/api/compliance/pipeline/certification" '{}')

echo "[8/8] Collecting platform health..."
HEALTH=$(fetch_api "/api/health" '{"summary":{}}')

# Collect cluster-level data
echo ""
echo "[CLUSTER] Gathering cluster state..."

HELM_RELEASES=$(kubectl get helmrelease -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = []
for hr in data.get('items', []):
    items.append({
        'name': hr['metadata']['name'],
        'namespace': hr['metadata']['namespace'],
        'ready': any(c.get('status') == 'True' for c in hr.get('status', {}).get('conditions', []) if c.get('type') == 'Ready'),
        'version': hr.get('status', {}).get('lastAppliedRevision', 'unknown'),
    })
print(json.dumps(items))
" 2>/dev/null || echo '[]')

KYVERNO_VIOLATIONS=$(kubectl get policyreport -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
total_fail = 0
total_pass = 0
total_warn = 0
by_namespace = {}
for report in data.get('items', []):
    ns = report['metadata'].get('namespace', 'cluster')
    summary = report.get('summary', {})
    fail = summary.get('fail', 0)
    passed = summary.get('pass', 0)
    warn = summary.get('warn', 0)
    total_fail += fail
    total_pass += passed
    total_warn += warn
    if fail > 0:
        by_namespace[ns] = fail
print(json.dumps({'totalFail': total_fail, 'totalPass': total_pass, 'totalWarn': total_warn, 'failByNamespace': by_namespace}))
" 2>/dev/null || echo '{"totalFail":0,"totalPass":0,"totalWarn":0,"failByNamespace":{}}')

CERT_STATUS=$(kubectl get certificates -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
certs = []
for cert in data.get('items', []):
    certs.append({
        'name': cert['metadata']['name'],
        'namespace': cert['metadata']['namespace'],
        'ready': any(c.get('status') == 'True' for c in cert.get('status', {}).get('conditions', []) if c.get('type') == 'Ready'),
        'notAfter': cert.get('status', {}).get('notAfter', None),
    })
print(json.dumps(certs))
" 2>/dev/null || echo '[]')

NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l || echo "0")
READY_NODES=$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready" || echo "0")

# Assemble final snapshot
echo ""
echo "[ASSEMBLE] Building snapshot..."

python3 -c "
import json, sys

snapshot = {
    'snapshotVersion': '1.0',
    'generatedAt': '${TIMESTAMP}',
    'platform': 'sre-platform',
    'status': 'complete',
    'compliance': {
        'controls': json.loads('''${CONTROLS}'''),
        'score': json.loads('''${SCORE}'''),
        'poam': json.loads('''${POAM}'''),
        'findings': json.loads('''${FINDINGS}'''),
        'findingMetrics': json.loads('''${FINDINGS_METRICS}'''),
        'waivers': json.loads('''${WAIVERS}'''),
        'raiseStatus': json.loads('''${RAISE}'''),
        'pipelineCertification': json.loads('''${CERTIFICATION}'''),
    },
    'cluster': {
        'health': json.loads('''${HEALTH}'''),
        'helmReleases': json.loads('''${HELM_RELEASES}'''),
        'policyViolations': json.loads('''${KYVERNO_VIOLATIONS}'''),
        'certificates': json.loads('''${CERT_STATUS}'''),
        'nodes': {
            'total': int('${NODE_COUNT}'.strip()),
            'ready': int('${READY_NODES}'.strip()),
        },
    },
    'oscalMetadata': {
        'controlIds': ['CA-7', 'CM-2', 'AU-6', 'RA-5', 'SI-4'],
        'evidenceType': 'compliance-snapshot',
        'collectionMethod': 'automated-cluster-query',
    },
}
print(json.dumps(snapshot, indent=2))
" > "${OUTPUT_FILE}"

FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)

echo ""
echo "=========================================="
echo "COMPLIANCE SNAPSHOT EXPORTED"
echo "  File:   ${OUTPUT_FILE}"
echo "  Size:   ${FILE_SIZE}"
echo "  Date:   ${TIMESTAMP}"
echo "=========================================="
