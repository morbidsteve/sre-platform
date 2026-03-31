#!/usr/bin/env bash
# Configure Keycloak oauth2-proxy client redirect URIs
# Run this after Keycloak is deployed to ensure SSO works for all apps
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/colors.sh"

SRE_DOMAIN="${SRE_DOMAIN:-apps.sre.example.com}"
KC_URL="https://keycloak.${SRE_DOMAIN}"
KC_PASS="${KC_ADMIN_PASSWORD:-$(kubectl get secret keycloak -n keycloak -o jsonpath='{.data.admin-password}' | base64 -d 2>/dev/null)}"

RESOLVE="--resolve keycloak.${SRE_DOMAIN}:443:$(kubectl get svc -n istio-system istio-gateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo 192.168.2.200)"

info "Getting Keycloak admin token..."
TOKEN=$(curl -sk $RESOLVE "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&username=admin&password=${KC_PASS}&grant_type=password" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) || {
  error "Failed to get admin token"; exit 1
}

info "Finding oauth2-proxy client..."
UUID=$(curl -sk $RESOLVE "${KC_URL}/admin/realms/sre/clients?clientId=oauth2-proxy" \
  -H "Authorization: Bearer ${TOKEN}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null) || {
  error "Failed to find oauth2-proxy client"; exit 1
}

info "Updating redirect URIs for *.${SRE_DOMAIN}..."
curl -sk $RESOLVE "${KC_URL}/admin/realms/sre/clients/${UUID}" \
  -H "Authorization: Bearer ${TOKEN}" | \
python3 -c "
import sys, json
data = json.load(sys.stdin)
data['redirectUris'] = [
    'https://oauth2.${SRE_DOMAIN}/oauth2/callback',
    'https://oauth2.${SRE_DOMAIN}/*',
    'https://dashboard.${SRE_DOMAIN}/oauth2/callback',
    'https://*.${SRE_DOMAIN}/oauth2/callback',
    'https://*.${SRE_DOMAIN}/*',
]
data['webOrigins'] = ['https://*.${SRE_DOMAIN}', '+']
json.dump(data, sys.stdout)
" | curl -sk $RESOLVE -X PUT "${KC_URL}/admin/realms/sre/clients/${UUID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- -w '%{http_code}' -o /dev/null

log "Keycloak oauth2-proxy redirect URIs updated for *.${SRE_DOMAIN}"
