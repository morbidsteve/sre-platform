# SSO Integration

## 1. Overview

When you enable SSO for your application, the platform automatically provisions three resources in your namespace:

- **Istio RequestAuthentication** -- validates JWTs issued by the SRE Keycloak realm at the mesh level, using the Keycloak JWKS endpoint for signature verification.
- **Istio AuthorizationPolicy** -- requires a valid JWT on all incoming requests, except health and metrics endpoints that must remain open for Kubernetes probes and Prometheus scraping.
- **OIDC ConfigMap** -- contains Keycloak discovery URLs, mounted as environment variables in your container via `envFrom`.

Your application does not need to validate tokens itself. Istio validates every request before traffic reaches your pod. If a request carries a valid JWT, Istio forwards it to your pod with the original `Authorization: Bearer <token>` header intact. If the token is invalid or missing (on a protected path), Istio returns 401 or 403 before the request ever hits your container.

These resources are generated automatically by a Kyverno ClusterPolicy (`generate-sso-resources`) whenever a Deployment with the annotation `sre.io/sso: "enabled"` is created in a tenant namespace.

> **Note:** This per-app JWT validation is a second layer on top of the platform-wide OAuth2 Proxy authentication that already gates all ingress traffic. See the [App SSO Integration Guide](../app-sso-integration-guide.md) for details on the platform-level auth flow, identity headers, and OAuth2 Proxy behavior.

---

## 2. How to Enable SSO

### Via App Contract (recommended)

Add `sso: enabled: true` under `services` in your contract file:

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: my-app
  team: team-alpha
spec:
  type: web-app
  image: harbor.sre.internal/team-alpha/my-app:v1.0.0
  resources: small
  ingress: my-app.apps.sre.example.com
  services:
    sso:
      enabled: true
```

Run `task deploy-app -- apps/contracts/my-app.yaml` to generate the HelmRelease. The generator adds the annotation `sre.io/sso: "enabled"` to the HelmRelease metadata, which propagates to the Deployment. Kyverno detects the annotation and creates the SSO resources.

### Via Helm values directly

If you manage your HelmRelease manually instead of using a contract, add the SSO annotation to the HelmRelease metadata:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-app
  namespace: team-alpha
  annotations:
    sre.io/sso: "enabled"
spec:
  # ... your existing HelmRelease spec
```

The annotation must be present on the resulting Deployment for Kyverno to trigger. If your Helm chart passes annotations through to the Deployment (the SRE app templates do this by default), this is all you need.

---

## 3. What Gets Generated

When Kyverno detects a Deployment with `sre.io/sso: "enabled"` in a tenant namespace, it creates three resources:

### RequestAuthentication (`<app-name>-jwt-authn`)

Validates JWTs issued by the SRE Keycloak realm. Configured with:

- **Issuer**: `https://keycloak.apps.sre.example.com/realms/sre`
- **JWKS URI**: `https://keycloak.apps.sre.example.com/realms/sre/protocol/openid-connect/certs`
- **Forward original token**: `true` -- the validated token is passed through to your pod in the `Authorization` header.
- **Selector**: matches pods with the `app.kubernetes.io/name` label matching your Deployment.

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: my-app-jwt-authn
  namespace: team-alpha
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  jwtRules:
    - issuer: "https://keycloak.apps.sre.example.com/realms/sre"
      jwksUri: "https://keycloak.apps.sre.example.com/realms/sre/protocol/openid-connect/certs"
      forwardOriginalToken: true
```

### AuthorizationPolicy (`<app-name>-require-jwt`)

Requires a valid JWT for all requests, with exemptions for health and metrics endpoints. The policy has two rules:

1. **Allow without JWT**: requests to `/healthz`, `/readyz`, `/metrics`, and `/livez` pass through without authentication.
2. **Require JWT for everything else**: all other requests must have a valid `requestPrincipal` (set by the RequestAuthentication above).

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: my-app-require-jwt
  namespace: team-alpha
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  rules:
    - to:
        - operation:
            paths:
              - /healthz
              - /readyz
              - /metrics
              - /livez
    - from:
        - source:
            requestPrincipals:
              - "*"
```

### ConfigMap (`<app-name>-oidc-config`)

Contains OIDC discovery URLs for your application. Mounted as environment variables in your container via `envFrom` (the SRE Helm chart templates handle this automatically when SSO is enabled).

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-oidc-config
  namespace: team-alpha
data:
  OIDC_ISSUER_URL: "https://keycloak.apps.sre.example.com/realms/sre"
  OIDC_CLIENT_ID: "my-app"
  OIDC_DISCOVERY_URL: "https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration"
