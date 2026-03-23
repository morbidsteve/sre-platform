> **Quick navigation:** This is the primary developer guide covering all deployment methods.
> For first-time setup, see [Getting Started](getting-started-developer.md).
> For the Deploy from Git feature specifically, see [Deploy from Git Guide](developer-deployment-guide.md).

# Developer Guide — Deploy Your App on SRE

This guide takes you from "I have a container image" to "my app is running on the SRE platform" in under 5 minutes.

## Quick Deploy via Dashboard (Recommended)

The fastest way to deploy is the **SRE Dashboard** — a web UI that lets you deploy apps, monitor platform health, and access service credentials with zero CLI knowledge.

**Open the dashboard:**

```bash
# Option 1: Via Istio ingress (add to /etc/hosts first)
# echo "<NODE_IP> dashboard.apps.sre.example.com" | sudo tee -a /etc/hosts
# Then open: https://dashboard.apps.sre.example.com

# Option 2: Via port-forward (no DNS setup needed)
kubectl port-forward -n sre-dashboard svc/sre-dashboard 3001:3001
# Then open: http://localhost:3001
```

From the **Deploy App** tab:
1. Enter your app name, team namespace, container image, tag, port, and replicas
2. Optionally set an ingress hostname for external access
3. Click **Deploy** — Flux picks it up within seconds

The dashboard also shows:
- **Overview** — all HelmReleases, node status, and problem pods in real time
- **Services** — clickable links to Grafana, Prometheus, Alertmanager, NeuVector, and all ingress routes
- **Credentials** — Grafana admin password, NeuVector login, OpenBao root token (click to copy)

---

## Quick Deploy via CLI

If you prefer the command line:

```bash
./scripts/sre-deploy-app.sh
```

The interactive script asks for your app name, image, port, and team — then generates the Kubernetes manifests, commits them to Git, and Flux handles the rest. No Helm or Flux knowledge required.

---

## What You Need Before Starting

1. **A container image** pushed to a registry (Docker Hub, GitHub Container Registry, or any public/private registry)
2. **Git access** to this repository (push permissions)
3. **A team namespace** — ask your platform admin or run: `./scripts/sre-new-tenant.sh <team-name>`
4. **kubectl** (optional, for checking status)

## How It Works

```
You commit a YAML file ──> Git ──> Flux CD detects it ──> Deploys to Kubernetes
```

No `kubectl apply`, no Helm commands, no CI/CD pipeline needed. You write a small YAML file describing your app, push to Git, and Flux deploys it within 10 minutes.

The platform automatically adds:
- **Security context** — non-root, read-only filesystem, dropped capabilities
- **Network policies** — deny-all by default, allow only what's needed
- **Istio sidecar** — encrypted mTLS traffic between all services
- **Service account** — dedicated identity for your app
- **Health probes** — liveness and readiness checks

### Non-Interactive / Bulk Deploy

For CI pipelines or deploying many services at once:

```bash
# Deploy a single app with flags
./scripts/sre-deploy-app.sh \
  --name my-api \
  --team team-alpha \
  --image docker.io/myorg/my-api \
  --tag v1.0.0 \
  --port 8080 \
  --ingress my-api.apps.sre.example.com

# Bulk deploy: 10 microservices in one shot
SERVICES="api-gateway user-svc order-svc payment-svc inventory-svc \
  notification-svc auth-svc search-svc analytics-svc admin-svc"

for svc in $SERVICES; do
  ./scripts/sre-deploy-app.sh \
    --name "$svc" \
    --team my-team \
    --image "docker.io/myorg/$svc" \
    --tag v1.0.0 \
    --port 8080 \
    --no-commit
done

# Single commit + push for all services
git add apps/tenants/my-team/
git commit -m "feat(apps): deploy all microservices to my-team"
git push
```

All flags: `--name`, `--team`, `--image`, `--tag`, `--port`, `--chart`, `--replicas`, `--ingress HOST`, `--hpa`, `--metrics`, `--no-commit`. Run `./scripts/sre-deploy-app.sh --help` for details.

---

## Step-by-Step: Manual Deployment

### 1. Choose a chart template

