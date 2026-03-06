#!/usr/bin/env bash
# RBAC Audit Script — review all cluster RBAC for least-privilege compliance
# NIST Controls: AC-2, AC-3, AC-6
#
# Usage: ./scripts/rbac-audit.sh [--json]

set -euo pipefail

JSON_OUTPUT=false
[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=true

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "============================================"
echo "  SRE Platform RBAC Audit Report"
echo "  Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# 1. Check for cluster-admin bindings (should be minimal)
echo "==> Cluster-Admin Bindings"
CLUSTER_ADMIN_BINDINGS=$(kubectl get clusterrolebindings -o json | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
results = []
for item in data['items']:
  if item.get('roleRef', {}).get('name') == 'cluster-admin':
    subjects = item.get('subjects', [])
    for s in subjects:
      results.append({
        'binding': item['metadata']['name'],
        'subject_kind': s.get('kind', ''),
        'subject_name': s.get('name', ''),
        'subject_namespace': s.get('namespace', '')
      })
for r in results:
  print(f\"  {r['binding']}: {r['subject_kind']}/{r['subject_name']} (ns: {r['subject_namespace'] or 'cluster-wide'})\")
print(f'Total cluster-admin bindings: {len(results)}')
" 2>/dev/null || echo "  (unable to parse)")
echo "$CLUSTER_ADMIN_BINDINGS"
echo ""

# 2. Check for overly broad permissions (wildcard resources or verbs)
echo "==> Roles with Wildcard Permissions"
kubectl get clusterroles -o json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data['items']:
  name = item['metadata']['name']
  # Skip system roles
  if name.startswith('system:') or name.startswith('kubeadm:'):
    continue
  rules = item.get('rules', [])
  for rule in rules:
    resources = rule.get('resources', [])
    verbs = rule.get('verbs', [])
    if '*' in resources or '*' in verbs:
      print(f'  WARNING: {name} has wildcard: resources={resources} verbs={verbs}')
" 2>/dev/null || echo "  (unable to parse)"
echo ""

# 3. Check for ServiceAccounts with elevated permissions
echo "==> ServiceAccounts with ClusterRoleBindings"
kubectl get clusterrolebindings -o json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data['items']:
  subjects = item.get('subjects', [])
  for s in subjects:
    if s.get('kind') == 'ServiceAccount':
      ns = s.get('namespace', 'unknown')
      name = s.get('name', 'unknown')
      role = item['roleRef']['name']
      # Skip system service accounts
      if ns in ['kube-system', 'flux-system'] and name.startswith('system:'):
        continue
      print(f'  {ns}/{name} -> ClusterRole/{role}')
" 2>/dev/null || echo "  (unable to parse)"
echo ""

# 4. Check namespace-scoped roles for least privilege
echo "==> Tenant Namespace RBAC Summary"
for ns in $(kubectl get namespaces -l sre.io/team -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  echo "  Namespace: $ns"
  ROLES=$(kubectl get roles -n "$ns" --no-headers 2>/dev/null | wc -l)
  BINDINGS=$(kubectl get rolebindings -n "$ns" --no-headers 2>/dev/null | wc -l)
  echo "    Roles: $ROLES, RoleBindings: $BINDINGS"
  kubectl get rolebindings -n "$ns" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data['items']:
  role = item['roleRef']['name']
  kind = item['roleRef']['kind']
  subjects = [f\"{s.get('kind','')}/{s.get('name','')}\" for s in item.get('subjects', [])]
  print(f\"    {item['metadata']['name']}: {kind}/{role} -> {', '.join(subjects)}\")
" 2>/dev/null || true
done
echo ""

# 5. Check for default service account usage
echo "==> Pods Using Default ServiceAccount (should be avoided)"
DEFAULT_SA_PODS=$(kubectl get pods -A -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
count = 0
for pod in data['items']:
  ns = pod['metadata']['namespace']
  name = pod['metadata']['name']
  sa = pod['spec'].get('serviceAccountName', 'default')
  if sa == 'default' and ns not in ['kube-system']:
    print(f'  {ns}/{name}')
    count += 1
print(f'Total pods using default SA: {count}')
" 2>/dev/null || echo "  (unable to parse)")
echo "$DEFAULT_SA_PODS"
echo ""

# 6. Summary
echo "============================================"
echo "  Audit Complete"
echo "============================================"
echo ""
echo "Recommendations:"
echo "  1. Minimize cluster-admin bindings to essential service accounts only"
echo "  2. Replace wildcard permissions with explicit resource lists"
echo "  3. Use dedicated ServiceAccounts for each workload"
echo "  4. Review tenant RBAC monthly for stale bindings"
echo "  5. Enable Kubernetes audit logging for RBAC change tracking"
