# Integration Test: Casdoor

**Round:** 3 | **Category:** OAuth/OIDC Provider | **Date:** 2026-03-30

## Application Profile

| Service | Image | Port | Type |
|---------|-------|------|------|
| casdoor | casbin/casdoor:v1.810.0 | 8000 | Web app (Go binary) |
| casdoor-db | postgres:16.6 | 5432 | Worker (platform CNPG) |

## Deploy Commands

```bash
# PostgreSQL backend (or use platform CNPG)
sre-deploy-app.sh casdoor-db team-alpha postgres:16.6 \
  --port 5432 \
  --chart sre-worker \
  --persist /var/lib/postgresql/data:5Gi \
  --run-as-root \
  --writable-root \
  --env POSTGRES_DB=casdoor \
  --env-from-secret casdoor-db-creds

# Casdoor OAuth server
sre-deploy-app.sh casdoor team-alpha casbin/casdoor:v1.810.0 \
  --port 8000 \
  --config-file /conf/app.conf:casdoor-config \
  --startup-probe /api/health \
  --ingress auth.apps.sre.example.com
```

## Results

| Check | Result |
|-------|--------|
| Helm template (app) | PASS (8 resources) |
| Helm template (db) | PASS (6 resources) |
| ConfigMap mount | PASS (volume + volumeMount) |
| Startup probe | PASS (/api/health) |
| Ingress VirtualService | PASS |
| OAuth callback routing | PASS (all paths routed) |

## ConfigMap Mount Detail

The `--config-file /conf/app.conf:casdoor-config` flag generates:
- A ConfigMap named `casdoor-config` (user populates separately)
- A volume definition referencing the ConfigMap
- A volumeMount at `/conf/app.conf` with `subPath: app.conf`

This is the first successful test of `--config-file`. The generated YAML is clean and follows Kubernetes conventions.

## Issues Found

1. **ConfigMap content** -- The deploy script creates the mount but not the ConfigMap content. User must `kubectl create configmap casdoor-config --from-file=app.conf` separately. This is by design (config is app-specific).
2. **DB migration delay** -- Casdoor runs migrations on first start. The `--startup-probe` with `failureThreshold: 30` and `periodSeconds: 10` gives 5 minutes, which is sufficient.
3. **OAuth callback routing** -- Istio VirtualService routes all paths to the app, so `/callback`, `/.well-known/openid-configuration`, and `/api/*` all work without extra route config.

## Verdict

PASS -- Clean template output. The `--config-file` flag works correctly on first use. Startup probe covers migration delay.
