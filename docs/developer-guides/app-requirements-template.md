# App Requirements Template

Fill out this template before deploying an application to the SRE platform. This information determines the deploy flags, security overrides, and platform integrations needed for your app.

---

## Basic Info

| Field | Value |
|-------|-------|
| **App Name** | _(kebab-case, e.g., `my-service`)_ |
| **Team** | _(must match an onboarded tenant, e.g., `team-alpha`)_ |
| **Image** | _(full registry path, e.g., `harbor.apps.sre.example.com/team-alpha/my-service`)_ |
| **Tag** | _(pinned version, e.g., `v1.0.0` -- never `latest`)_ |
| **Port** | _(container listen port, e.g., `8080`)_ |
| **Chart Type** | _(web-app / api-service / worker / cronjob)_ |
| **Replicas** | _(default: 1, set higher for HA)_ |
| **Ingress Hostname** | _(e.g., `my-service.apps.sre.example.com`, or N/A for internal-only)_ |

---

## Security Requirements

| Question | Answer | Deploy Flag |
|----------|--------|-------------|
| Does the app run as root (UID 0)? | Yes / No | `--run-as-root` |
| Does the app write to the filesystem? | Yes / No | `--writable-root` |
| Does the app bind to ports below 1024? | Yes / No | `--add-capability NET_BIND_SERVICE` |
| Does it need SETGID/SETUID? | Yes / No | `--add-capability SETGID --add-capability SETUID` |
| Other Linux capabilities needed? | List them | `--add-capability <CAP>` per capability |
| Does the Dockerfile use a non-numeric USER (e.g., `USER node`)? | Yes / No | May need `--run-as-root` to bypass runAsNonRoot check |

---

## Data Persistence

| Path | Size | Purpose |
|------|------|---------|
| _(e.g., `/app/data`)_ | _(e.g., `10Gi`)_ | _(e.g., SQLite database)_ |
| _(e.g., `/var/lib/postgresql/data`)_ | _(e.g., `20Gi`)_ | _(e.g., PostgreSQL data)_ |

For each path, the deploy command needs: `--persist /path:size`

Ephemeral volumes (cache, temp): `--extra-volume name:/path`

---

## Environment Variables

### Plain Values

| Variable | Value |
|----------|-------|
| _(e.g., `LOG_LEVEL`)_ | _(e.g., `info`)_ |
| _(e.g., `NODE_ENV`)_ | _(e.g., `production`)_ |

Deploy flag: `--env "KEY=value"` (repeatable)

### Secrets (from OpenBao)

| Variable | Secret Name | Notes |
|----------|-------------|-------|
| _(e.g., `DATABASE_URL`)_ | _(e.g., `myapp-db-url`)_ | _(stored in OpenBao at `sre/team-alpha/myapp-db-url`)_ |

Deploy flag: `--env "KEY=secret:secret-name"`

### From Kubernetes Secret

| Secret Name | Notes |
|-------------|-------|
| _(e.g., `myapp-config`)_ | _(all keys mounted as env vars)_ |

Deploy flag: `--env-from-secret secret-name` (repeatable)

---

## Dependencies

### Databases

| Type | Deployed By | Connection |
|------|-------------|------------|
| _(e.g., PostgreSQL 16)_ | _(same namespace / external / CNPG)_ | _(e.g., `postgresql://user:pass@myapp-db:5432/mydb`)_ |

### Caches

| Type | Deployed By | Connection |
|------|-------------|------------|
| _(e.g., Redis 7)_ | _(same namespace / external)_ | _(e.g., `redis://myapp-redis:6379`)_ |

### Other Services

| Service | Namespace | Port | Purpose |
|---------|-----------|------|---------|
| _(e.g., `user-api`)_ | _(e.g., `team-alpha`)_ | _(e.g., `8080`)_ | _(e.g., user authentication)_ |

---

## Health Endpoints

| Probe | Path | Initial Delay |
|-------|------|--------------|
| Liveness | _(e.g., `/healthz`, default: `/`)_ | _(e.g., `10s`)_ |
| Readiness | _(e.g., `/readyz`, default: `/`)_ | _(e.g., `5s`)_ |
| Startup | _(e.g., `/api/healthz`, if app has slow init)_ | N/A |

Deploy flags: `--liveness /path`, `--readiness /path`, `--startup-probe /path`

---

## Custom Command / Arguments

If the container needs a custom entrypoint or arguments:

| Field | Value |
|-------|-------|
| Command | _(e.g., `/app/server`)_ |
| Arguments | _(e.g., `--port=3000 --workers=4`)_ |

Deploy flags: `--command "/app/server"`, `--args "--port=3000 --workers=4"`

---

## Additional Ports

| Name | Port | Target Port | Protocol |
|------|------|-------------|----------|
| _(e.g., `ssh`)_ | _(e.g., `2222`)_ | _(e.g., `2222`)_ | _(tcp / http / grpc)_ |

Deploy flag: `--extra-port name:port:targetPort:protocol` (repeatable)

---

## Config Files

| Local File | Mount Path |
|-----------|------------|
| _(e.g., `nginx.conf`)_ | _(e.g., `/etc/nginx/nginx.conf`)_ |

Deploy flag: `--config-file localfile:mountpath` (repeatable)

---

## Compliance

| Question | Answer |
|----------|--------|
| Data classification | _(CUI / PII / PHI / Public / Internal)_ |
| Does the app handle PII? | Yes / No |
| Does the app need external internet access? | Yes / No -- list hosts |
| Regulatory frameworks | _(NIST 800-53 / CMMC / FedRAMP / HIPAA / None)_ |

---

## Generated Deploy Command

After filling out this template, assemble the deploy command. Example:

```bash
./scripts/sre-deploy-app.sh \
  --name my-service \
  --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/my-service \
  --tag v1.0.0 \
  --port 8080 \
  --ingress my-service.apps.sre.example.com \
  --persist /app/data:10Gi \
  --env "LOG_LEVEL=info" \
  --env "DATABASE_URL=secret:myservice-db-url" \
  --metrics \
  --liveness /healthz \
  --readiness /readyz
```

Or run the compatibility scanner first to detect requirements automatically:

```bash
./scripts/sre-compat-check.sh harbor.apps.sre.example.com/team-alpha/my-service:v1.0.0
```
