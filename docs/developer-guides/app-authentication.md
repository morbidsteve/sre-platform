# App Authentication on the SRE Platform

## How Authentication Works

All apps deployed to the SRE platform are automatically protected by Keycloak Single Sign-On (SSO). You do not need to configure authentication — it is enforced at the platform level for ATO/CMMC/FedRAMP compliance.

When a user accesses your app for the first time, they are redirected to Keycloak to sign in. After login, the auth cookie (`.apps.sre.example.com`) works across ALL apps on the platform — one login covers everything.

## What You Get Automatically

- **SSO login page** — unauthenticated users see a sign-in page
- **Keycloak OIDC authentication** — standard OpenID Connect flow
- **Cross-app SSO** — logging into any app logs you into all apps
- **User identity headers** — your app receives these headers on every request:
  - `x-auth-request-user` — authenticated username
  - `x-auth-request-email` — authenticated email
  - `x-auth-request-groups` — Keycloak group memberships (comma-separated)
  - `x-auth-request-access-token` — OAuth2 access token (if enabled)

## What You Do NOT Need To Do

- No OIDC client registration required
- No auth middleware in your app code
- No login page implementation
- No session management

## Health Endpoints Are Exempt

These paths bypass SSO (no login required):
- `/healthz`, `/health`, `/ready`, `/readyz`, `/livez`, `/metrics`

This ensures Kubernetes probes and Prometheus scraping work without authentication.

## Reading User Identity In Your App

The authenticated user's identity is available in HTTP headers:

### Node.js (Express)
```javascript
app.get('/api/whoami', (req, res) => {
  res.json({
    user: req.headers['x-auth-request-user'],
    email: req.headers['x-auth-request-email'],
    groups: (req.headers['x-auth-request-groups'] || '').split(','),
  });
});
```

### Python (Flask)
```python
@app.route('/api/whoami')
def whoami():
    return {
        'user': request.headers.get('X-Auth-Request-User'),
        'email': request.headers.get('X-Auth-Request-Email'),
        'groups': request.headers.get('X-Auth-Request-Groups', '').split(','),
    }
```

## Admin Access

Users in the `sre-admins` Keycloak group have admin access to platform services. Regular users see only their team's resources.

## Troubleshooting

**"I see a sign-in page but I can't log in"**
Contact your platform operator to create a Keycloak account in the `sre` realm.

**"I'm logged in but get 403 on my app"**
Your app may be returning 403 for its own reasons. Check the app logs.

**"Health probes are failing with 302"**
Ensure your probe paths are `/healthz`, `/readyz`, or one of the exempted paths listed above. Custom probe paths are NOT exempt from SSO.
