# Phase 2: SSO Verification

| Test | Status | Detail |
|------|--------|--------|
| Dashboard requires SSO (unauthenticated) | PASS | Returns 403 |
| SSO login via Keycloak | PASS | /oauth2/start → 302 to Keycloak → login → cookie |
| Cross-app: dashboard | PASS | 200 with SSO cookie |
| Cross-app: grafana | PASS | 200 with SSO cookie |
| Cross-app: portal | PASS | 200 with SSO cookie |
| Cross-app: dsop wizard | PASS | 200 with SSO cookie |
| Cross-app: go-httpbin (tenant) | PASS | 200 with SSO cookie |
| Cross-app: gitea (tenant) | PASS | 200 with SSO cookie |
| Cross-app: uptime-kuma (tenant) | PASS | 302 (app redirect, cookie valid) |
| Tenant go-httpbin requires SSO | PASS | 403 without auth |
| Tenant gitea requires SSO | PASS | 403 without auth |
| Keycloak NOT behind SSO | PASS | 302 (own redirect) |

**Total: 12 PASS, 0 FAIL, 0 SKIP**

## Platform Fix Applied During Testing

Dashboard, Portal, and DSOP VirtualServices needed `/oauth2/` prefix route added
to forward SSO callback traffic to oauth2-proxy. Without this, the SPA catch-all
route consumed `/oauth2/start` and returned the app's index.html instead of
initiating the OIDC flow.
