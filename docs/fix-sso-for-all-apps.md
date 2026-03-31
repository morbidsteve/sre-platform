# Fix: Enforce Keycloak SSO for ALL Apps (Revert Fix 2)

## Context

Round 4 hardening (PR #43) "fixed" the ext-authz 403 problem on tenant apps by
REMOVING SSO from tenant apps entirely — scoping ext-authz to platform UIs only.

THIS IS WRONG. This is a government-compliant platform targeting ATO/CMMC/FedRAMP.
Every app deployed to this platform MUST go through Keycloak SSO. We cannot let
tenant teams handle their own auth — it's unauditable and breaks compliance.

The actual root cause of the 403 was NOT that tenant apps shouldn't have SSO.
It's that the OAuth2 proxy redirect was hardcoded to the dashboard callback URL,
so tenant apps couldn't complete the OIDC flow.

## The Prompt

```
You are fixing a critical security regression in the SRE platform. PR #43's Fix 2
REMOVED Keycloak SSO enforcement from tenant apps. This breaks ATO compliance.
Every app on this platform MUST authenticate through Keycloak — no exceptions.

BRANCH: fix/enforce-sso-all-apps

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. After EACH change, validate against the REAL CLUSTER.
3. Do NOT break existing platform UI SSO (dashboard, grafana, etc).
4. Test with a REAL tenant app deployment after the fix.

## ROOT CAUSE

The OAuth2 proxy has:
  --redirect-url=https://dashboard.${SRE_DOMAIN}/oauth2/callback

This is a SINGLE hardcoded redirect URL. When a tenant app (e.g., gitea.apps.sre.example.com)
triggers the OIDC flow, OAuth2 proxy tries to redirect back to the dashboard callback,
not the tenant app. The browser ends up at the wrong place → 403.

## WHAT TO FIX

### Step 1: Revert ext-authz to enforce on ALL hosts

Read platform/core/istio-config/ext-authz/authorization-policy.yaml

If PR #43 changed this to only apply to specific platform UI hosts (positive list),
REVERT it back to applying to ALL hosts with only these exemptions in notHosts:
- keycloak.${SRE_DOMAIN} (identity provider itself — can't auth-gate the auth provider)
- harbor.${SRE_DOMAIN} (uses Bearer tokens for Docker/OCI protocol, not browser cookies)

That's it. Everything else goes through ext-authz, including ALL tenant apps.

Commit: git commit -m "fix(istio): revert ext-authz to enforce SSO on all hosts — ATO compliance requires it"

### Step 2: Fix OAuth2 proxy dynamic redirect

The OAuth2 proxy redirect-url must NOT be hardcoded to a single host. Fix this:

Read platform/core/oauth2-proxy/deployment.yaml

Change the args to support dynamic redirects:

1. REMOVE: --redirect-url=https://dashboard.${SRE_DOMAIN}/oauth2/callback
   (This hardcoded redirect is the root cause of tenant app 403s)

2. Instead, let OAuth2 proxy determine the redirect dynamically. OAuth2 proxy v7.7+
   supports this. The X-Auth-Request-Redirect header is ALREADY configured in the
   Istio meshConfig extensionProviders — it captures the original URL. But the
   hardcoded --redirect-url overrides it.

   There are two approaches:

   APPROACH A (Preferred): Use per-host callback routing
   - Set --redirect-url to use a wildcard or omit it entirely
   - OAuth2 proxy will use the X-Auth-Request-Redirect header that Istio already sends
   - The /oauth2/callback path needs to be routable on EVERY host, not just dashboard

   APPROACH B (Simpler): Use a dedicated auth host
   - Keep --redirect-url=https://oauth2.${SRE_DOMAIN}/oauth2/callback
   - The oauth2.${SRE_DOMAIN} VirtualService already exists
   - OAuth2 proxy captures the original URL via rd= parameter and redirects back after auth

   Choose the approach that works best. The key test: after Keycloak login, the user
   must end up back at the ORIGINAL app URL they requested, not at the dashboard.

3. Ensure cookie-domain is set to .${SRE_DOMAIN} (it already is: --cookie-domain=.${SRE_DOMAIN})
   This means the auth cookie works across ALL subdomains — once logged in via any app,
   you're logged in everywhere. This is correct behavior for SSO.

Commit: git commit -m "fix(oauth2-proxy): enable dynamic redirect so tenant apps complete OIDC flow"

### Step 3: Update Keycloak client redirect URIs

The Keycloak OIDC client (oauth2-proxy) must allow redirects to ANY *.${SRE_DOMAIN} host.

Check the Keycloak realm configuration. The client's Valid Redirect URIs should be:
  https://*.apps.sre.example.com/oauth2/callback
  https://*.apps.sre.example.com/*

If Keycloak is configured via the HelmRelease or a realm import JSON, update it there.
If it was configured manually through the Keycloak admin UI, use the Keycloak API:

```bash
# Get admin token
KEYCLOAK_URL="https://keycloak.apps.sre.example.com"
ADMIN_TOKEN=$(curl -sk "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=REPLACE_WITH_ADMIN_PASSWORD" \
  -d "grant_type=password" | jq -r '.access_token')

# Get current client config
CLIENT_ID_UUID=$(curl -sk "${KEYCLOAK_URL}/admin/realms/sre/clients?clientId=oauth2-proxy" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq -r '.[0].id')

# Update redirect URIs to include wildcard
curl -sk -X PUT "${KEYCLOAK_URL}/admin/realms/sre/clients/${CLIENT_ID_UUID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"redirectUris\": [
      \"https://*.apps.sre.example.com/oauth2/callback\",
      \"https://*.apps.sre.example.com/*\"
    ],
    \"webOrigins\": [
      \"https://*.apps.sre.example.com\"
    ]
  }"