```

All three resources have `sre.io/generated-by: kyverno` labels and are kept in sync with the Deployment via Kyverno's `synchronize: true` setting. If the Deployment is deleted, these resources are cleaned up automatically.

---

## 4. Prerequisites

Before enabling SSO, a Keycloak OIDC client must exist for your application. Ask your platform admin to create one, or request it through your team's onboarding process.

The platform admin needs to:

1. Log in to the Keycloak admin console at `https://keycloak.apps.sre.example.com/admin` (master realm credentials).
2. Switch to the `sre` realm.
3. Navigate to Clients and create a new client:
   - **Client ID**: your app name (must match `metadata.name` in your AppContract).
   - **Client Protocol**: openid-connect.
   - **Root URL**: `https://<your-ingress-hostname>` (e.g., `https://my-app.apps.sre.example.com`).
   - **Valid Redirect URIs**: `https://<your-ingress-hostname>/*`.
   - **Web Origins**: `https://<your-ingress-hostname>`.
4. Under the client's **Client Scopes** tab, add the `groups` scope. This ensures the JWT contains the user's Keycloak group memberships, which your app can use for authorization decisions.

Without a matching Keycloak client, tokens issued for your app will not pass JWT validation and all requests will receive 401 responses.

---

## 5. How JWT Validation Works

The full request flow when SSO is enabled:

1. **User authenticates with Keycloak.** This happens either through the platform-wide OAuth2 Proxy login flow (browser users) or by directly calling the Keycloak token endpoint (API clients, service accounts).
2. **User sends a request with `Authorization: Bearer <token>`.** For browser users, OAuth2 Proxy attaches this header automatically after login. API clients include it directly.
3. **Istio sidecar intercepts the request.** The sidecar proxy running alongside your pod evaluates the request before it reaches your container.
4. **RequestAuthentication validates the JWT.** Istio checks the token signature against Keycloak's JWKS endpoint, verifies the issuer claim matches `https://keycloak.apps.sre.example.com/realms/sre`, and confirms the token has not expired.
5. **AuthorizationPolicy enforces access.** If the path is `/healthz`, `/readyz`, `/metrics`, or `/livez`, the request passes without a token. For all other paths, a valid JWT is required.
6. **Valid token: request reaches your pod.** The original `Authorization: Bearer <token>` header is forwarded to your container. Your app can decode the token to extract user identity.
7. **Invalid or missing token: Istio returns 401/403.** The request never reaches your pod.

```
User/Client
    |
    | Authorization: Bearer <token>
    v
Istio Sidecar
    |
    |-- RequestAuthentication validates JWT signature + issuer + expiry
    |-- AuthorizationPolicy checks path exemptions and requestPrincipal
    |
    |-- PASS --> forward request to pod (with original token)
    |-- FAIL --> return 401/403 (request never reaches pod)
```

---

## 6. Exempt Endpoints

These paths are excluded from JWT requirements so that Kubernetes probes and Prometheus scraping continue to work:

| Path | Purpose |
|------|---------|
| `/healthz` | Kubernetes liveness probe |
| `/readyz` | Kubernetes readiness probe |
| `/metrics` | Prometheus scraping |
| `/livez` | Alternative liveness endpoint |

Requests to these paths do not require an `Authorization` header and will not be rejected by the AuthorizationPolicy.

If your application needs additional public endpoints (for example, a webhook receiver or a public status page), contact your platform admin to customize the AuthorizationPolicy. The default set cannot be changed through the AppContract.

---

## 7. Reading the JWT in Your Application

Even though Istio validates the token before it reaches your pod, your application can still read the token to extract user identity, group memberships, and other claims. Because Istio has already verified the signature, your app only needs to decode the payload -- no signature verification is necessary.

### Node.js (Express)

```javascript
app.get('/api/profile', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  // Token is already validated by Istio -- just decode the payload
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString()
  );

  res.json({
    sub: payload.sub,
    email: payload.email,
    groups: payload.groups || [],
    name: payload.preferred_username,
  });
});
```

### Python (Flask)

```python
import jwt
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/profile')
def profile():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        return jsonify(error='No token'), 401

    # Token is already validated by Istio -- just decode without verification
    payload = jwt.decode(token, options={"verify_signature": False})

    return jsonify(
        sub=payload['sub'],
        email=payload.get('email'),
        groups=payload.get('groups', []),
        name=payload.get('preferred_username'),
    )
```

### Go

