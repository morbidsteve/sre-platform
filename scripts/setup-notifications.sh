#!/usr/bin/env bash
# setup-notifications.sh — Configure all notification channels from a single Slack webhook URL
# Usage: ./scripts/setup-notifications.sh <slack-webhook-url>
#
# This script configures:
#   1. AlertManager receiver (Prometheus alerts to Slack)
#   2. Flux notification provider (GitOps events to Slack)
#   3. Dashboard ISSM notifications (pipeline review alerts)
#   4. Stores webhook in OpenBao for secure retrieval
#
# Idempotent — safe to run multiple times.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/colors.sh"
RESET="$NC"

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[SKIP]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------
if [[ $# -ne 1 ]]; then
  error "Usage: $0 <slack-webhook-url>"
  error "Example: $0 https://hooks.slack.com/services/T00000/B00000/XXXX"
  exit 1
fi

WEBHOOK_URL="$1"

if ! [[ "${WEBHOOK_URL}" =~ ^https://hooks\.slack\.com/ ]]; then
  error "Invalid Slack webhook URL. Must start with https://hooks.slack.com/"
  exit 1
fi

SRE_DOMAIN="${SRE_DOMAIN:-$(kubectl get cm sre-domain-config -n flux-system -o jsonpath='{.data.SRE_DOMAIN}' 2>/dev/null || echo 'apps.sre.example.com')}"
OPENBAO_NAMESPACE="${OPENBAO_NAMESPACE:-openbao}"
OPENBAO_POD="${OPENBAO_POD:-openbao-0}"

declare -a ACTIONS=()

# ###########################################################################
# STEP 1 — Store webhook in OpenBao
# ###########################################################################
info "Step 1: Storing webhook URL in OpenBao..."

VAULT_TOKEN=$(kubectl get secret openbao-init-keys -n "${OPENBAO_NAMESPACE}" -o jsonpath='{.data.root_token}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

if [[ -n "${VAULT_TOKEN}" ]]; then
  kubectl exec -n "${OPENBAO_NAMESPACE}" "${OPENBAO_POD}" -- \
    sh -c "VAULT_TOKEN='${VAULT_TOKEN}' bao kv put sre/platform/notifications slack_webhook='${WEBHOOK_URL}'" \
    2>/dev/null && {
    success "Webhook stored in OpenBao at sre/platform/notifications"
    ACTIONS+=("Stored webhook in OpenBao")
  } || {
    warn "OpenBao write failed (may not be initialized). Continuing with env var approach."
  }
else
  warn "OpenBao root token not found. Skipping vault storage."
fi

# ###########################################################################
# STEP 2 — Configure AlertManager receiver
# ###########################################################################
info "Step 2: Configuring AlertManager Slack receiver..."

# Check if alertmanager secret exists
if kubectl get secret alertmanager-kube-prometheus-stack-alertmanager -n monitoring &>/dev/null; then
  # Create alertmanager config with slack receiver
  ALERTMANAGER_CONFIG=$(cat <<AMEOF
global:
  resolve_timeout: 5m
  slack_api_url: '${WEBHOOK_URL}'
route:
  group_by: ['alertname', 'namespace']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'slack-notifications'
  routes:
    - receiver: 'slack-critical'
      match:
        severity: critical
      continue: true
    - receiver: 'slack-notifications'
receivers:
  - name: 'slack-notifications'
    slack_configs:
      - channel: '#sre-alerts'
        send_resolved: true
        title: '{{ template "slack.default.title" . }}'
        text: '{{ template "slack.default.text" . }}'
  - name: 'slack-critical'
    slack_configs:
      - channel: '#sre-critical'
        send_resolved: true
        title: '[CRITICAL] {{ template "slack.default.title" . }}'
        text: '{{ template "slack.default.text" . }}'
AMEOF
)

  kubectl create secret generic alertmanager-kube-prometheus-stack-alertmanager \
    --from-literal=alertmanager.yaml="${ALERTMANAGER_CONFIG}" \
    -n monitoring --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null && {
    success "AlertManager configured with Slack receiver"
    ACTIONS+=("Configured AlertManager Slack receiver")
  } || {
    warn "AlertManager configuration skipped"
  }
else
  warn "AlertManager secret not found in monitoring namespace. Is kube-prometheus-stack installed?"
fi

# ###########################################################################
# STEP 3 — Configure Flux notification provider
# ###########################################################################
info "Step 3: Configuring Flux notification provider..."

# Create Flux notification secret
kubectl create secret generic flux-slack-webhook \
  --from-literal=address="${WEBHOOK_URL}" \
  -n flux-system --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null

# Create Flux Provider
cat <<EOF | kubectl apply -f - 2>/dev/null
apiVersion: notification.toolkit.fluxcd.io/v1beta3
kind: Provider
metadata:
  name: slack
  namespace: flux-system
spec:
  type: slack
  channel: "#sre-gitops"
  secretRef:
    name: flux-slack-webhook
EOF

# Create Flux Alert for all sources
cat <<EOF | kubectl apply -f - 2>/dev/null
apiVersion: notification.toolkit.fluxcd.io/v1beta3
kind: Alert
metadata:
  name: slack-alert
  namespace: flux-system
spec:
  providerRef:
    name: slack
  eventSeverity: info
  eventSources:
    - kind: HelmRelease
      name: '*'
    - kind: Kustomization
      name: '*'
    - kind: GitRepository
      name: '*'
  suspend: false
EOF

success "Flux notification provider configured"
ACTIONS+=("Configured Flux Slack notification provider and alert")

# ###########################################################################
# STEP 4 — Configure Dashboard ISSM notifications
# ###########################################################################
info "Step 4: Configuring Dashboard ISSM notifications..."

# Patch the dashboard deployment with the webhook env var
if kubectl get deployment sre-dashboard -n sre-dashboard &>/dev/null; then
  kubectl set env deployment/sre-dashboard \
    ISSM_SLACK_WEBHOOK="${WEBHOOK_URL}" \
    -n sre-dashboard 2>/dev/null && {
    success "Dashboard ISSM_SLACK_WEBHOOK env var set"
    ACTIONS+=("Set ISSM_SLACK_WEBHOOK on dashboard deployment")
  } || {
    warn "Failed to set dashboard env var"
  }
else
  warn "sre-dashboard deployment not found. Set ISSM_SLACK_WEBHOOK manually."
fi

# ###########################################################################
# Summary
# ###########################################################################
echo ""
echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  Notification Setup Complete${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""
for action in "${ACTIONS[@]}"; do
  echo -e "  ${GREEN}+${RESET} ${action}"
done
echo ""
echo -e "${CYAN}Slack webhook configured for:${RESET}"
echo "  - AlertManager (Prometheus alerts)"
echo "  - Flux CD (GitOps reconciliation events)"
echo "  - Dashboard (ISSM pipeline review notifications)"
if [[ -n "${VAULT_TOKEN}" ]]; then
  echo "  - OpenBao (stored at sre/platform/notifications)"
fi
echo ""
