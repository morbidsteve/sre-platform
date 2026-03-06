#!/usr/bin/env bash
# Configure Keycloak OIDC clients for all SRE platform services.
# Creates clients in the SRE realm for Grafana, Harbor, NeuVector, and OpenBao.
#
# Usage: ./scripts/configure-keycloak-sso.sh
#
# Prerequisites:
#   - Keycloak must be running with the SRE realm already created
#   - kubectl access to the cluster

set -euo pipefail

KC_URL="https://keycloak.apps.sre.example.com"
KC_REALM="sre"
KC_ADMIN_USER="admin"

# Get admin password from secret
KC_ADMIN_PASS=$(kubectl get secret keycloak -n keycloak -o jsonpath='{.data.admin-password}' | base64 -d)

echo "==> Authenticating with Keycloak..."
TOKEN=$(curl -sk -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "username=${KC_ADMIN_USER}" \
    -d "password=${KC_ADMIN_PASS}" \
    -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
    echo "ERROR: Failed to authenticate with Keycloak"
    echo "Trying internal service URL..."
    KC_INTERNAL="http://keycloak-http.keycloak.svc.cluster.local:80"
    TOKEN=$(kubectl exec -n keycloak deploy/keycloak -- \
        curl -s -X POST "${KC_INTERNAL}/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "username=${KC_ADMIN_USER}" \
        -d "password=${KC_ADMIN_PASS}" \
        -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
    KC_URL="$KC_INTERNAL"
fi

if [ -z "$TOKEN" ]; then
    echo "ERROR: Could not authenticate with Keycloak"
    exit 1
fi
echo "    Authenticated."

create_client() {
    local client_id="$1"
    local redirect_uris="$2"
    local web_origins="$3"

    echo ""
    echo "==> Creating OIDC client: ${client_id}..."

    local payload=$(cat <<CLIENTJSON
{
    "clientId": "${client_id}",
    "name": "${client_id}",
    "enabled": true,
    "protocol": "openid-connect",
    "publicClient": false,
    "directAccessGrantsEnabled": true,
    "standardFlowEnabled": true,
    "serviceAccountsEnabled": false,
    "redirectUris": ${redirect_uris},
    "webOrigins": ${web_origins},
    "attributes": {
        "post.logout.redirect.uris": "+"
    }
}
CLIENTJSON
)

    RESP=$(curl -sk -o /dev/null -w "%{http_code}" -X POST \
        "${KC_URL}/admin/realms/${KC_REALM}/clients" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$payload")

    if [ "$RESP" = "201" ]; then
        echo "    Created ${client_id}"
    elif [ "$RESP" = "409" ]; then
        echo "    Client ${client_id} already exists"
    else
        echo "    WARNING: HTTP ${RESP} creating ${client_id}"
    fi

    # Get client UUID and secret
    CLIENT_UUID=$(curl -sk "${KC_URL}/admin/realms/${KC_REALM}/clients?clientId=${client_id}" \
        -H "Authorization: Bearer ${TOKEN}" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || true)

    if [ -n "$CLIENT_UUID" ]; then
        CLIENT_SECRET=$(curl -sk "${KC_URL}/admin/realms/${KC_REALM}/clients/${CLIENT_UUID}/client-secret" \
            -H "Authorization: Bearer ${TOKEN}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('value',''))" 2>/dev/null || true)
        echo "    Client ID: ${client_id}"
        echo "    Client Secret: ${CLIENT_SECRET}"
    fi
}

# Create OIDC clients for each service
create_client "grafana" \
    '["https://grafana.apps.sre.example.com/*", "https://grafana.apps.sre.example.com/login/generic_oauth"]' \
    '["https://grafana.apps.sre.example.com"]'

create_client "harbor" \
    '["https://harbor.apps.sre.example.com/*", "https://harbor.apps.sre.example.com/c/oidc/callback"]' \
    '["https://harbor.apps.sre.example.com"]'

create_client "neuvector" \
    '["https://neuvector.apps.sre.example.com/*"]' \
    '["https://neuvector.apps.sre.example.com"]'

create_client "openbao" \
    '["https://openbao.apps.sre.example.com/*", "https://openbao.apps.sre.example.com/ui/vault/auth/oidc/oidc/callback"]' \
    '["https://openbao.apps.sre.example.com"]'

create_client "backstage" \
    '["https://backstage.apps.sre.example.com/*"]' \
    '["https://backstage.apps.sre.example.com"]'

echo ""
echo "=========================================="
echo "SSO Configuration Complete"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Copy each client secret above into the corresponding service config"
echo "  2. For Grafana: update grafana.ini auth.generic_oauth.client_secret"
echo "  3. For Harbor: configure OIDC in Harbor admin > Configuration > Authentication"
echo "  4. For NeuVector: configure OIDC in NeuVector admin > Settings > OpenID Connect"
echo ""
