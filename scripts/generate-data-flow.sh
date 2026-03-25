#!/usr/bin/env bash
# ── generate-data-flow.sh ───────────────────────────────────────────────────
# Queries Prometheus for istio_requests_total to build a service-to-service
# traffic graph. Outputs both Mermaid diagram and JSON for OSCAL integration.
# NIST Controls: CA-7, SC-7, AC-4
# Usage: ./scripts/generate-data-flow.sh [--json] [--mermaid] [--prometheus URL]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROMETHEUS_URL="${PROMETHEUS_URL:-http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090}"
OUTPUT_FORMAT="both"
OUTPUT_DIR="${OUTPUT_DIR:-.}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --json)      OUTPUT_FORMAT="json"; shift ;;
    --mermaid)   OUTPUT_FORMAT="mermaid"; shift ;;
    --prometheus) PROMETHEUS_URL="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--json] [--mermaid] [--prometheus URL] [--output-dir DIR]"
      echo "  Queries Prometheus for istio_requests_total to build data flow diagrams."
      echo "  Defaults to both JSON and Mermaid output."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_SLUG=$(date -u +%Y%m%d)

echo "=========================================="
echo "SRE Data Flow Generator"
echo "Prometheus: ${PROMETHEUS_URL}"
echo "Timestamp:  ${TIMESTAMP}"
echo "=========================================="

# ── Query Prometheus ────────────────────────────────────────────────────────

