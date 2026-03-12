#!/usr/bin/env bash
# configure-neuvector-sso.sh — Configure NeuVector OIDC SSO via Keycloak
#
# Prerequisites:
#   - NeuVector deployed and controller healthy
#   - Keycloak deployed with 'sre' realm and 'neuvector' OIDC client
#   - CoreDNS configured to resolve keycloak.apps.sre.example.com
#     (see platform/core/coredns-hosts/ for the configmap)
#   - Groups mapper configured on the neuvector client in Keycloak
#
# Usage:
#   ./scripts/configure-neuvector-sso.sh
#
# Environment variables (optional overrides):
#   NV_USERNAME       NeuVector admin username (default: admin)
#   NV_PASSWORD       NeuVector admin password (default: admin)
#   NV_CONTROLLER_SVC NeuVector controller service (default: neuvector-svc-controller.neuvector.svc.cluster.local)
#   NV_CONTROLLER_PORT NeuVector controller API port (default: 10443)
#   KC_INTERNAL_URL   Keycloak internal service URL (default: http://keycloak.keycloak.svc.cluster.local)
#   KC_EXTERNAL_URL   Keycloak external URL (default: https://keycloak.apps.sre.example.com)
#   KC_REALM          Keycloak realm (default: sre)
#   OIDC_CLIENT_ID    OIDC client ID (default: neuvector)

set -euo pipefail

# --- Configuration ---
NV_USERNAME="${NV_USERNAME:-admin}"
NV_PASSWORD="${NV_PASSWORD:-admin}"
NV_CONTROLLER_SVC="${NV_CONTROLLER_SVC:-neuvector-svc-controller.neuvector.svc.cluster.local}"
NV_CONTROLLER_PORT="${NV_CONTROLLER_PORT:-10443}"
NV_API="https://${NV_CONTROLLER_SVC}:${NV_CONTROLLER_PORT}"

KC_INTERNAL_URL="${KC_INTERNAL_URL:-http://keycloak.keycloak.svc.cluster.local}"
KC_EXTERNAL_URL="${KC_EXTERNAL_URL:-https://keycloak.apps.sre.example.com}"
KC_REALM="${KC_REALM:-sre}"
OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-neuvector}"

echo "=== NeuVector OIDC SSO Configuration ==="
echo ""

# --- Step 1: Get Keycloak admin credentials ---
echo "[1/5] Retrieving Keycloak admin credentials..."
KC_ADMIN_PASS=$(kubectl get secret keycloak -n keycloak -o jsonpath='{.data.admin-password}' | base64 -d)

# --- Step 2: Get Keycloak admin token and client secret ---
echo "[2/5] Getting Keycloak admin token and neuvector client secret..."

# Create a temporary pod to interact with Keycloak internal API
SCRIPT_CM="nv-sso-setup-$(date +%s)"
cat <<'INNERSCRIPT' > /tmp/nv-sso-setup.sh
#!/bin/sh
KC_PASS="$1"
KC_URL="$2"
KC_REALM="$3"
CLIENT_ID="$4"

