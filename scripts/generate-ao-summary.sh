#!/usr/bin/env bash
# ── generate-ao-summary.sh ──────────────────────────────────────────────────
# Generates a monthly executive summary for the Authorizing Official (AO).
# Includes: posture score, findings, changes, upcoming events, risk status.
# NIST Controls: CA-7, PM-6, PM-10, RA-5
# Usage: ./scripts/generate-ao-summary.sh [--month YYYY-MM] [--dashboard URL] [--output FILE]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DASHBOARD_URL="${DASHBOARD_URL:-http://sre-dashboard.sre-dashboard.svc.cluster.local:3001}"
MONTH="${MONTH:-$(date -u +%Y-%m)}"
OUTPUT_FILE=""
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

while [[ $# -gt 0 ]]; do
  case $1 in
    --month)     MONTH="$2"; shift 2 ;;
    --dashboard) DASHBOARD_URL="$2"; shift 2 ;;
    --output)    OUTPUT_FILE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--month YYYY-MM] [--dashboard URL] [--output FILE]"
      echo "  Generates a monthly AO executive summary."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "${OUTPUT_FILE}" ]]; then
  OUTPUT_FILE="ao-summary-${MONTH}.json"
fi

echo "=========================================="
echo "SRE AO Monthly Summary"
echo "Month:      ${MONTH}"
echo "Dashboard:  ${DASHBOARD_URL}"
echo "Output:     ${OUTPUT_FILE}"
echo "=========================================="

# Helper: fetch from dashboard API
fetch_api() {
  local endpoint="$1"
  local default="${2:-null}"
  curl -sf --connect-timeout 5 --max-time 15 "${DASHBOARD_URL}${endpoint}" 2>/dev/null || echo "${default}"
}

echo ""
echo "[1/6] Collecting compliance score..."
SCORE_DATA=$(fetch_api "/api/compliance/score" '{"overallScore":0,"controlsImplemented":0,"controlsTotal":0}')

echo "[2/6] Collecting finding metrics..."
FINDING_METRICS=$(fetch_api "/api/compliance/findings/metrics" '{"total":0,"byStatus":{},"openBySeverity":{},"overdue":0}')

echo "[3/6] Collecting POA&M data..."
POAM_DATA=$(fetch_api "/api/compliance/poam" '{"findings":[],"summary":{"total":0,"open":0,"mitigated":0}}')

echo "[4/6] Collecting waiver/exception data..."
WAIVER_DATA=$(fetch_api "/api/compliance/waivers" '{"waivers":[],"summary":{"total":0,"active":0,"expired":0}}')

echo "[5/6] Collecting pipeline stats..."
PIPELINE_STATS=$(fetch_api "/api/pipeline/stats" '{"totalRuns":0,"byStatus":{},"approvalRate":"N/A"}')

echo "[6/6] Collecting platform health..."
HEALTH_DATA=$(fetch_api "/api/health" '{"summary":{"helmReleasesReady":0,"helmReleasesTotal":0,"nodesReady":0,"nodesTotal":0}}')

