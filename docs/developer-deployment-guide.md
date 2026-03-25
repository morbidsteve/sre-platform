> **Quick navigation:** This guide covers the Deploy from Git feature specifically.
> For all deployment methods, see [Developer Guide](developer-guide.md).
> For first-time setup, see [Getting Started](getting-started-developer.md).

# Developer Deployment Guide — Deploy from Git on SRE

This guide walks you through deploying an application to the SRE Platform using the **Deploy from Git** feature. You give the platform a Git URL, and it handles the rest: building images, creating Kubernetes resources, setting up networking, and securing everything with Istio mTLS.

**Audience:** Application developers who have a Docker Compose, Dockerfile, Helm chart, or Kustomize project in a Git repository.

**Platform dashboard:** `https://dashboard.apps.sre.example.com`

---

## Table of Contents

1. [How Deploy from Git Works](#how-deploy-from-git-works)
2. [What the Platform Does for You](#what-the-platform-does-for-you)
3. [Container Security Requirements](#container-security-requirements)
4. [Docker Compose Compatibility](#docker-compose-compatibility)
5. [Dockerfile Best Practices](#dockerfile-best-practices)
6. [Nginx and Frontend Services](#nginx-and-frontend-services)
7. [Databases and Redis](#databases-and-redis)
8. [Health Checks](#health-checks)
9. [Ingress and DNS](#ingress-and-dns)
10. [Example: Making a Compose App SRE-Ready](#example-making-a-compose-app-sre-ready)
11. [Troubleshooting](#troubleshooting)
12. [SRE Readiness Checklist](#sre-readiness-checklist)

---

## How Deploy from Git Works

1. Open the dashboard at `https://dashboard.apps.sre.example.com`.
2. Navigate to **Deploy from Git**.
3. Enter your **Git URL**, **app name**, and **team name**.
4. Click **Deploy**.

The platform takes it from there:

```
Git URL
  |
  v
Clone repo --> Detect project type (Compose, Helm, Dockerfile, Kustomize)
  |
  v
For Docker Compose projects:
  - Platform services (postgres, redis) --> deployed as managed instances
  - App services with build: context --> built via Kaniko (in-cluster builds)
  - Images pushed to Harbor registry (harbor.apps.sre.example.com/<team>/<app>:<tag>)
  - Services sharing a build context reuse the same image
  - Profiled services (demo, monitoring, backup, debug, test) are skipped
  |
  v
HelmReleases auto-created --> Flux deploys to Kubernetes
  |
  v
Service name aliases created (compose service names resolve in-cluster)
  |
  v
Istio mTLS + network policies + ingress applied automatically
```

You do not need to write Helm charts, Kubernetes manifests, or CI/CD pipelines. The platform generates everything.

![Deploy from Git form with fields for Git URL, branch, app name, and team name](images/dashboard-deploy-from-git.png)

![Deploy from Git form filled in with a Keystone application repository and team details](images/dashboard-deploy-form-filled.png)

---

## What the Platform Does for You

When your app is deployed, the platform automatically provides:

- **Istio mTLS** -- all service-to-service traffic is encrypted without any app changes
- **Network policies** -- default-deny with explicit allows for your services
- **Ingress** -- the "frontend" or "web" service gets an external URL at `https://<app-name>.apps.sre.example.com`
- **Harbor registry** -- images are built and stored in the internal registry
- **DNS aliases** -- compose service names (like `backend`, `db`, `redis`) resolve inside the cluster
- **Managed databases** -- PostgreSQL and Redis are auto-deployed when detected in your compose file

---

## Container Security Requirements

The SRE Platform enforces strict security policies via Kyverno. Your containers must comply with these rules, or they will be rejected at admission time.

### Non-root execution (mandatory)

Containers must run as a non-root user. Add this to your Dockerfile:

```dockerfile
# Use a numeric UID (preferred for Kyverno compatibility)
USER 1000

# Or use a named user that exists in the base image
USER node
USER nobody
USER nginx
```

### Read-only root filesystem (mandatory)

The root filesystem is mounted read-only. If your app needs to write temporary files, logs, or cache data, you have two options:

**Option A: Write to a tmpfs-backed directory.** The platform mounts writable tmpfs volumes for common paths. Configure your app to write to `/tmp` or a similar directory.

**Option B: Create writable directories at build time.** Set up writable directories owned by your non-root user in the Dockerfile:

```dockerfile
RUN mkdir -p /app/tmp /app/cache && chown 1000:1000 /app/tmp /app/cache
```

### Dropped capabilities (mandatory)

All Linux capabilities are dropped. Your app cannot:

- Bind to privileged ports (below 1024) -- use 8080, 3000, or another high port
- Modify network settings
- Use raw sockets
- Change file ownership at runtime

### No privilege escalation (mandatory)

The `allowPrivilegeEscalation` flag is set to `false`. Processes cannot gain more privileges than their parent.

### Resource limits (mandatory)

Every container must have CPU and memory requests and limits. The platform sets sensible defaults, but you can override them via the dashboard.

---

## Docker Compose Compatibility

The platform reads your `docker-compose.yml` (or `docker-compose.yaml`) from the repository root. Here is what is supported and what is ignored.

### Supported

| Compose feature | Platform behavior |
|---|---|
| `build:` with context/dockerfile | Built via Kaniko, pushed to Harbor |
| `image:` (pre-built) | Deployed directly |
| `environment:` / `env_file:` | Passed through as container environment variables |
| `ports:` | The container port (right side of `host:container`) is used |
| `command:` / `entrypoint:` | Passed through |
| `profiles:` | Services with `demo`, `monitoring`, `backup`, `debug`, or `test` profiles are skipped |

### Ignored (Kubernetes equivalents used instead)

| Compose feature | Why it is ignored |
|---|---|
| `depends_on:` | Kubernetes handles pod scheduling; use readiness probes instead |
| `volumes:` (host mounts) | No host filesystem access; use emptyDir/tmpfs or PVCs |
| `networks:` | Istio and NetworkPolicies handle networking |
| `restart:` | Kubernetes restart policies apply |
| `privileged:` | Not allowed by Kyverno policies |

### Services with shared build contexts

If multiple services in your compose file share the same `build.context` and `build.dockerfile`, the platform builds the image once and reuses it. This saves build time and registry storage.

### Pre-built images

Services that specify only `image:` (no `build:` directive) are deployed directly. The image must be accessible from within the cluster.

---

## Dockerfile Best Practices

Follow these practices to ensure your images build and run successfully on SRE.

### Use multi-stage builds

Keep your images small and free of build tools:

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1000 appgroup && adduser -u 1000 -G appgroup -D appuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER 1000
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Run as non-root

Always include a `USER` instruction. Do not rely on the base image default:

```dockerfile
# For Node.js
USER node

# For Python
RUN useradd -m -u 1000 appuser
USER appuser

# For Go (scratch/distroless)
USER 1000:1000

# For generic images
USER nobody
```

### Declare ports with EXPOSE

The platform reads `EXPOSE` directives to configure service ports:

```dockerfile
EXPOSE 8080
```

### Do not hardcode localhost

Your app will talk to other services by their compose service name, not `localhost`. Use environment variables or DNS names:

```dockerfile
# Wrong
ENV DATABASE_URL=postgres://localhost:5432/mydb

# Right -- use the compose service name
ENV DATABASE_URL=postgres://db:5432/mydb
```

### Do not include SSL/TLS

Istio handles all TLS termination and mTLS between services. Remove any TLS configuration from your application:

- Do not bundle SSL certificates in your image
- Do not configure HTTPS listeners
- Do not set `ssl_certificate` in nginx configs

### No :latest tags

The platform does not allow `:latest` image tags. All images built by the platform are tagged with a specific identifier. If you reference external images in your compose file, pin them to a specific version:

```yaml
# Wrong
image: postgres:latest

# Right
image: postgres:16.2-alpine
```

---

## Nginx and Frontend Services

Nginx-based frontends are common but need specific adjustments for SRE.

### Listen on a non-privileged port

Since containers run as non-root, nginx cannot bind to port 80. Use port 8080 instead:

```nginx
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Remove all SSL/TLS configuration

Istio terminates TLS at the gateway. Your nginx config should be plain HTTP only:

```nginx
# Remove these lines if present:
#   listen 443 ssl;
#   ssl_certificate /etc/nginx/ssl/cert.pem;
#   ssl_certificate_key /etc/nginx/ssl/key.pem;
#   ssl_protocols TLSv1.2 TLSv1.3;
```

### Handle writable directories

Nginx needs to write to `/var/cache/nginx`, `/var/run`, and `/tmp` at runtime. Since the root filesystem is read-only, handle this in your Dockerfile:

```dockerfile
FROM nginx:1.25-alpine

# Create writable directories owned by non-root user
RUN mkdir -p /var/cache/nginx /var/run /tmp && \
    chown -R 101:101 /var/cache/nginx /var/run /tmp && \
    chmod -R 755 /var/cache/nginx /var/run /tmp

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom config (listen on 8080, no SSL)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Write PID file to /tmp instead of /var/run
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf

USER 101
EXPOSE 8080
```

### Proxy to backend services

Reference backend services by their compose service name. The platform creates DNS aliases so these names resolve:

```nginx
location /api/ {
    proxy_pass http://backend:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

In this example, `backend` is the name of another service in your `docker-compose.yml`.

---

## Databases and Redis

### Automatic provisioning

When the platform detects `postgres` or `redis` images in your compose file, it deploys managed instances automatically. You do not need to provide Dockerfiles for these services.

### Connection strings

Use the compose service name as the hostname. The platform creates DNS aliases:

```bash
# PostgreSQL
DATABASE_URL=postgres://myapp:changeme@db:5432/myapp

# Redis
REDIS_URL=redis://redis:6379
```

### Default PostgreSQL credentials

The platform sets up PostgreSQL with these defaults:

| Setting | Value |
|---|---|
| Database name | App name with hyphens replaced by underscores (e.g., `my-app` becomes `my_app`) |
| Username | Same as database name |
| Password | `changeme` |
| Host | The compose service name for the postgres service (usually `db` or `postgres`) |
| Port | `5432` |

### Production credentials

For production deployments, do not use the default `changeme` password. Use OpenBao (the platform's secrets manager) with External Secrets Operator to inject credentials:

1. Store credentials in OpenBao at `sre/<team>/<app>/db`
2. Create an ExternalSecret resource referencing the OpenBao path
3. Reference the Kubernetes Secret in your deployment environment variables

Your platform administrator can help set this up.

---

## Health Checks

### Why they matter

The platform uses health checks to determine when your app is ready to receive traffic and whether it needs to be restarted. Without proper health endpoints, your app may receive traffic before it is ready or may not be restarted when it hangs.

### What to implement

Expose at least one health endpoint:

```
GET /health    -- returns 200 when the app is alive
GET /healthz   -- alternative path
GET /readyz    -- returns 200 when the app is ready to serve traffic
```

A minimal implementation in Node.js:

```javascript
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

A minimal implementation in Go:

```go
http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status":"ok"}`))
})
```

### Default behavior

If your app does not expose a health endpoint, the platform configures probes against `/` on your container port. This works if your app returns a 200 at the root path. If it does not (for example, if it returns a redirect or 404), configure a custom health path via the dashboard.

---

## Ingress and DNS

### Automatic ingress

The platform automatically creates external ingress for the service named `frontend`, `web`, or the first service with an exposed HTTP port. Your app is accessible at:

```
https://<app-name>.apps.sre.example.com
```

All traffic passes through the Istio gateway with TLS termination and mTLS.

### Internal service communication

Services within the same app communicate using their compose service names. For example, if your compose file has services named `frontend`, `backend`, and `worker`:

- `frontend` can reach `backend` at `http://backend:3000`
- `backend` can reach `worker` at `http://worker:8080`
- External users reach `frontend` at `https://<app-name>.apps.sre.example.com`

---

## Example: Making a Compose App SRE-Ready

Here is a typical Docker Compose application and the changes needed to run on SRE.

### Before: A standard compose app

```yaml
# docker-compose.yml
version: "3.8"
services:
  frontend:
    build: ./frontend
    ports:
      - "443:443"
    volumes:
      - ./certs:/etc/nginx/ssl:ro
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://admin:supersecret@db:5432/myapp
    volumes:
      - ./data:/app/data
    depends_on:
      - db

  db:
    image: postgres:latest
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: supersecret
      POSTGRES_DB: myapp
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```dockerfile
# frontend/Dockerfile
FROM node:20 AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM nginx:latest
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY certs/ /etc/nginx/ssl/
EXPOSE 443
```

```nginx
# frontend/nginx.conf
server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    root /usr/share/nginx/html;

    location /api/ {
        proxy_pass http://backend:3000/;
    }
}
```

```dockerfile
# backend/Dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm ci
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### Problems with this setup

1. **Nginx listens on port 443 with SSL** -- Istio handles TLS; this will conflict
2. **SSL certificates bundled in the image** -- unnecessary and a security concern
3. **Runs as root** -- both containers run as root by default, violating Kyverno policies
4. **Host volume mounts** -- `./certs` and `./data` mounts will not work in Kubernetes
5. **`:latest` image tags** -- not allowed by platform policy
6. **Hardcoded secrets** -- `supersecret` password in plain text

### After: SRE-ready

```yaml
# docker-compose.yml
services:
  frontend:
    build: ./frontend
    ports:
      - "8080:8080"

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://myapp:changeme@db:5432/myapp

  db:
    image: postgres:16.2-alpine
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: myapp
```

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.25-alpine

# Set up writable directories for non-root nginx
RUN mkdir -p /var/cache/nginx/client_temp /var/run /tmp && \
    chown -R 101:101 /var/cache/nginx /var/run /tmp && \
    sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080
```

```nginx
# frontend/nginx.conf
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
RUN mkdir -p /app/tmp && chown -R 1000:1000 /app/tmp
USER 1000
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### What changed

| Change | Why |
|---|---|
| Removed `version: "3.8"` | Deprecated in modern Docker Compose |
| Removed `depends_on` | Kubernetes manages scheduling; use readiness probes |
| Removed host volume mounts | Not supported in Kubernetes; use tmpfs for writable dirs |
| Removed SSL certs and config | Istio handles TLS termination |
| Changed nginx to listen on 8080 | Non-root cannot bind to ports below 1024 |
| Added `USER 101` to frontend | Runs nginx as non-root |
| Added `USER 1000` to backend | Runs Node.js as non-root |
| Used multi-stage builds | Smaller images, no dev dependencies in production |
| Pinned postgres to `16.2-alpine` | `:latest` tags are not allowed |
| Changed to `changeme` password | Platform default; use OpenBao for production |
| Created writable dirs with correct ownership | Read-only root filesystem requires pre-created writable paths |

---

## Troubleshooting

See the [Troubleshooting Guide](troubleshooting.md) for solutions to common issues.

---

## SRE Readiness Checklist

Run through this checklist before deploying. Every item must pass for your app to deploy successfully.

### Container security

- [ ] All Dockerfiles include a `USER` instruction with a non-root user (UID >= 1000, or a named non-root user like `node`, `nobody`)
- [ ] No `USER root` after the final build stage
- [ ] No commands that require privileged ports (below 1024)
- [ ] No commands that require Linux capabilities (raw sockets, chown at runtime, etc.)

### Filesystem

- [ ] App does not write to the root filesystem at runtime (use `/tmp` or pre-created writable directories)
- [ ] Writable directories are created in the Dockerfile with correct ownership (`chown <uid>:<gid>`)
- [ ] No host volume mounts in docker-compose.yml

### Networking

- [ ] App listens on a non-privileged port (8080, 3000, etc., not 80 or 443)
- [ ] No SSL/TLS configuration in the app or nginx (Istio handles TLS)
- [ ] No hardcoded `localhost` or `127.0.0.1` URLs for service-to-service calls
- [ ] Backend services are referenced by compose service name (e.g., `backend`, `api`, `db`)

### Images

- [ ] All base images use pinned versions (no `:latest`)
- [ ] Multi-stage builds used to minimize image size
- [ ] No secrets, credentials, or certificates baked into the image
- [ ] `EXPOSE` directive declares the container port

### Docker Compose

- [ ] `docker-compose.yml` or `docker-compose.yaml` at the repository root
- [ ] Services that need building have a `build:` directive with context and dockerfile
- [ ] No host volume mounts (`./something:/container/path`)
- [ ] Environment variables use placeholder credentials (not production secrets)
- [ ] Services intended for local-only use are placed under a `demo`, `debug`, or `test` profile

### Health

- [ ] App exposes a health check endpoint (`/health`, `/healthz`, or returns 200 at `/`)
- [ ] Health endpoint responds within 5 seconds

### Secrets

- [ ] No hardcoded passwords, API keys, or tokens in the codebase
- [ ] Default credentials use `changeme` as a placeholder
- [ ] Production credentials will be injected via OpenBao / External Secrets

---

## Next Steps

- **Deploy your app:** Open `https://dashboard.apps.sre.example.com` and use Deploy from Git.
- **Monitor your app:** After deployment, check the dashboard Overview tab for pod status, logs, and health.

![Dashboard Overview tab showing platform health with Components, Nodes, and Problem Pods](images/dashboard-overview.png)
- **Set up production secrets:** Work with your platform administrator to configure OpenBao secrets for production credentials.
- **Read the full developer guide:** See [developer-guide.md](developer-guide.md) for CLI-based deployment, Helm chart templates, and advanced configuration.