```

Commit: git commit -m "fix(keycloak): allow wildcard redirect URIs for all tenant app domains"

### Step 4: Route /oauth2/* paths for ALL VirtualServices

Currently, the /oauth2/callback and /oauth2/auth paths are only routed for
specific platform UI hosts in the oauth2-proxy VirtualService. For dynamic
redirects to work, EVERY host that goes through ext-authz needs the /oauth2/*
paths routed to the oauth2-proxy service.

Read platform/core/oauth2-proxy/virtualservice.yaml

The VirtualService should match ALL hosts in the mesh (or use a wildcard) for
the /oauth2/* prefix and route those to oauth2-proxy. One way:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: oauth2-proxy-callback
  namespace: oauth2-proxy
spec:
  hosts:
    - "*.apps.sre.example.com"
  gateways:
    - istio-system/main
  http:
    - match:
        - uri:
            prefix: /oauth2/
      route:
        - destination:
            host: oauth2-proxy.oauth2-proxy.svc.cluster.local
            port:
              number: 4180
```

This ensures that when Keycloak redirects back to gitea.apps.sre.example.com/oauth2/callback,
Istio routes it to the OAuth2 proxy, which completes the auth flow and redirects the user
to the original app URL.

IMPORTANT: This wildcard VirtualService must have a higher priority (or more specific
match) than tenant app VirtualServices for the /oauth2/ prefix. Istio evaluates matches
in order — prefix /oauth2/ is more specific than prefix / so it should win.

Commit: git commit -m "fix(oauth2-proxy): route /oauth2/* for all hosts so tenant apps can complete OIDC flow"

### Step 5: Test everything

