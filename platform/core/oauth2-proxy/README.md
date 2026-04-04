# OAuth2 Proxy

SSO authentication gateway for all platform web UIs. Integrates with Keycloak as the OIDC provider and Istio's ext-authz mechanism to enforce login before any request reaches a backend service.

## Components

| Resource | Purpose |
|----------|---------|
| `deployment.yaml` | OAuth2 Proxy v7.7.1 Deployment + credentials Secret |
| `service.yaml` | ClusterIP service on port 4180 |
| `virtualservice.yaml` | Istio routing for `oauth2.apps.sre.example.com` |
| `custom-templates.yaml` | Custom HTML sign-in page template |
| `namespace.yaml` | `oauth2-proxy` namespace |

## How It Works

1. User requests a protected service (e.g., `dashboard.apps.sre.example.com`).
2. Istio's ext-authz filter forwards the request to OAuth2 Proxy for validation.
3. If no valid session cookie exists, OAuth2 Proxy redirects the user to Keycloak login.
4. After successful login, Keycloak issues an OIDC token and redirects back.
5. OAuth2 Proxy sets a `_sre_oauth2` session cookie on the `.apps.sre.example.com` domain.
6. Subsequent requests pass through with the cookie; OAuth2 Proxy sets `X-Auth-Request-User`, `X-Auth-Request-Email`, and `X-Auth-Request-Groups` headers for the backend.

### Excluded Services

These services have their own authentication and are not behind ext-authz:

- **Keycloak** -- is the identity provider itself
- **Harbor** -- has built-in OIDC login
- **NeuVector** -- has its own admin login (OIDC configurable separately)

## Deployment

Deployed as a raw Kubernetes Deployment (not a HelmRelease). Flux manages it via the Kustomization that includes `platform/core/oauth2-proxy/`.

Key deployment details:
- Image: `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1`
- Replicas: 1
- OIDC discovery is skipped; login/token/JWKS URLs are set explicitly to use in-cluster Keycloak service (`keycloak.keycloak.svc.cluster.local`) for backend calls while browser-facing URLs use the external hostname.
- PKCE (S256 code challenge) is enabled for security.

## Configuration

| Setting | Value |
|---------|-------|
| Provider | `keycloak-oidc` |
| Cookie name | `_sre_oauth2` |
| Cookie domain | `.apps.sre.example.com` (via `SRE_DOMAIN` variable) |
| OIDC scopes | `openid profile email groups` |
| Groups claim | `groups` (from Keycloak token) |
| Callback URL | `https://oauth2.apps.sre.example.com/oauth2/callback` |
| Upstream | `static://200` (ext-authz mode -- returns 200/401, no proxying) |

### Credentials

The `oauth2-proxy-credentials` Secret in the deployment contains:
- `client-id` -- Keycloak OIDC client ID
- `client-secret` -- Keycloak OIDC client secret
- `cookie-secret` -- random key for encrypting session cookies

## Dependencies

| Dependency | Reason |
|------------|--------|
| Keycloak | OIDC identity provider (must have `sre` realm + `oauth2-proxy` client) |
| Istio | ext-authz integration routes auth checks to OAuth2 Proxy |
| cert-manager | TLS certificate for `oauth2.apps.sre.example.com` |

## NIST Controls

| Control | Implementation |
|---------|---------------|
| AC-2 | Centralized account management via Keycloak SSO |
| AC-3 | Access enforcement -- unauthenticated requests are blocked |
| AC-14 | No permitted actions without identification on gated services |
| IA-2 | OIDC-based identification and authentication with MFA (Keycloak) |
| IA-8 | Non-organizational users blocked by Keycloak realm policy |

## Troubleshooting

```bash
# Check OAuth2 Proxy pod status
kubectl get pods -n oauth2-proxy

# View logs (auth failures, OIDC errors)
kubectl logs -n oauth2-proxy -l app.kubernetes.io/name=oauth2-proxy --tail=100

# Test OIDC discovery endpoint (from outside cluster)
curl -sk https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration

# Test internal Keycloak connectivity (from inside cluster)
kubectl exec -n oauth2-proxy deploy/oauth2-proxy -- \
  wget -qO- http://keycloak.keycloak.svc.cluster.local/realms/sre/.well-known/openid-configuration

# Check Istio ext-authz configuration
kubectl get envoyfilter -A | grep ext-authz

# Force Flux reconciliation
flux reconcile kustomization sre-oauth2-proxy -n flux-system
```

### Common Issues

| Issue | Resolution |
|-------|-----------|
| Redirect loop after login | Check cookie domain matches the service domain; verify `SRE_DOMAIN` variable |
| 401 on all requests | Verify Keycloak `sre` realm has the `oauth2-proxy` client with correct secret |
| "invalid_grant" in logs | Cookie secret may have changed; clear browser cookies and retry |
| Groups header empty | Ensure Keycloak client has `groups` scope and group mapper configured |
| OIDC issuer mismatch | OAuth2 Proxy uses `--insecure-oidc-skip-issuer-verification=true` to handle split-horizon DNS |