QUERY='sort_desc(sum by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace, connection_security_policy, request_protocol)(rate(istio_requests_total[24h]))) > 0'
ENCODED_QUERY=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''${QUERY}'''))" 2>/dev/null || echo "${QUERY}")

echo ""
echo "[INFO] Querying Prometheus for istio_requests_total (24h rate)..."

PROM_RESPONSE=$(curl -sf --connect-timeout 10 --max-time 30 \
  "${PROMETHEUS_URL}/api/v1/query" \
  --data-urlencode "query=${QUERY}" 2>/dev/null) || {
  echo "[ERROR] Failed to reach Prometheus at ${PROMETHEUS_URL}"
  echo "[ERROR] Ensure Prometheus is running and accessible."
  echo ""
  echo "Generating empty data flow with error status..."

  # Output empty result for offline/error case
  if [[ "$OUTPUT_FORMAT" == "json" || "$OUTPUT_FORMAT" == "both" ]]; then
    cat > "${OUTPUT_DIR}/data-flow-${DATE_SLUG}.json" <<ERRJSON
{
  "generatedAt": "${TIMESTAMP}",
  "status": "error",
  "error": "Prometheus unreachable at ${PROMETHEUS_URL}",
  "flows": [],
  "services": [],
  "summary": {
    "totalFlows": 0,
    "totalServices": 0,
    "mtlsFlows": 0,
    "plaintextFlows": 0
  }
}
ERRJSON
    echo "[OUTPUT] ${OUTPUT_DIR}/data-flow-${DATE_SLUG}.json (error state)"
  fi

  if [[ "$OUTPUT_FORMAT" == "mermaid" || "$OUTPUT_FORMAT" == "both" ]]; then
    cat > "${OUTPUT_DIR}/data-flow-${DATE_SLUG}.mmd" <<ERRMMD
graph LR
    classDef error fill:#ff4444,stroke:#cc0000,color:white
    ERR[Prometheus Unreachable]:::error
ERRMMD
    echo "[OUTPUT] ${OUTPUT_DIR}/data-flow-${DATE_SLUG}.mmd (error state)"
  fi
  exit 1
}

# ── Parse Response ──────────────────────────────────────────────────────────

STATUS=$(echo "${PROM_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null || echo "error")
if [[ "${STATUS}" != "success" ]]; then
  echo "[ERROR] Prometheus query returned status: ${STATUS}"
  exit 1
fi

# Extract flows into a structured format using Python
FLOWS_JSON=$(echo "${PROM_RESPONSE}" | python3 -c "
import sys, json

data = json.load(sys.stdin)
results = data.get('data', {}).get('result', [])

flows = []
services = set()

for r in results:
    metric = r.get('metric', {})
    value = float(r.get('value', [0, 0])[1])

    src = metric.get('source_workload', 'unknown')
    src_ns = metric.get('source_workload_namespace', 'unknown')
    dst = metric.get('destination_workload', 'unknown')
    dst_ns = metric.get('destination_workload_namespace', 'unknown')
    security = metric.get('connection_security_policy', 'unknown')
    protocol = metric.get('request_protocol', 'http')

    if src == 'unknown' or dst == 'unknown':
        continue

    src_full = f'{src_ns}/{src}'
    dst_full = f'{dst_ns}/{dst}'
    services.add(src_full)
    services.add(dst_full)

    tls = 'mTLS' if security == 'mutual_tls' else 'plaintext'

    flows.append({
        'source': src,
        'sourceNamespace': src_ns,
        'sourceFull': src_full,
        'destination': dst,
        'destinationNamespace': dst_ns,
        'destinationFull': dst_full,
        'protocol': protocol.upper(),
        'security': tls,
        'requestsPerSecond': round(value, 3)
    })

output = {
    'flows': sorted(flows, key=lambda f: f['requestsPerSecond'], reverse=True),
    'services': sorted(list(services))
}
print(json.dumps(output))
" 2>/dev/null)

if [[ -z "${FLOWS_JSON}" || "${FLOWS_JSON}" == "null" ]]; then
  echo "[WARN] No traffic flows found in Prometheus data."
  FLOWS_JSON='{"flows":[],"services":[]}'
fi

TOTAL_FLOWS=$(echo "${FLOWS_JSON}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['flows']))")
TOTAL_SERVICES=$(echo "${FLOWS_JSON}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['services']))")
MTLS_FLOWS=$(echo "${FLOWS_JSON}" | python3 -c "import sys,json; print(len([f for f in json.load(sys.stdin)['flows'] if f['security']=='mTLS']))")
PLAIN_FLOWS=$(echo "${FLOWS_JSON}" | python3 -c "import sys,json; print(len([f for f in json.load(sys.stdin)['flows'] if f['security']!='mTLS']))")

echo "[INFO] Found ${TOTAL_FLOWS} traffic flows across ${TOTAL_SERVICES} services"
echo "[INFO] mTLS flows: ${MTLS_FLOWS}, Plaintext flows: ${PLAIN_FLOWS}"

# ── Generate JSON Output ────────────────────────────────────────────────────

if [[ "$OUTPUT_FORMAT" == "json" || "$OUTPUT_FORMAT" == "both" ]]; then
  echo "${FLOWS_JSON}" | python3 -c "
import sys, json

data = json.load(sys.stdin)
output = {
    'generatedAt': '${TIMESTAMP}',
    'status': 'success',
    'prometheusUrl': '${PROMETHEUS_URL}',
    'queryPeriod': '24h',
    'flows': data['flows'],
    'services': data['services'],
    'summary': {
        'totalFlows': len(data['flows']),
        'totalServices': len(data['services']),
        'mtlsFlows': len([f for f in data['flows'] if f['security'] == 'mTLS']),
        'plaintextFlows': len([f for f in data['flows'] if f['security'] != 'mTLS']),
        'mtlsPercentage': round(
            len([f for f in data['flows'] if f['security'] == 'mTLS']) / max(len(data['flows']), 1) * 100, 1
        )
    },
    'oscalMetadata': {
        'controlIds': ['AC-4', 'SC-7', 'SC-8', 'CA-7'],
        'evidenceType': 'network-traffic-analysis',
        'collectionMethod': 'automated-prometheus-query'
    }
}
print(json.dumps(output, indent=2))
" > "${OUTPUT_DIR}/data-flow-${DATE_SLUG}.json"

  echo "[OUTPUT] ${OUTPUT_DIR}/data-flow-${DATE_SLUG}.json"
fi

# ── Generate Mermaid Diagram ────────────────────────────────────────────────

if [[ "$OUTPUT_FORMAT" == "mermaid" || "$OUTPUT_FORMAT" == "both" ]]; then
  echo "${FLOWS_JSON}" | python3 -c "
import sys, json, re

data = json.load(sys.stdin)
flows = data['flows']
services = data['services']

# Sanitize names for Mermaid node IDs
def mermaid_id(name):
    return re.sub(r'[^a-zA-Z0-9]', '_', name)

print('graph LR')
print('    %% SRE Platform Data Flow Diagram')
print('    %% Generated: ${TIMESTAMP}')
print('    %% Source: Prometheus istio_requests_total (24h)')
print('')

# Style definitions
print('    classDef mtls fill:#0d9488,stroke:#0f766e,color:white')
print('    classDef plain fill:#ef4444,stroke:#dc2626,color:white')
print('    classDef service fill:#1e3a5f,stroke:#2563eb,color:white')
print('')

# Subgraph by namespace
namespaces = {}
for svc in services:
    ns, name = svc.split('/', 1) if '/' in svc else ('default', svc)
    if ns not in namespaces:
        namespaces[ns] = []
    namespaces[ns].append(name)

for ns in sorted(namespaces.keys()):
    print(f'    subgraph {mermaid_id(ns)}[\"{ns}\"]')
    for svc in sorted(namespaces[ns]):
        node_id = mermaid_id(f'{ns}_{svc}')
        print(f'        {node_id}[\"{svc}\"]:::service')
    print('    end')
    print('')

# Edges with protocol and rate labels
seen = set()
for flow in flows[:50]:  # Limit to top 50 flows for readability
    src_id = mermaid_id(flow['sourceFull'])
    dst_id = mermaid_id(flow['destinationFull'])
    key = f'{src_id}_{dst_id}'
    if key in seen:
        continue
    seen.add(key)

    rate = flow['requestsPerSecond']
    rate_label = f'{rate:.1f} rps' if rate >= 0.1 else f'{rate*1000:.0f} mrps'
    security = flow['security']
    protocol = flow['protocol']
    label = f'{protocol}/{security} {rate_label}'

    arrow = '-->' if security == 'mTLS' else '-.->'
    print(f'    {src_id} {arrow}|{label}| {dst_id}')

print('')
print('    %% Legend')
print('    subgraph legend[Legend]')
print('        L1[mTLS Encrypted] -->|mTLS| L2[Target]')
print('        L3[Plaintext] -.->|no mTLS| L4[Target]')
print('    end')
" > "${OUTPUT_DIR}/data-flow-${DATE_SLUG}.mmd"

  echo "[OUTPUT] ${OUTPUT_DIR}/data-flow-${DATE_SLUG}.mmd"
fi

echo ""
echo "=========================================="
echo "DATA FLOW GENERATION COMPLETE"
echo "  Flows:    ${TOTAL_FLOWS}"
echo "  Services: ${TOTAL_SERVICES}"
echo "  mTLS:     ${MTLS_FLOWS}/${TOTAL_FLOWS}"
echo "=========================================="
