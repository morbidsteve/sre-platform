# SRE Platform Compatibility Guide

This guide covers everything you need to know to deploy an application on the SRE platform. It explains what the platform enforces, how to work within those constraints, and how to override them when necessary.

---

## Quick Compatibility Checklist

Before deploying, verify your application meets these requirements:

1. **Container image in Harbor** -- Push your image to `harbor.apps.sre.example.com/<team>/<app>:<tag>`. Public registry images are not allowed directly.
2. **Pinned image tag** -- Use a specific version (`v1.0.0`, `sha256:abc123`). The `:latest` tag is blocked by Kyverno.
3. **Listens on a port** -- Know which port your app listens on. Default is 8080.
4. **Non-root preferred** -- Apps that run as non-root deploy with zero overrides. Root apps need `--run-as-root` and get a PolicyException.
5. **Health endpoint** -- Provide a liveness path (default `/`). Apps without a responding health endpoint will be killed by Kubernetes.
6. **No host filesystem access** -- Host path mounts are blocked. Use `--persist` for persistent storage.
7. **No privileged mode** -- Privileged containers are blocked. Specific capabilities can be added with `--add-capability`.
8. **Stateless or declare persistence** -- If your app writes data that must survive restarts, use `--persist /path:size`.

If your app passes all 8 items with no overrides needed, it is fully SRE-compatible and deploys with a single command.

---

## Three Deployment Paths

### Path 1: CLI Deploy Script (Recommended)

The fastest path. One command generates all manifests, commits, and pushes to Git. Flux deploys automatically.

```bash
./scripts/sre-deploy-app.sh \
  --name my-app --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/my-app --tag v1.0.0 \
  --port 8080 --ingress my-app.apps.sre.example.com
```

Use `--no-commit` to generate files without committing (useful for review).

### Path 2: DSOP Wizard (Web UI)

Open the DSOP Wizard at `https://dsop-wizard.apps.sre.example.com`. The wizard walks you through image selection, security scanning, and deployment configuration with a graphical interface. It runs the same pipeline as the CLI but with guided steps.

### Path 3: GitOps Manual (Advanced)

Write an App Contract YAML file and generate the HelmRelease manually:

```bash
task deploy-app -- apps/contracts/my-app.yaml
git add apps/contracts/ apps/tenants/
git commit -m "feat(team-alpha): deploy my-app v1.0.0"
git push
```

See [app-contract.md](app-contract.md) for the full contract schema.

---

## Common Deployment Patterns

### Pattern 1: Simple Web App (Stateless)

The baseline case. No persistence, no root, no special capabilities.

```bash
./scripts/sre-deploy-app.sh \
  --name go-httpbin --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/go-httpbin --tag v2.14.0 \
  --port 8080 \
  --ingress go-httpbin.apps.sre.example.com
```

This was validated in Round 4 testing. The app deploys with 2/2 pods (app + Istio sidecar), responds on all endpoints, and requires zero security overrides.

### Pattern 2: App with Database (PostgreSQL + Redis)

Deploy the app with environment variables pointing to database services in the same namespace.

```bash
# Deploy PostgreSQL first
./scripts/sre-deploy-app.sh \
  --name myapp-db --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/postgres --tag 16.2 \
  --port 5432 --chart worker \
  --run-as-root --writable-root \
  --persist /var/lib/postgresql/data:10Gi \
  --env "POSTGRES_DB=myapp" \
  --env "POSTGRES_USER=myapp" \
  --env "POSTGRES_PASSWORD=secret:myapp-db-pass" \
  --no-commit

# Deploy Redis
./scripts/sre-deploy-app.sh \
  --name myapp-redis --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/redis --tag 7.2 \
  --port 6379 --chart worker \
  --persist /data:2Gi \
  --no-commit

# Deploy the app
./scripts/sre-deploy-app.sh \
  --name myapp --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/myapp --tag v2.1.0 \
  --port 3000 \
  --ingress myapp.apps.sre.example.com \
  --env "DATABASE_URL=postgresql://myapp:changeme@myapp-db:5432/myapp" \
  --env "REDIS_URL=redis://myapp-redis:6379" \
  --no-commit

# Commit everything at once
cd /home/fscyber/sre/sre-platform
git add apps/tenants/team-alpha/
git commit -m "feat(team-alpha): deploy myapp with PostgreSQL and Redis"
git push
```

