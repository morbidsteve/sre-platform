# App SSO Integration Guide

This guide explains how Single Sign-On (SSO) works on the SRE platform and how to integrate your application with it. Whether you are deploying a new app or migrating an existing one, this document covers every pattern from zero-effort header consumption to full local JWT issuance.

**Audience**: Application developers deploying on SRE.

---

## Table of Contents

1. [How SSO Works on SRE](#1-how-sso-works-on-sre)
2. [The Authentication Flow in Detail](#2-the-authentication-flow-in-detail)
3. [Headers Your App Receives](#3-headers-your-app-receives)
4. [Integration Patterns](#4-integration-patterns)
   - [Pattern A: Header-Only (Simplest)](#pattern-a-header-only-simplest)
   - [Pattern B: SSO + Local JWT (Recommended)](#pattern-b-sso--local-jwt-recommended)
   - [Pattern C: Nginx auth_request](#pattern-c-nginx-auth_request)
5. [Keystone SSO Reference Implementation](#5-keystone-sso-reference-implementation)
6. [Group-to-Role Mapping Conventions](#6-group-to-role-mapping-conventions)
7. [Keycloak Group and User Management](#7-keycloak-group-and-user-management)
8. [Testing Locally](#8-testing-locally)
9. [Testing in Cluster](#9-testing-in-cluster)
10. [Nginx Configuration for Header Forwarding](#10-nginx-configuration-for-header-forwarding)
11. [Common Gotchas](#11-common-gotchas)
12. [Troubleshooting](#12-troubleshooting)
13. [Reference: Full Auth Chain Configuration](#13-reference-full-auth-chain-configuration)

---

## 1. How SSO Works on SRE

SRE provides **platform-level authentication** via OAuth2 Proxy and Keycloak. Every HTTP request entering the cluster through the Istio ingress gateway is intercepted and authenticated before it reaches your application. Your app never handles login pages, password validation, or OIDC token exchange.

### Architecture Overview

```
                                    ┌──────────────────────────────────┐
                                    │         Keycloak                 │
                                    │    (OIDC Identity Provider)      │
                                    │    Realm: sre                    │
                                    │    Client: oauth2-proxy          │
                                    └──────────┬───────────────────────┘
                                               │
                                               │ OIDC token exchange
                                               │ (in-cluster via svc)
                                               │
┌─────────┐     ┌───────────────┐    ┌─────────┴──────────┐    ┌──────────────┐
│  Browser │────►│ Istio Gateway │───►│   OAuth2 Proxy     │    │   Your App   │
│          │◄────│   (port 443)  │◄───│   (ext-authz)      │    │              │
│          │     │               │    │                    │    │  Receives:   │
│          │     │  TLS + mTLS   │    │  Sets headers:     │    │  x-auth-*    │
│          │     │  termination  │    │  x-auth-request-*  │    │  headers     │
└─────────┘     └───────┬───────┘    └────────────────────┘    └──────┬───────┘
                        │                                             │
                        │            Authenticated request             │
                        └─────────────────────────────────────────────┘
```

### What Happens When a User Visits Your App

1. User navigates to `https://myapp.apps.sre.example.com`
2. The request hits the **Istio ingress gateway** (MetalLB IP 192.168.2.200)
3. Istio's ext-authz filter sends the request to **OAuth2 Proxy** for authentication
4. OAuth2 Proxy checks for a valid `_sre_oauth2` session cookie
5. **If no valid session**: OAuth2 Proxy redirects the user to the Keycloak login page
6. User authenticates with Keycloak (username/password, MFA, LDAP, etc.)
7. Keycloak issues an OIDC token, OAuth2 Proxy creates a session cookie
8. **If valid session**: OAuth2 Proxy adds identity headers and returns HTTP 200
9. Istio forwards the request to your app **with the identity headers attached**
10. Your app reads the headers and knows who the user is

### What You Do NOT Need to Build

- Login pages
- Password storage or validation
- OIDC client configuration
- Token refresh logic
- Session management (OAuth2 Proxy handles this)
- Logout flows (handled by OAuth2 Proxy + Keycloak)

---

## 2. The Authentication Flow in Detail

### Istio ext-authz Evaluation Order

Istio evaluates authorization policies in this order: **CUSTOM** then **DENY** then **ALLOW**.

```
Request arrives at Istio Gateway
        │
        ▼
  ┌─────────────────────────────────────┐
  │  CUSTOM: ext-authz-oauth2           │
  │  Provider: oauth2-proxy             │
  │                                     │
  │  Excluded paths:                    │
  │    /healthz, /health, /ready        │
  │    /oauth2/*                        │
  │                                     │
  │  Excluded hosts:                    │
  │    keycloak.apps.sre.example.com    │
  │    harbor.apps.sre.example.com      │
  │    neuvector.apps.sre.example.com   │
  └──────────┬──────────────────────────┘
             │
        ext-authz passes?
        ┌────┴────┐
       YES       NO
        │         │
        ▼         ▼
  ┌──────────┐  ┌────────────────────┐
  │  ALLOW:  │  │  OAuth2 Proxy      │
  │  catch-  │  │  returns 302       │
  │  all     │  │  redirect to       │
  │          │  │  Keycloak login     │
  └────┬─────┘  └────────────────────┘
       │
       ▼
  Request forwarded
  to your app with
  x-auth-request-* headers
```

### OAuth2 Proxy Configuration (Key Parameters)

The platform configures OAuth2 Proxy with these settings relevant to your app:

| Parameter | Value | Effect |
|-----------|-------|--------|
| `--provider` | `keycloak-oidc` | Uses Keycloak as the OIDC provider |
| `--cookie-name` | `_sre_oauth2` | Session cookie name |
| `--cookie-domain` | `.apps.sre.example.com` | Cookie shared across all `*.apps.sre.example.com` subdomains |
| `--set-xauthrequest` | `true` | Sets `x-auth-request-*` response headers |
| `--pass-access-token` | `true` | Passes the OIDC access token in headers |
| `--pass-authorization-header` | `true` | Passes the `Authorization: Bearer <token>` header |
| `--scope` | `openid profile email groups` | Requests user profile, email, and group membership |
| `--oidc-groups-claim` | `groups` | Extracts Keycloak groups from the OIDC token |

### Cookie Scope

The session cookie `_sre_oauth2` is set on `.apps.sre.example.com`. This means:
- A user who logs in via `dashboard.apps.sre.example.com` is automatically authenticated on `myapp.apps.sre.example.com`
- There is a **single sign-on experience** across all apps on the platform
- Logging out from any app logs the user out of all apps

---

## 3. Headers Your App Receives

After OAuth2 Proxy authenticates a request, Istio injects these headers into the request forwarded to your application:

### Identity Headers

| Header | Example Value | Description |
|--------|---------------|-------------|
| `x-auth-request-user` | `f47ac10b-58cc-4372-a567-0e02b2c3d479` | Keycloak user ID (UUID). This is the **subject** claim from the OIDC token. **Not a username.** |
| `x-auth-request-email` | `jane.doe@example.com` | User's email address from Keycloak |
| `x-auth-request-preferred-username` | `jdoe` | Human-readable username from Keycloak |
| `x-auth-request-groups` | `sre-admins,logistics,team-alpha` | Comma-separated list of Keycloak groups the user belongs to |
| `x-auth-request-access-token` | `eyJhbGciOiJSUzI1NiIs...` | Raw OIDC access token (JWT) |
| `Authorization` | `Bearer eyJhbGciOiJSUzI1NiIs...` | Same access token in standard Authorization header format |

### Important Notes on Headers

- **`x-auth-request-user` is a UUID, not a username.** Use `x-auth-request-preferred-username` for display purposes.
- **`x-auth-request-groups` is a comma-separated string**, not a JSON array. Parse it by splitting on `,`.
- **Headers are only present on authenticated requests.** Health check paths (`/healthz`, `/health`, `/ready`) bypass OAuth2 Proxy and will NOT have these headers.
- **Headers are trusted.** Because they are injected by OAuth2 Proxy (which runs inside the mesh with mTLS), they cannot be spoofed by external clients. Istio strips any client-provided `x-auth-request-*` headers at the gateway.

### Extracting Headers in Different Languages

**Node.js / Express:**
```javascript
app.get('/api/profile', (req, res) => {
  const userId    = req.headers['x-auth-request-user'];
  const email     = req.headers['x-auth-request-email'];
  const username  = req.headers['x-auth-request-preferred-username'];
  const groups    = (req.headers['x-auth-request-groups'] || '').split(',').filter(Boolean);

  res.json({ userId, email, username, groups });
});
```

**Python / FastAPI:**
```python
from fastapi import Request

@app.get("/api/profile")
async def get_profile(request: Request):
    user_id  = request.headers.get("x-auth-request-user")
    email    = request.headers.get("x-auth-request-email")
    username = request.headers.get("x-auth-request-preferred-username")
    groups   = [g for g in (request.headers.get("x-auth-request-groups") or "").split(",") if g]

    return {"user_id": user_id, "email": email, "username": username, "groups": groups}
```

**Go:**
```go
func profileHandler(w http.ResponseWriter, r *http.Request) {
    userID   := r.Header.Get("X-Auth-Request-User")
    email    := r.Header.Get("X-Auth-Request-Email")
    username := r.Header.Get("X-Auth-Request-Preferred-Username")
    groups   := strings.Split(r.Header.Get("X-Auth-Request-Groups"), ",")

    json.NewEncoder(w).Encode(map[string]interface{}{
        "user_id":  userID,
        "email":    email,
        "username": username,
        "groups":   groups,
    })
}
```

**Java / Spring:**
```java
@GetMapping("/api/profile")
public Map<String, Object> getProfile(
        @RequestHeader("x-auth-request-user") String userId,
        @RequestHeader("x-auth-request-email") String email,
        @RequestHeader("x-auth-request-preferred-username") String username,
        @RequestHeader(value = "x-auth-request-groups", defaultValue = "") String groupsRaw) {
    List<String> groups = Arrays.stream(groupsRaw.split(","))
            .filter(s -> !s.isEmpty())
            .collect(Collectors.toList());
    return Map.of("userId", userId, "email", email, "username", username, "groups", groups);
}
```

---

## 4. Integration Patterns

Choose the pattern that fits your app's complexity:

| Pattern | Complexity | Use Case | Auth Logic in Your App |
|---------|-----------|----------|----------------------|
| **A: Header-Only** | None | Static sites, simple APIs, dashboards | Zero -- just read headers |
| **B: SSO + Local JWT** | Medium | Apps with roles, permissions, local user DB | Read headers, find/create user, issue local JWT |
| **C: Nginx auth_request** | Low | Apps behind nginx reverse proxy | Nginx extracts headers, passes to upstream |

---

### Pattern A: Header-Only (Simplest)

Your app trusts the platform headers completely and has no local concept of users, roles, or sessions.

**When to use:**
- Static dashboards or documentation sites
- Simple CRUD APIs where Keycloak groups directly map to permissions
- Internal tools where "is authenticated" is sufficient authorization

**Implementation:**

```
┌──────────────────────────────┐
│  Your App                    │
│                              │
│  Every request has:          │
│  x-auth-request-email        │
│  x-auth-request-groups       │
│                              │
│  No login page needed.       │
│  No user database needed.    │
│  No session management.      │
└──────────────────────────────┘
```

**Express.js example:**

```javascript
const express = require('express');
const app = express();

// Middleware to extract SSO identity from platform headers
function ssoIdentity(req, res, next) {
  req.user = {
    id:       req.headers['x-auth-request-user'],
    email:    req.headers['x-auth-request-email'],
    username: req.headers['x-auth-request-preferred-username'],
    groups:   (req.headers['x-auth-request-groups'] || '').split(',').filter(Boolean),
  };
  next();
}

// Middleware for group-based authorization
function requireGroup(...allowedGroups) {
  return (req, res, next) => {
    const hasGroup = req.user.groups.some(g => allowedGroups.includes(g));
    if (!hasGroup) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

app.use(ssoIdentity);

// Public endpoint (still requires SSO login, but any authenticated user)
app.get('/api/data', (req, res) => {
  res.json({ message: `Hello ${req.user.username}`, data: getData() });
});

// Admin-only endpoint
app.get('/api/admin/settings', requireGroup('sre-admins'), (req, res) => {
  res.json({ settings: getSettings() });
});

app.listen(8080);
```

**FastAPI example:**

```python
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

def get_sso_user(request: Request) -> dict:
    """Extract SSO identity from platform headers."""
    return {
        "id": request.headers.get("x-auth-request-user"),
        "email": request.headers.get("x-auth-request-email"),
        "username": request.headers.get("x-auth-request-preferred-username"),
        "groups": [g for g in (request.headers.get("x-auth-request-groups") or "").split(",") if g],
    }

def require_group(request: Request, *allowed_groups: str):
    """Raise 403 if user is not in any of the allowed groups."""
    user = get_sso_user(request)
    if not any(g in allowed_groups for g in user["groups"]):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user

@app.get("/api/data")
async def get_data(request: Request):
    user = get_sso_user(request)
    return {"message": f"Hello {user['username']}"}

@app.get("/api/admin/settings")
async def get_settings(request: Request):
    user = require_group(request, "sre-admins")
    return {"settings": {"debug": False}}
```

---

### Pattern B: SSO + Local JWT (Recommended)

Your app maintains a local user database and issues its own JWTs, but uses SSO headers for authentication instead of a login form. This is the pattern the **Keystone** app uses.

**When to use:**
- Apps with role-based access control (RBAC) beyond Keycloak groups
- Apps that need a local user record (profile data, preferences, activity history)
- Apps that issue JWTs for their own frontend SPA
- Apps migrating from standalone auth to platform SSO

**Implementation:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Your App                                                           │
│                                                                     │
│  1. Browser hits GET /api/auth/sso                                  │
│  2. Backend reads x-auth-request-* headers                          │
│  3. Find or create user in local DB                                 │
│     - Map Keycloak groups to local roles                            │
│  4. Issue local JWT with app-specific claims                        │
│  5. Return JWT to frontend                                          │
│  6. Frontend stores JWT, uses it for subsequent API calls           │
│                                                                     │
│  ┌──────────┐     ┌──────────────┐     ┌────────────┐              │
│  │ Frontend  │────►│ GET /api/    │────►│ Local DB   │              │
│  │ (SPA)     │◄────│ auth/sso     │◄────│ users tbl  │              │
│  │           │     │              │     │            │              │
│  │ Stores    │     │ Reads SSO    │     │ Upsert     │              │
│  │ local JWT │     │ headers,     │     │ user from  │              │
│  │ in memory │     │ returns JWT  │     │ SSO data   │              │
│  └──────────┘     └──────────────┘     └────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

**Backend endpoint (Express.js):**

```javascript
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// SSO login endpoint — called by the frontend on page load
app.get('/api/v1/auth/sso', async (req, res) => {
  const ssoUser = req.headers['x-auth-request-user'];
  const email   = req.headers['x-auth-request-email'];
  const username = req.headers['x-auth-request-preferred-username'];
  const groups  = (req.headers['x-auth-request-groups'] || '').split(',').filter(Boolean);

  if (!ssoUser || !email) {
    return res.status(401).json({ error: 'No SSO session — not authenticated' });
  }

  // Map Keycloak groups to local app roles
  const role = mapGroupsToRole(groups);

  // Find or create user in local database
  const user = await findOrCreateUser({ ssoUser, email, username, role });

  // Issue local JWT
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      ssoId: ssoUser,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    },
  });
});

function mapGroupsToRole(groups) {
  if (groups.includes('sre-admins'))  return 'admin';
  if (groups.includes('developers')) return 'developer';
  if (groups.includes('logistics'))  return 'logistics';
  return 'viewer';
}

async function findOrCreateUser({ ssoUser, email, username, role }) {
  // Upsert: create if new, update email/username/role if changed
  const result = await pool.query(`
    INSERT INTO users (sso_id, email, username, role)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (sso_id) DO UPDATE SET
      email = EXCLUDED.email,
      username = EXCLUDED.username,
      role = EXCLUDED.role,
      last_login = NOW()
    RETURNING *
  `, [ssoUser, email, username, role]);

  return result.rows[0];
}
```

**Frontend SSOGate component (React):**

```tsx
import { useEffect, useState, type ReactNode } from 'react';

interface SSOGateProps {
  children: ReactNode;
}

export function SSOGate({ children }: SSOGateProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function authenticateViaSSO() {
      try {
        const res = await fetch('/api/v1/auth/sso', { credentials: 'include' });

        if (!res.ok) {
          // Not authenticated via SSO — this should not happen on the platform
          // because OAuth2 Proxy intercepts unauthenticated requests.
          // If we get here, something is misconfigured.
          throw new Error(`SSO auth failed: ${res.status}`);
        }

        const data = await res.json();

        // Store the local JWT for subsequent API calls
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'SSO authentication failed');
        setLoading(false);
      }
    }

    authenticateViaSSO();
  }, []);

  if (loading) return <div className="loading">Authenticating via SSO...</div>;
  if (error)   return <div className="error">Authentication error: {error}</div>;

  return <>{children}</>;
}

// Usage in App.tsx:
function App() {
  return (
    <SSOGate>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Router>
    </SSOGate>
  );
}
```

**Database schema for the users table:**

```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  sso_id     UUID NOT NULL UNIQUE,   -- Keycloak user ID (x-auth-request-user)
  email      VARCHAR(255) NOT NULL,
  username   VARCHAR(100) NOT NULL,
  role       VARCHAR(50)  NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_sso_id ON users (sso_id);
CREATE INDEX idx_users_email  ON users (email);
```

---

### Pattern C: Nginx auth_request

Your app runs behind an nginx reverse proxy (common for apps that serve a frontend SPA and proxy API requests). Nginx handles header extraction and passes identity to the upstream app.

**When to use:**
- Apps that already use nginx as a reverse proxy
- Apps where you cannot modify the backend code
- Legacy apps that need identity injection

**Implementation:**

```
┌──────────────────────────────────────────────────────┐
│  Pod                                                  │
│                                                       │
│  ┌──────────┐     ┌──────────────┐                   │
│  │  nginx    │────►│  backend     │                   │
│  │  :80      │     │  :3000       │                   │
│  │           │     │              │                   │
│  │  Reads    │     │  Receives    │                   │
│  │  SSO hdrs │     │  X-User-*    │                   │
│  │  from     │     │  headers     │                   │
│  │  Istio    │     │  from nginx  │                   │
│  └──────────┘     └──────────────┘                   │
└──────────────────────────────────────────────────────┘
```

**nginx.conf:**

```nginx
server {
    listen 80;
    server_name _;

    # Serve frontend static files
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend, forwarding SSO headers
    location /api/ {
        proxy_pass http://127.0.0.1:3000;

        # Forward the SSO identity headers from Istio/OAuth2 Proxy
        proxy_set_header X-User-ID       $http_x_auth_request_user;
        proxy_set_header X-User-Email    $http_x_auth_request_email;
        proxy_set_header X-User-Username $http_x_auth_request_preferred_username;
        proxy_set_header X-User-Groups   $http_x_auth_request_groups;

        # Standard proxy headers
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**Important:** The SSO headers arrive at your pod as `x-auth-request-*` headers because Istio injects them. In nginx, you access them as `$http_x_auth_request_user` (nginx converts header names to `$http_<lowercase_with_underscores>`). You can rename them to whatever your backend expects via `proxy_set_header`.

---

## 5. Keystone SSO Reference Implementation

[Keystone](https://github.com/morbidsteve/keystone) is a full-stack app (FastAPI backend, React frontend) deployed on SRE that demonstrates Pattern B (SSO + Local JWT). Here is how it works.

### Backend: GET /api/v1/auth/sso

When the frontend loads, it calls `GET /api/v1/auth/sso`. The backend:

1. Reads `x-auth-request-user`, `x-auth-request-email`, `x-auth-request-preferred-username`, and `x-auth-request-groups` from the request headers
2. Looks up or creates the user in the local PostgreSQL database
3. Maps Keycloak groups to Keystone roles:
   - `sre-admins` maps to `admin`
   - `logistics` maps to `logistics_officer`
   - Default: `viewer`
4. Issues a local JWT containing the user's Keystone-specific role and permissions
5. Returns the JWT and user profile to the frontend

### Frontend: SSOGate Component

Keystone's React frontend wraps the entire app in an `SSOGate` component:

```
<SSOGate>            ← Calls /api/v1/auth/sso on mount
  <Router>
    <Dashboard />    ← Only renders after SSO auth succeeds
    <Map />
    <Settings />
  </Router>
</SSOGate>
```

The SSOGate:
- Fires a `fetch('/api/v1/auth/sso')` on mount (the `_sre_oauth2` cookie is sent automatically because the request is same-origin)
- Stores the returned JWT in localStorage
- All subsequent API calls include `Authorization: Bearer <local-jwt>`
- If the SSO call fails (expired session, etc.), the user sees an error and OAuth2 Proxy will redirect them to Keycloak on the next navigation

### Environment Variables

Keystone uses an `AUTH_MODE` environment variable to switch between standalone auth and SSO:

```yaml
# In the Kubernetes Deployment or HelmRelease values:
env:
  - name: AUTH_MODE
    value: "sso"        # "local" for standalone, "sso" for platform SSO
  - name: JWT_SECRET
    value: "your-secret-here"
```

When `AUTH_MODE=sso`, the backend:
- Disables the `/api/v1/auth/login` endpoint (no local login form)
- Enables the `/api/v1/auth/sso` endpoint
- Trusts `x-auth-request-*` headers for identity

When `AUTH_MODE=local`, the backend:
- Uses its own login form and password validation
- Ignores SSO headers

This dual-mode approach lets developers test locally without the platform.

### Keystone as a Template

If you are building a new app, use Keystone's SSO integration as a starting point:

1. Copy the `/api/v1/auth/sso` endpoint pattern
2. Copy the `SSOGate` React component
3. Copy the `mapGroupsToRole` function and customize for your domain
4. Add the `users` table with `sso_id` column
5. Set `AUTH_MODE=sso` in your Kubernetes deployment

---

## 6. Group-to-Role Mapping Conventions

Keycloak groups are the platform's authorization primitive. When mapping groups to application roles, follow these conventions:

### Platform Groups (Managed by SRE Admins)

| Keycloak Group | Intended Role | Description |
|---------------|---------------|-------------|
| `sre-admins` | Platform administrator | Full access to all platform services and all tenant apps |
| `developers` | Developer | Can deploy apps, view logs, access dev tools |
| `viewers` | Read-only | Can view dashboards and app UIs, cannot modify |

### Tenant Groups (Managed by Team Leads)

| Keycloak Group | Intended Role | Description |
|---------------|---------------|-------------|
| `team-alpha` | Team membership | Member of team-alpha, access to team-alpha namespace |
| `team-beta` | Team membership | Member of team-beta, access to team-beta namespace |
| `logistics` | Domain role | Domain-specific group for logistics apps |

### Mapping Strategy

Your app should define a mapping from Keycloak groups to local roles. The recommended precedence order:

```
sre-admins     → admin (highest privilege)
<domain-group> → domain-specific role
developers     → developer / editor
team-<name>    → team member
viewers        → viewer (lowest privilege)
(no groups)    → viewer or denied (your choice)
```

**Example mapping function:**

```javascript
function mapGroupsToRole(groups) {
  // Check in order of highest to lowest privilege
  if (groups.includes('sre-admins'))    return 'admin';
  if (groups.includes('logistics'))     return 'logistics_officer';
  if (groups.includes('developers'))    return 'editor';
  if (groups.some(g => g.startsWith('team-'))) return 'member';
  return 'viewer';
}
```

### Creating Custom Groups

If your app needs a group that does not exist, request it from the platform admin or create it yourself if you have Keycloak admin access. See [Section 7](#7-keycloak-group-and-user-management).

---

## 7. Keycloak Group and User Management

### Accessing Keycloak Admin Console

```
URL:      https://keycloak.apps.sre.example.com/admin
Realm:    sre
Username: admin
Password: 03F2tLffxi
```

Alternatively, use the **SRE Dashboard** (User Management tab) for common operations without accessing the Keycloak admin console directly.

### Creating a Group

1. Log in to the Keycloak admin console
2. Select the `sre` realm (top-left dropdown)
3. Navigate to **Groups** in the left sidebar
4. Click **Create group**
5. Enter the group name (use lowercase-kebab-case: `logistics`, `team-alpha`, `data-analysts`)
6. Click **Create**

### Assigning a User to a Group

1. Navigate to **Users** in the left sidebar
2. Search for and click on the user
3. Go to the **Groups** tab
4. Click **Join Group**
5. Select the group and click **Join**

### Creating a User

1. Navigate to **Users** > **Add user**
2. Fill in: Username, Email, First Name, Last Name
3. Click **Create**
4. Go to the **Credentials** tab
5. Click **Set password**, enter the password, uncheck **Temporary** if desired
6. Go to the **Groups** tab and assign groups

### Verifying Group Membership in Tokens

After assigning a user to groups, verify the groups appear in the OIDC token:

```bash
# Get a token for a user
TOKEN=$(curl -s -X POST \
  "https://keycloak.apps.sre.example.com/realms/sre/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=oauth2-proxy" \
  -d "client_secret=TtZuIm3Igj088TtY4cw3xfXf5U1I8f9z" \
  -d "username=jdoe" \
  -d "password=userpassword" \
  -d "scope=openid groups" | jq -r '.access_token')

# Decode and inspect the token (base64 decode the payload)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.groups'
# Expected output: ["sre-admins", "logistics"]
```

### Keycloak Client Configuration for Groups

The `oauth2-proxy` client in Keycloak must have a **groups** protocol mapper configured. This is set up during platform installation. If groups are not appearing in headers, verify:

1. In Keycloak admin > `sre` realm > **Clients** > `oauth2-proxy`
2. Go to **Client scopes** tab
3. Click `oauth2-proxy-dedicated` > **Mappers**
4. Verify a mapper named `groups` exists with:
   - Mapper type: `Group Membership`
   - Token claim name: `groups`
   - Full group path: `OFF` (just the group name, not `/groupname`)
   - Add to ID token: `ON`
   - Add to access token: `ON`
   - Add to userinfo: `ON`

---

## 8. Testing Locally

When developing locally (outside the SRE cluster), OAuth2 Proxy is not present, so your app will not receive SSO headers. Here is how to simulate them.

### Method 1: Pass Headers via curl

```bash
# Simulate an authenticated request to your local app
curl -H "x-auth-request-user: f47ac10b-58cc-4372-a567-0e02b2c3d479" \
     -H "x-auth-request-email: jdoe@example.com" \
     -H "x-auth-request-preferred-username: jdoe" \
     -H "x-auth-request-groups: sre-admins,logistics" \
     http://localhost:8080/api/v1/auth/sso
```

### Method 2: Pass Headers via Postman

1. Create a new GET request to `http://localhost:8080/api/v1/auth/sso`
2. In the **Headers** tab, add:
   - `x-auth-request-user`: `f47ac10b-58cc-4372-a567-0e02b2c3d479`
   - `x-auth-request-email`: `jdoe@example.com`
   - `x-auth-request-preferred-username`: `jdoe`
   - `x-auth-request-groups`: `sre-admins,logistics`
3. Send the request

### Method 3: Browser Extension (ModHeader)

Install the [ModHeader](https://modheader.com/) browser extension and add the SSO headers. This lets you test the frontend SPA flow locally.

### Method 4: Dual Auth Mode (Recommended)

Implement both SSO and local authentication in your app, controlled by an environment variable:

```javascript
if (process.env.AUTH_MODE === 'sso') {
  // Use SSO headers
  app.get('/api/v1/auth/sso', ssoHandler);
} else {
  // Use local login form
  app.post('/api/v1/auth/login', localLoginHandler);
}
```

Set `AUTH_MODE=local` in your local `.env` file and `AUTH_MODE=sso` in your Kubernetes deployment.

### Method 5: Docker Compose with Mock OAuth2 Proxy

Add a mock OAuth2 Proxy to your docker-compose.yml for local integration testing:

```yaml
services:
  mock-oauth2-proxy:
    image: nginx:alpine
    volumes:
      - ./dev/mock-oauth2-proxy.conf:/etc/nginx/conf.d/default.conf
    ports:
      - "8080:80"
    depends_on:
      - backend

  backend:
    build: .
    environment:
      - AUTH_MODE=sso
    ports:
      - "3000:3000"
```

```nginx
# dev/mock-oauth2-proxy.conf
server {
    listen 80;

    location / {
        proxy_pass http://backend:3000;
        proxy_set_header x-auth-request-user         "test-uuid-1234";
        proxy_set_header x-auth-request-email        "dev@example.com";
        proxy_set_header x-auth-request-preferred-username "dev";
        proxy_set_header x-auth-request-groups       "sre-admins,developers";
    }
}
```

---

## 9. Testing in Cluster

### Prerequisites

Add the following to your `/etc/hosts` (or use Cloudflare Tunnel for real DNS):

```
192.168.2.200 myapp.apps.sre.example.com
192.168.2.200 keycloak.apps.sre.example.com
192.168.2.200 dashboard.apps.sre.example.com
```

### End-to-End Test

1. **Deploy your app** via the SRE Dashboard or CLI
2. **Open your app** in a browser: `https://myapp.apps.sre.example.com`
3. **You will be redirected** to the Keycloak login page (if not already logged in)
4. **Log in** with your Keycloak credentials
5. **You will be redirected back** to your app with a valid session
6. **Verify headers** by adding a debug endpoint to your app:

```javascript
app.get('/api/debug/headers', (req, res) => {
  res.json({
    'x-auth-request-user': req.headers['x-auth-request-user'],
    'x-auth-request-email': req.headers['x-auth-request-email'],
    'x-auth-request-preferred-username': req.headers['x-auth-request-preferred-username'],
    'x-auth-request-groups': req.headers['x-auth-request-groups'],
  });
});
```

7. **Visit** `https://myapp.apps.sre.example.com/api/debug/headers` and verify the headers are populated

### Verifying with curl (After Obtaining a Session Cookie)

```bash
# Step 1: Log in via browser to get the _sre_oauth2 cookie
# (OAuth2 Proxy requires browser-based OIDC flow)

# Step 2: Extract the cookie from your browser's developer tools
# Chrome: F12 > Application > Cookies > _sre_oauth2

# Step 3: Use the cookie with curl
curl -k --cookie "_sre_oauth2=<cookie-value>" \
  https://myapp.apps.sre.example.com/api/debug/headers
```

### Verifying SSO Cookie Sharing

Because the cookie is on `.apps.sre.example.com`, logging in to any app authenticates you for all apps:

1. Log in to `https://dashboard.apps.sre.example.com`
2. In the same browser, navigate to `https://myapp.apps.sre.example.com`
3. You should NOT see a login page -- you are already authenticated

---

## 10. Nginx Configuration for Header Forwarding

If your app uses nginx as a reverse proxy (common for frontend SPAs), you must explicitly forward the SSO headers to your backend. Istio injects the headers into the request to your pod, but nginx does not automatically pass them upstream.

### Full nginx.conf Example

```nginx
# /etc/nginx/conf.d/default.conf
# SRE-compatible nginx config: no SSL (Istio handles TLS),
# forwards SSO headers, uses CoreDNS resolver.

# Use Kubernetes CoreDNS for upstream resolution
resolver 10.43.0.10 valid=30s;

upstream backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name _;

    # Frontend: serve static files
    root /usr/share/nginx/html;
    index index.html;

    # Health check (bypasses OAuth2 Proxy, no SSO headers)
    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    # API: proxy to backend with SSO headers
    location /api/ {
        proxy_pass http://backend;

        # Forward SSO identity headers
        proxy_set_header X-Auth-Request-User              $http_x_auth_request_user;
        proxy_set_header X-Auth-Request-Email             $http_x_auth_request_email;
        proxy_set_header X-Auth-Request-Preferred-Username $http_x_auth_request_preferred_username;
        proxy_set_header X-Auth-Request-Groups            $http_x_auth_request_groups;
        proxy_set_header X-Auth-Request-Access-Token      $http_x_auth_request_access_token;
        proxy_set_header Authorization                     $http_authorization;

        # Standard proxy headers
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # SPA: fallback to index.html for client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Key Points

- **Do NOT configure SSL in nginx.** Istio handles TLS termination at the gateway. Your pod receives plain HTTP on port 80.
- **Use the Kubernetes CoreDNS resolver** (`10.43.0.10` for RKE2) if you reference other services by DNS name.
- **Forward ALL `x-auth-request-*` headers** explicitly. Nginx does not pass them by default.
- **Include WebSocket upgrade headers** if your app uses WebSockets (Socket.IO, etc.).

---

## 11. Common Gotchas

### 1. x-auth-request-user Is a UUID, Not a Username

```
WRONG:  const username = req.headers['x-auth-request-user'];
RIGHT:  const username = req.headers['x-auth-request-preferred-username'];
        const userId   = req.headers['x-auth-request-user'];  // UUID
```

The `x-auth-request-user` header contains the Keycloak `sub` claim, which is a UUID like `f47ac10b-58cc-4372-a567-0e02b2c3d479`. Use `x-auth-request-preferred-username` for the human-readable name.

### 2. Email Uniqueness Constraints

If your app uses email as a unique key for users, be aware that:
- Keycloak enforces email uniqueness within a realm, but...
- Users can change their email in Keycloak, so your `ON CONFLICT` should be on `sso_id`, not `email`
- Use `sso_id` (the UUID from `x-auth-request-user`) as the stable unique identifier

### 3. Health Endpoints Get No Headers

Health check paths (`/healthz`, `/health`, `/ready`) are excluded from OAuth2 Proxy's ext-authz rule. Requests to these paths will NOT have `x-auth-request-*` headers. Do not require authentication on health endpoints.

```javascript
// WRONG: health check will always fail because no SSO headers
app.get('/healthz', ssoMiddleware, (req, res) => { ... });

// RIGHT: health check bypasses auth
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

### 4. Istio Header Propagation Through Nginx

If your pod runs nginx in front of a backend, the SSO headers arrive at nginx (injected by Istio sidecar) but are NOT automatically forwarded to your backend. You must explicitly set `proxy_set_header` for each header. See [Section 10](#10-nginx-configuration-for-header-forwarding).

### 5. Groups Header Is a Simple Comma-Separated String

```javascript
// WRONG: groups header is not JSON
const groups = JSON.parse(req.headers['x-auth-request-groups']);

// RIGHT: split on comma
const groups = (req.headers['x-auth-request-groups'] || '').split(',').filter(Boolean);
```

### 6. No SSO Headers on WebSocket Upgrade

The initial WebSocket handshake will have SSO headers, but subsequent WebSocket frames do not carry HTTP headers. Authenticate the user during the handshake:

```javascript
const io = require('socket.io')(server);

io.use((socket, next) => {
  // Headers are available on the handshake request
  const user = socket.handshake.headers['x-auth-request-preferred-username'];
  if (!user) {
    return next(new Error('Not authenticated'));
  }
  socket.user = user;
  next();
});
```

### 7. CORS is Not an Issue on the Platform

Because your frontend and API are served from the same domain (`myapp.apps.sre.example.com`), CORS is not a concern. Do not add `Access-Control-Allow-Origin: *` -- it is unnecessary and weakens security.

### 8. Cookie Domain Mismatch After Domain Change

If the platform domain changes from `apps.sre.example.com` to a new domain, users will need to clear their old `_sre_oauth2` cookies. The platform admin handles updating the OAuth2 Proxy cookie domain.

### 9. Redirect URL After Login

After Keycloak authentication, OAuth2 Proxy redirects the user back to the URL they originally requested. If your app does client-side routing (SPA), the redirect will land on the correct page automatically.

### 10. Testing Behind VPN or Firewall

If accessing the cluster via VPN, ensure your DNS resolves `*.apps.sre.example.com` to the MetalLB IP `192.168.2.200`. If using `/etc/hosts`, you need an entry for each hostname.

---

## 12. Troubleshooting

### User Gets Redirect Loop

**Symptom**: Browser shows "too many redirects" when accessing the app.

**Causes**:
1. OAuth2 Proxy cannot reach Keycloak (check `redeem-url` and `validate-url`)
2. Cookie domain mismatch (cookie is on `.apps.sre.example.com` but app is on a different domain)
3. App responds with 401/403, triggering re-authentication

**Fix**: Check OAuth2 Proxy logs:
```bash
kubectl logs -n oauth2-proxy deploy/oauth2-proxy -f
```

### Headers Are Empty

**Symptom**: `x-auth-request-*` headers are undefined/null in your app.

**Causes**:
1. OAuth2 Proxy ext-authz is not configured for your app's host
2. Nginx is not forwarding headers (see Section 10)
3. Your app's host is in the `notHosts` exclusion list in the AuthorizationPolicy
4. Health check path is being hit (excluded from ext-authz)

**Fix**: Verify the ext-authz policy includes your host:
```bash
kubectl get authorizationpolicy ext-authz-oauth2 -n istio-system -o yaml
```

### Groups Header Is Empty

**Symptom**: `x-auth-request-groups` is empty even though the user is in Keycloak groups.

**Causes**:
1. Missing groups protocol mapper on the Keycloak client (see Section 7)
2. OAuth2 Proxy not requesting `groups` scope
3. "Full group path" is ON (sending `/groupname` instead of `groupname`)

**Fix**: Check the Keycloak client mapper configuration and verify the OIDC token contains groups (see Section 7).

### 403 Forbidden After Authentication

**Symptom**: User authenticates successfully but gets 403 from the app.

**Causes**:
1. User is not in the required Keycloak group
2. App's group-to-role mapping does not recognize the user's groups
3. Istio AuthorizationPolicy is blocking the request

**Fix**: Check what groups the user actually has:
```bash
curl -H "x-auth-request-user: <user-uuid>" \
     -H "x-auth-request-groups: <groups>" \
     http://localhost:8080/api/debug/headers
```

---

## 13. Reference: Full Auth Chain Configuration

For platform operators, here are the exact files that make up the SSO auth chain:

### Istio Gateway
**File**: `platform/core/istio-config/gateway.yaml`
- Accepts HTTPS traffic on `*.apps.sre.example.com`
- TLS termination using `sre-wildcard-tls` certificate

### ext-authz AuthorizationPolicy
**File**: `platform/core/istio-config/ext-authz/authorization-policy.yaml`
- Sends all traffic (except excluded paths/hosts) to OAuth2 Proxy for authentication
- Excluded hosts: Keycloak, Harbor, NeuVector
- Excluded paths: `/healthz`, `/health`, `/ready`, `/oauth2/*`

### OAuth2 Proxy Deployment
**File**: `platform/core/oauth2-proxy/deployment.yaml`
- Provider: `keycloak-oidc`
- Cookie: `_sre_oauth2` on `.apps.sre.example.com`
- Sets `x-auth-request-*` headers via `--set-xauthrequest=true`
- Passes access token via `--pass-access-token=true`

### OAuth2 Proxy VirtualService
**File**: `platform/core/oauth2-proxy/virtualservice.yaml`
- Routes `/oauth2/*` paths on all service hosts to OAuth2 Proxy
- Ensures the sign-in redirect works from any app

### Keycloak
**File**: `platform/addons/keycloak/helmrelease.yaml`
- OIDC provider for OAuth2 Proxy
- Realm: `sre`
- Client: `oauth2-proxy`

### Wildcard TLS Certificate
**File**: `platform/core/cert-manager-config/certificate-gateway.yaml`
- cert-manager Certificate for `*.apps.sre.example.com`
- Referenced by the Istio Gateway as `credentialName: sre-wildcard-tls`

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│  SRE SSO Quick Reference                                │
│                                                         │
│  Cookie:    _sre_oauth2 on .apps.sre.example.com        │
│  Provider:  Keycloak (realm: sre)                       │
│  Proxy:     OAuth2 Proxy v7.7.1                         │
│                                                         │
│  Headers:                                               │
│    x-auth-request-user               → UUID (not name!) │
│    x-auth-request-email              → email            │
│    x-auth-request-preferred-username → username          │
│    x-auth-request-groups             → csv groups       │
│    x-auth-request-access-token       → OIDC JWT         │
│                                                         │
│  Health endpoints:                                      │
│    /healthz, /health, /ready → NO SSO headers           │
│                                                         │
│  Test locally:                                          │
│    curl -H "x-auth-request-email: me@x.com" localhost   │
│                                                         │
│  Groups parsing:                                        │
│    groups.split(',').filter(Boolean)                     │
│                                                         │
│  Keycloak admin:                                        │
│    https://keycloak.apps.sre.example.com/admin           │
│    admin / 03F2tLffxi                                   │
└─────────────────────────────────────────────────────────┘
```