# Get admin token
TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_PASS}" -d "grant_type=password" | \
  sed 's/.*"access_token":"\([^"]*\)".*/\1/')

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get Keycloak admin token"
  exit 1
fi

# Find the client UUID
CLIENT_UUID=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients?clientId=${CLIENT_ID}" | \
  sed 's/.*"id":"\([^"]*\)".*/\1/')

# Get client secret
CLIENT_SECRET=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients/${CLIENT_UUID}/client-secret" | \
  sed 's/.*"value":"\([^"]*\)".*/\1/')

echo "CLIENT_SECRET=${CLIENT_SECRET}"

# Ensure groups mapper exists
MAPPER_RESULT=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients/${CLIENT_UUID}/protocol-mappers/models" \
  -d '{
    "name": "groups",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-group-membership-mapper",
    "config": {
      "full.path": "false",
      "introspection.token.claim": "true",
      "userinfo.token.claim": "true",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "claim.name": "groups",
      "jsonType.label": "String"
    }
  }')

HTTP_CODE=$(echo "$MAPPER_RESULT" | tail -1)
if [ "$HTTP_CODE" = "201" ]; then
  echo "MAPPER=created"
elif [ "$HTTP_CODE" = "409" ]; then
  echo "MAPPER=exists"
else
  echo "MAPPER=error_${HTTP_CODE}"
fi
INNERSCRIPT

kubectl create configmap "$SCRIPT_CM" --from-file=/tmp/nv-sso-setup.sh -n neuvector --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

KC_RESULT=$(kubectl run "nv-sso-kc-$(date +%s)" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -n neuvector \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"setup\",\"image\":\"curlimages/curl:8.5.0\",\"command\":[\"sh\",\"/scripts/nv-sso-setup.sh\",\"${KC_ADMIN_PASS}\",\"${KC_INTERNAL_URL}\",\"${KC_REALM}\",\"${OIDC_CLIENT_ID}\"],\"volumeMounts\":[{\"name\":\"script\",\"mountPath\":\"/scripts\"}]}],\"volumes\":[{\"name\":\"script\",\"configMap\":{\"name\":\"${SCRIPT_CM}\"}}]}}" 2>/dev/null)

kubectl delete configmap "$SCRIPT_CM" -n neuvector > /dev/null 2>&1

CLIENT_SECRET=$(echo "$KC_RESULT" | grep "CLIENT_SECRET=" | cut -d= -f2)
MAPPER_STATUS=$(echo "$KC_RESULT" | grep "MAPPER=" | cut -d= -f2)

if [ -z "$CLIENT_SECRET" ]; then
  echo "ERROR: Failed to retrieve client secret from Keycloak"
  exit 1
fi

echo "  Client secret: retrieved"
echo "  Groups mapper: ${MAPPER_STATUS}"

# --- Step 3: Login to NeuVector API ---
echo "[3/5] Logging in to NeuVector controller API..."

NV_LOGIN_CM="nv-sso-login-$(date +%s)"
cat <<LOGINSCRIPT > /tmp/nv-sso-login.sh
#!/bin/sh
NV_RESPONSE=\$(curl -sk -X POST "${NV_API}/v1/auth" \
  -H "Content-Type: application/json" \
  -d '{"password":{"username":"${NV_USERNAME}","password":"${NV_PASSWORD}"}}')
NV_TOKEN=\$(echo "\$NV_RESPONSE" | tr ',' '\n' | grep '"token":' | tail -1 | cut -d'"' -f4)
printf '%s' "\$NV_TOKEN"
LOGINSCRIPT

kubectl create configmap "$NV_LOGIN_CM" --from-file=/tmp/nv-sso-login.sh -n neuvector --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

NV_TOKEN=$(kubectl run "nv-sso-login-$(date +%s)" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -n neuvector \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"login\",\"image\":\"curlimages/curl:8.5.0\",\"command\":[\"sh\",\"/scripts/nv-sso-login.sh\"],\"volumeMounts\":[{\"name\":\"script\",\"mountPath\":\"/scripts\"}]}],\"volumes\":[{\"name\":\"script\",\"configMap\":{\"name\":\"${NV_LOGIN_CM}\"}}]}}" 2>/dev/null)

kubectl delete configmap "$NV_LOGIN_CM" -n neuvector > /dev/null 2>&1

if [ -z "$NV_TOKEN" ] || [ "$(echo -n "$NV_TOKEN" | wc -c)" -lt 100 ]; then
  echo "ERROR: Failed to login to NeuVector API"
  exit 1
fi
echo "  NeuVector token: obtained ($(echo -n "$NV_TOKEN" | wc -c) chars)"

# --- Step 4: Configure OIDC ---
echo "[4/5] Configuring NeuVector OIDC..."

ISSUER_URL="${KC_EXTERNAL_URL}/realms/${KC_REALM}"

NV_OIDC_CM="nv-sso-oidc-$(date +%s)"
cat <<OIDCSCRIPT > /tmp/nv-sso-oidc.sh
#!/bin/sh
NV_TOKEN="\$1"
RESULT=\$(curl -sk -w "\nHTTP_CODE: %{http_code}" -X POST \
  "${NV_API}/v1/server" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: \$NV_TOKEN" \
  -d '{
    "config": {
      "name": "openid1",
      "oidc": {
        "issuer": "${ISSUER_URL}",
        "client_id": "${OIDC_CLIENT_ID}",
        "client_secret": "${CLIENT_SECRET}",
        "group_claim": "groups",
        "scopes": ["openid", "profile", "email"],
        "enable": true,
        "default_role": "reader",
        "group_mapped_roles": [
          {"group": "sre-admins", "global_role": "admin"},
          {"group": "platform-admins", "global_role": "admin"},
          {"group": "sre-viewers", "global_role": "reader"},
          {"group": "developers", "global_role": "reader"}
        ]
      }
    }
  }')
echo "\$RESULT"
OIDCSCRIPT

kubectl create configmap "$NV_OIDC_CM" --from-file=/tmp/nv-sso-oidc.sh -n neuvector --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

# Write token to a file inside the pod to avoid shell escaping issues
OIDC_RESULT=$(kubectl run "nv-sso-oidc-$(date +%s)" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -n neuvector \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"oidc\",\"image\":\"curlimages/curl:8.5.0\",\"command\":[\"sh\",\"/scripts/nv-sso-oidc.sh\",\"${NV_TOKEN}\"],\"volumeMounts\":[{\"name\":\"script\",\"mountPath\":\"/scripts\"}]}],\"volumes\":[{\"name\":\"script\",\"configMap\":{\"name\":\"${NV_OIDC_CM}\"}}]}}" 2>/dev/null)

kubectl delete configmap "$NV_OIDC_CM" -n neuvector > /dev/null 2>&1

HTTP_CODE=$(echo "$OIDC_RESULT" | grep "HTTP_CODE:" | awk '{print $2}')

if [ "$HTTP_CODE" = "200" ]; then
  echo "  OIDC configuration: success"
else
  echo "  OIDC configuration: failed (HTTP $HTTP_CODE)"
  echo "  Response: $OIDC_RESULT"
  exit 1
fi

# --- Step 5: Verify ---
echo "[5/5] Verifying OIDC configuration..."

NV_VERIFY_CM="nv-sso-verify-$(date +%s)"
cat <<VERIFYSCRIPT > /tmp/nv-sso-verify.sh
#!/bin/sh
curl -sk "${NV_API}/v1/server" -H "X-Auth-Token: \$1"
VERIFYSCRIPT

kubectl create configmap "$NV_VERIFY_CM" --from-file=/tmp/nv-sso-verify.sh -n neuvector --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1

VERIFY_RESULT=$(kubectl run "nv-sso-verify-$(date +%s)" --rm -i --restart=Never --image=curlimages/curl:8.5.0 -n neuvector \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"verify\",\"image\":\"curlimages/curl:8.5.0\",\"command\":[\"sh\",\"/scripts/nv-sso-verify.sh\",\"${NV_TOKEN}\"],\"volumeMounts\":[{\"name\":\"script\",\"mountPath\":\"/scripts\"}]}],\"volumes\":[{\"name\":\"script\",\"configMap\":{\"name\":\"${NV_VERIFY_CM}\"}}]}}" 2>/dev/null)

kubectl delete configmap "$NV_VERIFY_CM" -n neuvector > /dev/null 2>&1

if echo "$VERIFY_RESULT" | grep -q '"server_name":"openid1"'; then
  echo "  Verification: PASSED"
  echo ""
  echo "=== NeuVector OIDC SSO Configuration Complete ==="
  echo ""
  echo "OIDC Provider:    Keycloak (${KC_EXTERNAL_URL}/realms/${KC_REALM})"
  echo "Client ID:        ${OIDC_CLIENT_ID}"
  echo "Group Claim:      groups"
  echo "Role Mappings:"
  echo "  sre-admins       -> admin"
  echo "  platform-admins  -> admin"
  echo "  sre-viewers      -> reader"
  echo "  developers       -> reader"
  echo "  (default)        -> reader"
  echo ""
  echo "Users can now login to NeuVector at https://neuvector.apps.sre.example.com"
  echo "using the 'Login with OpenID' button."
else
  echo "  Verification: FAILED"
  echo "  Response: $VERIFY_RESULT"
  exit 1
fi