Services in the same namespace can reach each other by name (e.g., `myapp-db:5432`) because the baseline NetworkPolicies allow same-namespace communication.

### Pattern 3: Multi-Service Architecture (Bulk Deploy)

Deploy many services at once using `--no-commit` and a single commit at the end. This pattern was validated in Round 2 with the Sock Shop microservices (13 services).

```bash
TEAM="team-alpha"
for svc in front-end catalogue carts orders shipping payment user queue-master; do
  ./scripts/sre-deploy-app.sh \
    --name "$svc" --team "$TEAM" \
    --image "harbor.apps.sre.example.com/$TEAM/$svc" --tag v0.3.12 \
    --port 8080 --no-commit
done

git add "apps/tenants/$TEAM/"
git commit -m "feat($TEAM): deploy sock-shop microservices"
git push
```

### Pattern 4: App Requiring Root (Uptime Kuma)

Some applications must run as root. Use `--run-as-root` which automatically generates a Kyverno PolicyException for the namespace.

```bash
./scripts/sre-deploy-app.sh \
  --name uptime-kuma --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/uptime-kuma --tag 1.23.15 \
  --port 3001 \
  --ingress uptime-kuma.apps.sre.example.com \
  --run-as-root --writable-root \
  --add-capability SETGID --add-capability SETUID \
  --persist /app/data:5Gi
```

This was validated in Round 4. Key findings:
- Uptime Kuma needs `SETGID` and `SETUID` capabilities for its `setpriv` calls.
- The persist path must match where the app actually writes data.
- The `--run-as-root` flag creates a PolicyException so Kyverno does not block the pod.

### Pattern 5: App with Persistent Data (Gitea)

Apps with multiple data directories need multiple `--persist` flags.

```bash
./scripts/sre-deploy-app.sh \
  --name gitea --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/gitea --tag 1.22.6-rootless \
  --port 3000 \
  --ingress gitea.apps.sre.example.com \
  --persist /var/lib/gitea:10Gi \
  --persist /etc/gitea:1Gi \
  --startup-probe /api/healthz \
  --liveness /api/healthz \
  --readiness /api/healthz
```

This was validated in Round 4. The rootless variant avoids the need for `--run-as-root`. The startup probe gives Gitea time to initialize its database before liveness checks begin.

### Pattern 6: Worker with Custom Command

Override the container entrypoint and arguments for background workers or custom startup sequences.

```bash
./scripts/sre-deploy-app.sh \
  --name data-processor --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/data-processor --tag v3.0.0 \
  --chart worker \
  --command "/app/processor" \
  --args "--queue=high-priority --workers=4" \
  --singleton \
  --persist /app/state:5Gi \
  --env "QUEUE_URL=redis://myapp-redis:6379" \
  --no-commit
```

The `--singleton` flag sets exactly 1 replica (disables HPA) for workers that must not run concurrently. The `--chart worker` type generates no Service and no ingress.

---

## Security Context Requirements

### What the Platform Enforces

The SRE platform applies these security constraints to every pod by default:

| Constraint | Default | Kyverno Policy |
|-----------|---------|----------------|
| Run as non-root | Required | `require-security-context` (Enforce) |
| Read-only root filesystem | Enabled | `require-security-context` (Enforce) |
| Privilege escalation | Blocked | `disallow-privilege-escalation` (Enforce) |
| Capabilities | All dropped | `require-security-context` (Enforce) |
| Host namespaces | Blocked | `disallow-host-namespaces` (Enforce) |
| Host path mounts | Blocked | `restrict-host-path-mount` (Enforce) |
| Image from Harbor only | Required | `restrict-image-registries` (Enforce) |
| Image signed with Cosign | Required | `verify-image-signatures` (Enforce) |

### How to Override

Each constraint can be relaxed per-deployment using deploy script flags:

| Override | Flag | What It Does |
|----------|------|-------------|
| Run as root | `--run-as-root` | Sets `runAsUser: 0`, creates PolicyException |
| Writable filesystem | `--writable-root` | Disables `readOnlyRootFilesystem` |
| Add capability | `--add-capability CAP` | Adds specific Linux capability (repeatable) |

Every override is logged with an `sre.io/security-exception` annotation on the deployment. Platform operators can audit all exceptions across the cluster.

### PolicyExceptions

When `--run-as-root` is used, the deploy script automatically generates a Kyverno PolicyException resource that exempts the specific deployment from the `require-security-context` and `disallow-privilege-escalation` policies. You do not need to create PolicyExceptions manually.