| Template | Use Case |
|----------|----------|
| `web-app` | HTTP services with external or internal traffic |
| `api-service` | Internal APIs with Istio authorization policies |
| `worker` | Background processors (no incoming traffic) |
| `cronjob` | Scheduled jobs |

### 2. Create the HelmRelease file

Create a file at `apps/tenants/<your-team>/apps/<your-app>.yaml`:

```yaml
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-app
  namespace: my-team
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: my-team
spec:
  interval: 10m
  chart:
    spec:
      chart: ./apps/templates/web-app
      sourceRef:
        kind: GitRepository
        name: flux-system
        namespace: flux-system
  install:
    createNamespace: false
    remediation:
      retries: 3
  upgrade:
    cleanupOnFail: true
    remediation:
      retries: 3
  values:
    app:
      name: "my-app"
      team: "my-team"
      image:
        repository: "docker.io/myorg/my-app"
        tag: "v1.0.0"
        pullPolicy: IfNotPresent
      port: 8080
      replicas: 2
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 256Mi
      probes:
        liveness:
          path: "/"
          initialDelaySeconds: 10
          periodSeconds: 10
        readiness:
          path: "/"
          initialDelaySeconds: 5
          periodSeconds: 5
      env: []
    ingress:
      enabled: false
    autoscaling:
      enabled: false
    serviceMonitor:
      enabled: false
    networkPolicy:
      enabled: true
    podDisruptionBudget:
      enabled: false
```

### 3. Register it in kustomization.yaml

Add your app to `apps/tenants/<your-team>/kustomization.yaml`:

```yaml
resources:
  - namespace.yaml
  - rbac.yaml
  - resource-quota.yaml
  - limit-range.yaml
  - network-policies/default-deny.yaml
  - network-policies/allow-base.yaml
  - apps/my-app.yaml          # <-- add this line
```

### 4. Commit and push

```bash
git add apps/tenants/my-team/
git commit -m "feat(apps): deploy my-app to my-team"
git push
```

### 5. Wait for Flux (or force it)

Flux reconciles every 10 minutes. To deploy immediately:

```bash
flux reconcile kustomization sre-tenants --with-source
```

### 6. Check status

```bash
# HelmRelease status
kubectl get helmrelease my-app -n my-team

# Pod status
kubectl get pods -n my-team -l app.kubernetes.io/name=my-app

# Logs
kubectl logs -n my-team -l app.kubernetes.io/name=my-app -f
```

---

## Common Configurations

### Enable external access (ingress)

Add these values to expose your app via a URL:

```yaml
    ingress:
      enabled: true
      host: "my-app.apps.sre.example.com"
```

The Istio gateway routes traffic through NodePort services on standard ports **80** (HTTP) and **443** (HTTPS).

For a lab environment, add DNS entries to `/etc/hosts`:
```bash
# Use any cluster node IP
echo "192.168.2.104 my-app.apps.sre.example.com" | sudo tee -a /etc/hosts

# Access your app
curl http://my-app.apps.sre.example.com
```

### Environment variables

Plain values:
```yaml
      env:
        - name: LOG_LEVEL
          value: "info"
        - name: APP_ENV
          value: "production"
```

From secrets (via External Secrets Operator + OpenBao):
```yaml
      env:
        - name: DATABASE_URL
          secretRef: my-app-db-url
```

This creates an ExternalSecret that pulls the value from OpenBao at path `sre/<team>/<secret-name>`.

### Autoscaling (HPA)

```yaml
    autoscaling:
      enabled: true
      minReplicas: 2
      maxReplicas: 10
      targetCPUUtilization: 80
```

When autoscaling is enabled, the `replicas` field under `app` is ignored.

### Prometheus metrics

```yaml
    serviceMonitor:
      enabled: true
      interval: "30s"
      path: /metrics
```

Your app must expose a `/metrics` endpoint in Prometheus format. Once enabled, metrics appear automatically in Grafana.

### Pod Disruption Budget

```yaml
    podDisruptionBudget:
      enabled: true
      minAvailable: 1
```

Ensures at least 1 pod stays running during node maintenance or rolling updates.

### Additional network rules

By default, your app can:
- **Receive** traffic from the Istio gateway, monitoring namespace, and same namespace
- **Send** traffic to DNS, same namespace, and HTTPS (port 443) to the internet