```bash
# Test A: Tenant app gets redirected to Keycloak (not 403)
curl -sk -o /dev/null -w '%{http_code} %{redirect_url}' \
  https://gitea.apps.sre.example.com/
# MUST be 302 redirecting to keycloak.apps.sre.example.com/realms/sre/...
# NOT 403, NOT 200 (unauthenticated)

# Test B: Platform UI still redirects to Keycloak
curl -sk -o /dev/null -w '%{http_code} %{redirect_url}' \
  https://dashboard.apps.sre.example.com/
# MUST be 302 to Keycloak

# Test C: After login, cookie works across all subdomains
# Use Playwright or manual browser test:
# 1. Go to dashboard.apps.sre.example.com → redirected to Keycloak → login
# 2. After login, go to gitea.apps.sre.example.com → should be authenticated (no second login)
# 3. This works because cookie-domain=.apps.sre.example.com

# Test D: go-httpbin works after SSO
curl -sk -o /dev/null -w '%{http_code}' \
  --cookie "_sre_oauth2=<grab cookie from browser after login>" \
  https://go-httpbin.apps.sre.example.com/get
# MUST be 200

# Test E: Health endpoints still bypass SSO
curl -sk -o /dev/null -w '%{http_code}' \
  https://go-httpbin.apps.sre.example.com/healthz
# Can be 200 or 404 depending on app — but NOT 302 to Keycloak

# Test F: Keycloak itself is NOT behind SSO (would create infinite loop)
curl -sk -o /dev/null -w '%{http_code}' \
  https://keycloak.apps.sre.example.com/
# MUST be 200 (not 302)
```

### Step 6: Update the deploy script and docs

1. Update scripts/sre-deploy-app.sh:
   - The generated VirtualService for tenant apps does NOT need any SSO-specific config
   - SSO is enforced at the mesh level by ext-authz — it's automatic for all ingress
   - Remove any comments or logic that suggests apps handle their own auth

2. Update docs/developer-guide.md (if it exists):
   - Add a section: "Authentication — All apps deployed to SRE are automatically protected
     by Keycloak SSO. You do not need to configure authentication. After deployment, users
     accessing your app will be redirected to Keycloak to sign in. The authenticated user's
     identity is available in these headers: x-auth-request-user, x-auth-request-email,
     x-auth-request-groups."

3. Update the DSOP wizard:
   - The wizard should NOT have an "enable SSO" toggle — SSO is always on
   - The wizard SHOULD show: "Your app will be protected by Keycloak SSO automatically.
     Users will sign in via the platform SSO before accessing your app."

Commit: git commit -m "docs: SSO is enforced for all apps — update deploy script and guides"

## FINAL: Push and create PR

```bash
git push -u origin fix/enforce-sso-all-apps
gh pr create --title "fix: enforce Keycloak SSO for ALL apps — revert platform-only scoping" \
  --body "$(cat <<'EOF'
## Summary
Reverts the ext-authz scoping from PR #43 that removed SSO from tenant apps.
ALL apps on this platform MUST go through Keycloak SSO for ATO compliance.

The root cause of the original 403 was a hardcoded OAuth2 proxy redirect URL,
not that tenant apps shouldn't have SSO. This PR fixes the actual root cause:

1. **ext-authz enforced on all hosts** (reverts platform-only scoping)
2. **OAuth2 proxy dynamic redirect** (fixes the hardcoded dashboard callback)
3. **Keycloak wildcard redirect URIs** (allows callbacks from any tenant app domain)
4. **Wildcard /oauth2/* VirtualService** (routes auth callbacks for all hosts)

## Security Impact
- **Before**: Tenant apps were publicly accessible without authentication
- **After**: All apps require Keycloak SSO. Auth cookie shared across *.apps.sre.example.com

## Test Plan
- [ ] Tenant app returns 302 to Keycloak (not 403 or 200)
- [ ] Platform UI still returns 302 to Keycloak
- [ ] After login on one app, other apps are also authenticated (SSO cookie)
- [ ] Keycloak itself is NOT behind ext-authz (no infinite redirect)
- [ ] Health endpoints bypass SSO
- [ ] go-httpbin accessible after SSO login
- [ ] Gitea accessible after SSO login

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
```

---

## Kick-Off Prompt

```
Read docs/fix-sso-for-all-apps.md and execute the prompt in "The Prompt" section.
This REVERTS the ext-authz change from PR #43 that removed SSO from tenant apps.
ALL apps MUST go through Keycloak SSO for ATO compliance. The real fix is making
the OAuth2 proxy redirect work dynamically, not removing SSO. Do not stop or ask
questions. Start with Step 1.
```