---

## Authentication

### All Apps Are Behind SSO

Every app deployed through the Istio gateway is automatically protected by Keycloak SSO via OAuth2 Proxy. Users are redirected to sign in before accessing any app. One login covers all apps on the platform.

### Identity Headers

After authentication, your app receives these headers on every request:

| Header | Value |
|--------|-------|
| `x-auth-request-user` | Authenticated username |
| `x-auth-request-email` | Authenticated email |
| `x-auth-request-groups` | Keycloak group memberships (comma-separated) |
| `x-auth-request-access-token` | OAuth2 access token |

### Exempt Paths

These paths bypass SSO (no login required) so Kubernetes probes and Prometheus work:

- `/healthz`, `/health`, `/ready`, `/readyz`, `/livez`, `/metrics`

### Reading Identity in Your App

```javascript
// Node.js / Express
app.get('/api/whoami', (req, res) => {
  res.json({
    user: req.headers['x-auth-request-user'],
    email: req.headers['x-auth-request-email'],
    groups: (req.headers['x-auth-request-groups'] || '').split(','),
  });
});
```

```python
# Python / Flask
@app.route('/api/whoami')
def whoami():
    return {
        'user': request.headers.get('X-Auth-Request-User'),
        'email': request.headers.get('X-Auth-Request-Email'),
        'groups': request.headers.get('X-Auth-Request-Groups', '').split(','),
    }
```

---

## Networking

### Istio mTLS

All pod-to-pod communication is encrypted with Istio mutual TLS (STRICT mode). You do not need to configure TLS in your application. Istio handles it transparently via sidecar proxies.

### Default-Deny NetworkPolicy

Every tenant namespace starts with a default-deny NetworkPolicy. The following traffic is allowed by baseline policies:

- **DNS** -- Pods can resolve service names (kube-system UDP/TCP 53)
- **Same namespace** -- Pods in the same namespace can communicate freely
- **Istio control plane** -- Sidecar to istiod (ports 15012, 15014)
- **Monitoring** -- Prometheus scraping from the monitoring namespace
- **Istio gateway** -- Inbound traffic from the ingress gateway
- **HTTPS egress** -- Outbound HTTPS (TCP 443) to any IP

### Ingress

External access is provided by the Istio ingress gateway. Use the `--ingress` flag to assign a hostname:

```bash
--ingress myapp.apps.sre.example.com
```

The deploy script creates a VirtualService that routes traffic from the gateway to your service. TLS termination happens at the gateway.

### Service-to-Service Communication

Services in the same namespace are reachable by name: `http://service-name:port`. Services in different namespaces require `http://service-name.namespace.svc:port` and may need additional NetworkPolicy rules.

---

## Monitoring

### Enabling Prometheus Metrics

Add the `--metrics` flag to your deploy command:

```bash
--metrics
```

This creates a ServiceMonitor that scrapes your app's `/metrics` endpoint every 30 seconds. Metrics appear automatically in Grafana.

### Custom Metrics Endpoint

If your app exposes metrics on a different path, configure it in the Helm values:

```yaml
serviceMonitor:
  enabled: true
  path: /custom-metrics
  interval: 15s
```

### Grafana Dashboards

Platform dashboards are available at `https://grafana.apps.sre.example.com`. Pre-built dashboards cover cluster health, namespace resource usage, Istio traffic, Kyverno violations, and NeuVector alerts.

---

## Troubleshooting

### Pod Won't Start (CrashLoopBackOff)

**Check pod logs:**
```bash
kubectl logs -n team-alpha deploy/my-app -c my-app
```

**Common causes:**
- App writes to filesystem but `--writable-root` was not set. Error: `Read-only file system`.
- App runs as root but `--run-as-root` was not set. Error: `Permission denied` or Kyverno admission rejection.
- App needs capabilities (SETGID, SETUID, NET_BIND_SERVICE). Error: `Operation not permitted`.
- Health probe path is wrong. Pod starts but Kubernetes kills it because the liveness check fails.

**Fix:** Redeploy with the correct flags. The deploy script overwrites the previous manifest.

### 404 Not Found

**Check the VirtualService:**
```bash
kubectl get virtualservice -n team-alpha
```

**Common causes:**
- Ingress hostname does not match the `--ingress` value.
- DNS is not configured for the hostname. Add it to your local `/etc/hosts` or configure DNS.
- The app listens on a different port than what was specified with `--port`.