To add custom rules:
```yaml
    networkPolicy:
      enabled: true
      additionalEgress:
        - to:
            - namespaceSelector:
                matchLabels:
                  kubernetes.io/metadata.name: other-team
          ports:
            - port: 8080
              protocol: TCP
```

---

## Container Image Requirements

Your container image **must** meet these requirements to run on SRE:

1. **Run as non-root** — The platform enforces `runAsNonRoot: true`. Your Dockerfile needs:
   ```dockerfile
   RUN adduser -D appuser
   USER appuser
   ```

2. **Read-only filesystem** — The root filesystem is mounted read-only. Write to `/tmp` or `/var/cache` instead (both are writable emptyDir volumes).

3. **No capabilities** — All Linux capabilities are dropped. Your app cannot use `NET_ADMIN`, `SYS_ADMIN`, etc.

4. **Listen on a non-privileged port** — Use port 8080 or higher (not 80 or 443).

5. **Pinned version tag** — Never use `:latest`. Always use a specific version like `:v1.2.3` or `:1.27.3-alpine`.

### Quick test

To verify your image works under SRE security constraints:

```bash
docker run --rm \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/cache \
  --cap-drop ALL \
  -p 8080:8080 \
  your-image:tag
```

If it runs successfully, it will work on SRE.

### Recommended base images

| Image | Use Case |
|-------|----------|
| `nginxinc/nginx-unprivileged` | Static sites, reverse proxy |
| `gcr.io/distroless/static` | Go binaries |
| `gcr.io/distroless/base` | C/C++ binaries |
| `cgr.dev/chainguard/python` | Python apps |
| `cgr.dev/chainguard/node` | Node.js apps |

---

## Updating Your App

To deploy a new version, update the image tag in your HelmRelease and push:

```yaml
      image:
        repository: "docker.io/myorg/my-app"
        tag: "v1.1.0"    # <-- change this
```

```bash
git add apps/tenants/my-team/apps/my-app.yaml
git commit -m "feat(apps): bump my-app to v1.1.0"
git push
```

Flux detects the change and performs a rolling update with zero downtime.

---

## Deleting Your App

Remove the file and the reference:

```bash
# Remove the HelmRelease file
rm apps/tenants/my-team/apps/my-app.yaml

# Edit kustomization.yaml to remove the apps/my-app.yaml line

# Commit and push
git add -A apps/tenants/my-team/
git commit -m "fix(apps): remove my-app from my-team"
git push
```

Flux will delete all resources created by the HelmRelease.

---

## Troubleshooting

### Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `container has runAsNonRoot and image will run as root` | Image runs as root | Use a non-root base image (e.g., `nginx-unprivileged`) |
| `Read-only file system` | App writes to root filesystem | Write to `/tmp` or `/var/cache` instead |
| `CrashLoopBackOff` | App crashes on startup | Check logs: `kubectl logs -n my-team -l app.kubernetes.io/name=my-app` |
| `ImagePullBackOff` | Can't pull image | Verify image name/tag and registry access |
| `Helm install failed` | Values don't match schema | Check: `kubectl get helmrelease -n my-team my-app -o yaml` |
| Pod stuck in `Pending` | ResourceQuota exceeded | Check: `kubectl describe quota -n my-team` |

### Port-forward for debugging

If ingress isn't set up, access your app locally:

```bash
kubectl port-forward -n my-team svc/my-app-my-app 8080:8080
# Then open http://localhost:8080
```

### Force Flux to reconcile

```bash
flux reconcile kustomization sre-tenants --with-source
```

### Check what Flux sees

```bash
flux get helmreleases -n my-team
flux logs --kind=HelmRelease --name=my-app -n my-team
```

---

## Full Values Reference