```go
import (
    "encoding/base64"
    "encoding/json"
    "net/http"
    "strings"
)

func profileHandler(w http.ResponseWriter, r *http.Request) {
    auth := r.Header.Get("Authorization")
    token := strings.TrimPrefix(auth, "Bearer ")
    if token == "" || token == auth {
        http.Error(w, "No token", http.StatusUnauthorized)
        return
    }

    // Token is already validated by Istio -- just decode the payload
    parts := strings.Split(token, ".")
    if len(parts) != 3 {
        http.Error(w, "Invalid token format", http.StatusBadRequest)
        return
    }

    payload, err := base64.RawURLEncoding.DecodeString(parts[1])
    if err != nil {
        http.Error(w, "Failed to decode token", http.StatusBadRequest)
        return
    }

    var claims map[string]interface{}
    json.Unmarshal(payload, &claims)

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(claims)
}
```

**Why `verify_signature=False` / manual decode?** Istio has already validated the token at the mesh level using Keycloak's JWKS endpoint. Repeating signature verification in your app is unnecessary overhead. Your app only needs to extract claims from the payload.

---

## 8. Environment Variables

When SSO is enabled, these environment variables are injected into your container from the generated ConfigMap:

| Variable | Value | Description |
|----------|-------|-------------|
| `OIDC_ISSUER_URL` | `https://keycloak.apps.sre.example.com/realms/sre` | Token issuer URL. Use this to validate the `iss` claim if needed. |
| `OIDC_CLIENT_ID` | Your app name (e.g., `my-app`) | OIDC client identifier registered in Keycloak. |
| `OIDC_DISCOVERY_URL` | `https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration` | OpenID Connect discovery endpoint. Returns all OIDC metadata including token, auth, and JWKS endpoints. |

Use these variables for any OIDC library configuration rather than hardcoding Keycloak URLs. If the Keycloak domain changes, the platform will update the ConfigMap and your app picks up the new values on the next pod restart.

---

## 9. Troubleshooting

### 401 Unauthorized on all requests

- **Keycloak client does not exist.** Verify a client with your app's name exists in the `sre` realm. The client ID must match exactly.
- **Wrong issuer.** The token must be issued by `https://keycloak.apps.sre.example.com/realms/sre`. Tokens from other realms or identity providers will be rejected.
- **Token expired.** Keycloak access tokens have a default lifetime of 5 minutes. Ensure your client or calling service refreshes tokens before expiry.
- **JWKS endpoint unreachable.** The Istio sidecar must be able to reach Keycloak's JWKS URI. Check if Keycloak is healthy: `kubectl get pods -n keycloak`.

### 403 Forbidden despite valid token

- **Missing requestPrincipal.** The AuthorizationPolicy requires `requestPrincipals: ["*"]`, which is set by the RequestAuthentication when JWT validation succeeds. If the token is valid but the principal is not being set, check that the RequestAuthentication resource exists: `kubectl get requestauthentication -n <team>`.
- **Label mismatch.** Both the RequestAuthentication and AuthorizationPolicy use `app.kubernetes.io/name` as the pod selector. Verify your Deployment's pods have this label and it matches your app name.

### Health probes failing after enabling SSO

- Health endpoints (`/healthz`, `/readyz`, `/metrics`, `/livez`) are explicitly exempt from JWT requirements. If probes are still failing, verify the probe paths in your Deployment match one of the exempt paths exactly.
- If your app uses non-standard probe paths (e.g., `/health`, `/ready`), either change your probes to use the standard paths or contact your platform admin to add your custom paths to the AuthorizationPolicy.

### OIDC environment variables not available

- The ConfigMap is generated by Kyverno when the Deployment is created. If the ConfigMap is missing, Kyverno may not have triggered.
- Verify the annotation exists on the Deployment: `kubectl get deployment <app-name> -n <team> -o jsonpath='{.metadata.annotations.sre\.io/sso}'`. It must be `"enabled"`.
- Check that the namespace has the `sre.io/team` label: `kubectl get ns <team> --show-labels`. The Kyverno policy only triggers in namespaces with this label.
- Check Kyverno logs for errors: `kubectl logs -n kyverno -l app.kubernetes.io/name=kyverno -c kyverno`.
- Verify the ConfigMap exists: `kubectl get cm <app-name>-oidc-config -n <team>`.

### SSO resources not being created

- The Kyverno policy `generate-sso-resources` must be active. Check its status: `kubectl get clusterpolicy generate-sso-resources`.
- The policy excludes platform namespaces (`kube-system`, `istio-system`, `flux-system`, `kyverno`, `cert-manager`, `monitoring`, `logging`). SSO generation only works in tenant namespaces.
- Review Kyverno policy reports for violations: `kubectl get policyreport -n <team>`.