### SSO Redirect Loop or 403

**Common causes:**
- The OAuth2 Proxy cookie domain does not cover the hostname. All apps should use `*.apps.sre.example.com`.
- The VirtualService is missing the `/oauth2/` prefix routes. Redeploy to regenerate the VirtualService.
- Keycloak is down. Check: `kubectl get pods -n keycloak`.

### Permission Denied (Filesystem)

The read-only root filesystem blocks writes to any path inside the container. Options:

1. **`--writable-root`** -- Disables read-only root entirely. Simplest fix.
2. **`--persist /path:size`** -- Mounts a writable PVC at a specific path. Better for data that must survive restarts.
3. **`--extra-volume name:/path`** -- Mounts an emptyDir (ephemeral) volume. Good for temp/cache directories.

### Image Pull Errors (ImagePullBackOff)

```bash
kubectl describe pod -n team-alpha my-app-xxx
```

**Common causes:**
- Image not pushed to Harbor. Push it: `docker push harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0`.
- Harbor project does not exist. Create it in Harbor UI or API.
- Missing `imagePullSecrets`. The deploy script may not add these automatically -- patch the deployment:

```bash
kubectl patch deployment my-app -n team-alpha \
  -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"harbor-pull-secret"}]}}}}'
```

### Istio Sidecar Not Ready

If pods show 1/2 READY (app running but sidecar not):

```bash
kubectl logs -n team-alpha deploy/my-app -c istio-proxy
```

**Common causes:**
- Missing `allow-istio-control-plane` NetworkPolicy. This was a critical bug found in Round 4 and is now included in the tenant base template.
- Namespace missing `istio-injection: enabled` label.

### Non-Numeric USER in Dockerfile

If a Dockerfile uses `USER node` (name instead of UID), Kubernetes cannot verify `runAsNonRoot` because it does not know the numeric UID. This was discovered in Round 6 with n8n.

**Fix:** Use `--run-as-root` even though the app is not actually root. This bypasses the `runAsNonRoot` check. Alternatively, rebuild the image with a numeric USER (`USER 1000`).

---

## Deploy Script Flag Reference

| Flag | Description | Example |
|------|-------------|---------|
| `--name` | App name (required) | `--name my-app` |
| `--team` | Team namespace (required) | `--team team-alpha` |
| `--image` | Image repository (required) | `--image harbor.apps.sre.example.com/team-alpha/my-app` |
| `--tag` | Image tag (required) | `--tag v1.0.0` |
| `--port` | Container port | `--port 3000` |
| `--chart` | Chart type | `--chart web-app` (or `api-service`, `worker`, `cronjob`) |
| `--replicas` | Replica count | `--replicas 3` |
| `--ingress` | External hostname | `--ingress my-app.apps.sre.example.com` |
| `--hpa` | Enable autoscaling | `--hpa` |
| `--metrics` | Enable Prometheus scraping | `--metrics` |
| `--liveness` | Liveness probe path | `--liveness /healthz` |
| `--readiness` | Readiness probe path | `--readiness /readyz` |
| `--startup-probe` | Startup probe path | `--startup-probe /api/healthz` |
| `--run-as-root` | Allow UID 0 + create PolicyException | `--run-as-root` |
| `--writable-root` | Disable read-only root filesystem | `--writable-root` |
| `--add-capability` | Add Linux capability (repeatable) | `--add-capability NET_BIND_SERVICE` |
| `--persist` | Mount PVC at path (repeatable) | `--persist /app/data:5Gi` |
| `--command` | Override container command | `--command "/app/server"` |
| `--args` | Override container arguments | `--args "--port=3000 --debug"` |
| `--singleton` | Exactly 1 replica, no HPA | `--singleton` |
| `--resources` | Resource preset | `--resources medium` |
| `--env` | Environment variable (repeatable) | `--env "KEY=value"` |
| `--extra-volume` | EmptyDir volume (repeatable) | `--extra-volume tmp:/tmp` |
| `--env-from-secret` | Mount K8s Secret as env vars | `--env-from-secret my-creds` |
| `--extra-port` | Additional Service port | `--extra-port ssh:2222:2222:tcp` |
| `--config-file` | Mount file as ConfigMap | `--config-file config.ini:/app/config.ini` |
| `--protocol` | App protocol | `--protocol grpc` |
| `--probe-type` | Probe type | `--probe-type tcp` |
| `--no-commit` | Generate files only, skip git commit | `--no-commit` |