| Value | Type | Default | Description |
|-------|------|---------|-------------|
| `app.name` | string | `""` | Application name (required) |
| `app.team` | string | `""` | Team name (required) |
| `app.image.repository` | string | `""` | Container image repository (required) |
| `app.image.tag` | string | `""` | Image tag (required, never use `latest`) |
| `app.image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `app.port` | int | `8080` | Container port |
| `app.replicas` | int | `2` | Number of replicas (ignored when HPA enabled) |
| `app.resources.requests.cpu` | string | `100m` | CPU request |
| `app.resources.requests.memory` | string | `128Mi` | Memory request |
| `app.resources.limits.cpu` | string | `500m` | CPU limit |
| `app.resources.limits.memory` | string | `512Mi` | Memory limit |
| `app.env` | list | `[]` | Environment variables |
| `app.probes.liveness.path` | string | `/healthz` | Liveness probe path |
| `app.probes.readiness.path` | string | `/readyz` | Readiness probe path |
| `ingress.enabled` | bool | `false` | Enable Istio VirtualService |
| `ingress.host` | string | `""` | Hostname for ingress |
| `ingress.gateway` | string | `istio-system/main` | Istio gateway reference |
| `autoscaling.enabled` | bool | `true` | Enable HPA |
| `autoscaling.minReplicas` | int | `2` | Minimum replicas |
| `autoscaling.maxReplicas` | int | `10` | Maximum replicas |
| `autoscaling.targetCPUUtilization` | int | `80` | CPU target percentage |
| `serviceMonitor.enabled` | bool | `true` | Enable Prometheus scraping |
| `serviceMonitor.interval` | string | `30s` | Scrape interval |
| `serviceMonitor.path` | string | `/metrics` | Metrics endpoint path |
| `networkPolicy.enabled` | bool | `true` | Enable NetworkPolicy |
| `podDisruptionBudget.enabled` | bool | `true` | Enable PDB |
| `podDisruptionBudget.minAvailable` | int | `1` | Minimum available pods |

## Secrets Management

The platform uses **OpenBao** (open-source Vault fork) with **External Secrets Operator** to deliver secrets to your apps.

### How it works

1. An admin stores a secret in OpenBao at `sre/<team>/<app>/<key>`
2. You create an `ExternalSecret` resource referencing the OpenBao path
3. ESO syncs it into a standard Kubernetes Secret in your namespace
4. Your app reads it as an environment variable or mounted file

### Example: Using a secret in your app

```yaml
# 1. Ask your platform admin to store the secret:
#    bao kv put sre/team-alpha/my-app database-url="postgres://..."

# 2. Create an ExternalSecret in your namespace:
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-secrets
  namespace: team-alpha
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: my-app-secrets
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: team-alpha/my-app
        property: database-url
```

```yaml
# 3. Reference in your Deployment:
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: my-app-secrets
        key: DATABASE_URL
```

### Verify your secret synced

```bash
kubectl get externalsecret -n team-alpha
# Should show STATUS: SecretSynced, READY: True
```

## SSO / Authentication

The platform uses **Keycloak** for single sign-on. All platform UIs (Grafana, Harbor, NeuVector) can authenticate via OIDC.

### Keycloak SRE Realm

| Setting | Value |
|---------|-------|
| Realm | `sre` |
| OIDC Discovery | `https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration` |
| Groups | `platform-admins`, `developers`, `viewers` |

### Test Users

| Username | Password | Group |
|----------|----------|-------|
| `sre-admin` | `admin123` | platform-admins |
| `developer` | `dev123` | developers |

### OIDC Clients

| Client ID | Used By |
|-----------|---------|
| `grafana` | Grafana SSO login |
| `harbor` | Harbor SSO login |
| `sre-dashboard` | SRE Dashboard |
| `neuvector` | NeuVector SSO login |

## CI/CD Pipeline

The platform includes reusable GitHub Actions workflows in `ci/github-actions/`.

### Quick start

```yaml
# .github/workflows/deploy.yaml in your app repo
name: Deploy
on:
  push:
    tags: ['v*']

jobs:
  build-and-deploy:
    uses: <org>/sre-platform/.github/workflows/build-scan-deploy.yaml@main
    with:
      image-name: my-app
      image-tag: ${{ github.ref_name }}
      harbor-project: team-alpha
    secrets: inherit
```

The pipeline will:
1. Build your Docker image
2. Scan with Trivy (fails on CRITICAL vulnerabilities)
3. Generate SBOM (SPDX + CycloneDX)
4. Sign with Cosign
5. Push to Harbor
6. Update the GitOps repo (Flux auto-deploys)