# Collect HelmRelease versions for change tracking
echo ""
echo "[CLUSTER] Gathering recent changes..."
HR_VERSIONS=$(kubectl get helmrelease -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
releases = []
for hr in data.get('items', []):
    releases.append({
        'name': hr['metadata']['name'],
        'namespace': hr['metadata']['namespace'],
        'version': hr.get('status', {}).get('lastAppliedRevision', 'unknown'),
        'lastTransition': hr.get('status', {}).get('conditions', [{}])[0].get('lastTransitionTime', None),
    })
print(json.dumps(releases))
" 2>/dev/null || echo '[]')

# Check for upcoming certificate expirations (next 30 days)
EXPIRING_CERTS=$(kubectl get certificates -A -o json 2>/dev/null | python3 -c "
import sys, json
from datetime import datetime, timedelta, timezone
data = json.load(sys.stdin)
now = datetime.now(timezone.utc)
threshold = now + timedelta(days=30)
expiring = []
for cert in data.get('items', []):
    not_after = cert.get('status', {}).get('notAfter')
    if not_after:
        try:
            exp = datetime.fromisoformat(not_after.replace('Z', '+00:00'))
            if exp < threshold:
                expiring.append({
                    'name': cert['metadata']['name'],
                    'namespace': cert['metadata']['namespace'],
                    'expiresAt': not_after,
                    'daysRemaining': (exp - now).days,
                })
        except: pass
print(json.dumps(expiring))
" 2>/dev/null || echo '[]')

# Assemble summary
echo ""
echo "[ASSEMBLE] Building AO summary..."

python3 -c "
import json

score = json.loads('''${SCORE_DATA}''')
findings = json.loads('''${FINDING_METRICS}''')
poam = json.loads('''${POAM_DATA}''')
waivers = json.loads('''${WAIVER_DATA}''')
pipeline = json.loads('''${PIPELINE_STATS}''')
health = json.loads('''${HEALTH_DATA}''')
hr_versions = json.loads('''${HR_VERSIONS}''')
expiring_certs = json.loads('''${EXPIRING_CERTS}''')

# Determine overall risk level
open_critical = findings.get('openBySeverity', {}).get('critical', 0)
open_high = findings.get('openBySeverity', {}).get('high', 0)
overdue = findings.get('overdue', 0)

if open_critical > 0 or overdue > 5:
    risk_level = 'HIGH'
    risk_color = 'red'
elif open_high > 3 or overdue > 0:
    risk_level = 'MODERATE'
    risk_color = 'yellow'
else:
    risk_level = 'LOW'
    risk_color = 'green'

summary = {
    'reportType': 'AO Monthly Summary',
    'month': '${MONTH}',
    'generatedAt': '${TIMESTAMP}',
    'classification': 'UNCLASSIFIED',

    'executiveSummary': {
        'overallRiskLevel': risk_level,
        'complianceScore': score.get('overallScore', 0),
        'openFindings': findings.get('total', 0) - findings.get('byStatus', {}).get('mitigated', 0) - findings.get('byStatus', {}).get('risk-accepted', 0),
        'overdueFindings': overdue,
        'activeWaivers': waivers.get('summary', {}).get('active', 0),
        'platformHealth': 'OPERATIONAL' if health.get('summary', {}).get('helmReleasesReady', 0) == health.get('summary', {}).get('helmReleasesTotal', 1) else 'DEGRADED',
    },

    'posture': {
        'complianceScore': score,
        'controlsStatus': {
            'implemented': score.get('controlsImplemented', 0),
            'total': score.get('controlsTotal', 0),
        },
    },

    'findings': {
        'metrics': findings,
        'openBySeverity': findings.get('openBySeverity', {}),
        'overdue': overdue,
        'mttr': findings.get('mttr', {}),
        'poamSummary': poam.get('summary', {}),
    },

    'changes': {
        'pipelineRuns': pipeline,
        'helmReleaseVersions': hr_versions,
        'totalComponentUpdates': len(hr_versions),
    },

    'upcomingEvents': {
        'expiringCertificates': expiring_certs,
        'expiringWaivers': [w for w in waivers.get('waivers', []) if w.get('status') == 'active' and w.get('expiry')],
    },

    'riskAcceptances': {
        'active': waivers.get('summary', {}).get('active', 0),
        'expired': waivers.get('summary', {}).get('expired', 0),
        'byType': waivers.get('summary', {}).get('byType', {}),
    },

    'recommendations': [],
}

# Generate recommendations
recs = summary['recommendations']
if open_critical > 0:
    recs.append({'priority': 'CRITICAL', 'action': f'Remediate {open_critical} critical finding(s) immediately'})
if overdue > 0:
    recs.append({'priority': 'HIGH', 'action': f'Address {overdue} overdue finding(s) past SLA deadline'})
if len(expiring_certs) > 0:
    recs.append({'priority': 'MEDIUM', 'action': f'Renew {len(expiring_certs)} certificate(s) expiring within 30 days'})
expired_waivers = waivers.get('summary', {}).get('expired', 0)
if expired_waivers > 0:
    recs.append({'priority': 'MEDIUM', 'action': f'Review {expired_waivers} expired waiver(s) for renewal or remediation'})
if not recs:
    recs.append({'priority': 'INFO', 'action': 'No immediate actions required. Continue monitoring.'})

print(json.dumps(summary, indent=2))
" > "${OUTPUT_FILE}"

FILE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)

echo ""
echo "=========================================="
echo "AO MONTHLY SUMMARY GENERATED"
echo "  File:   ${OUTPUT_FILE}"
echo "  Size:   ${FILE_SIZE}"
echo "  Month:  ${MONTH}"
echo "=========================================="
