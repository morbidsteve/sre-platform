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

See the [Troubleshooting Guide](troubleshooting.md) for solutions to common issues.

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

## Policy Exceptions

If your application has a legitimate reason to bypass a Kyverno policy (e.g., a security
scanner that requires privileged access, or a legacy app being migrated that must run as
root temporarily), you can request a formal policy exception.

**How it works:**
1. Copy the template: `policies/custom/policy-exception-template.yaml`
2. Save it to `policies/custom/policy-exceptions/<your-team>-<reason>.yaml`
3. Scope it as narrowly as possible (specific pod names, not entire namespaces)
4. Fill in all required annotations (reason, expiry, tracking ticket)
5. Submit a PR — the platform team reviews and approves

Exceptions are time-limited (90-day maximum) and tracked in Git for audit compliance.

See the full process: [Policy Exceptions Guide](../policies/custom/policy-exceptions/README.md)
See the violation runbook: [Pod Security Violation Runbook](runbooks/pod-security-violation.md)

---

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

---

## Cross-Namespace Service Communication

When your service in one namespace (e.g., `team-alpha`) needs to call an API in another namespace (e.g., `team-beta`), you need three things: DNS resolution, a NetworkPolicy allowing egress/ingress, and an Istio AuthorizationPolicy granting access.

### DNS

Kubernetes provides cross-namespace DNS automatically. Use the fully qualified service name:

```
http://<service-name>.<namespace>.svc.cluster.local:<port>
```

For example, team-alpha calling team-beta's API:

```bash
curl http://order-api.team-beta.svc.cluster.local:8080/api/orders
```

### NetworkPolicy

Both sides need explicit rules. On the **caller** side (team-alpha), allow egress to team-beta:

```yaml
# apps/tenants/team-alpha/network-policies/allow-egress-team-beta.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-to-team-beta
  namespace: team-alpha
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: my-frontend
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: team-beta
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: order-api
      ports:
        - port: 8080
          protocol: TCP
```

On the **target** side (team-beta), allow ingress from team-alpha:

```yaml
# apps/tenants/team-beta/network-policies/allow-ingress-team-alpha.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-from-team-alpha
  namespace: team-beta
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: order-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: team-alpha
      ports:
        - port: 8080
          protocol: TCP
```

### Istio AuthorizationPolicy

Grant team-alpha's service account access to team-beta's API:

```yaml
# apps/tenants/team-beta/istio/authz-allow-team-alpha.yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-team-alpha-to-order-api
  namespace: team-beta
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/team-alpha/sa/my-frontend"
      to:
        - operation:
            methods: ["GET", "POST"]
            paths: ["/api/orders*"]
```

Both the NetworkPolicy and AuthorizationPolicy changes require a PR reviewed by the platform team. See also the [Structured Logging Guide](logging-guide.md) for correlating traces across namespaces.

---

## Canary Deployments

The platform supports canary deployments using [Flagger](https://flagger.app/) with Istio. Flagger progressively shifts traffic to a new version and automatically rolls back if metrics degrade.

### Enable canary in your HelmRelease

Add the canary block to your app values:

```yaml
  values:
    app:
      name: "my-app"
      team: "team-alpha"
      image:
        repository: "harbor.apps.sre.example.com/team-alpha/my-app"
        tag: "v2.0.0"
    canary:
      enabled: true
      analysis:
        interval: 30s           # How often to check metrics
        threshold: 5            # Max failed checks before rollback
        maxWeight: 50           # Max traffic percentage to canary
        stepWeight: 10          # Traffic increment per interval
      metrics:
        - name: request-success-rate
          thresholdRange:
            min: 99             # Rollback if success rate drops below 99%
          interval: 30s
        - name: request-duration
          thresholdRange:
            max: 500            # Rollback if p99 latency exceeds 500ms
          interval: 30s
```

### Monitor canary progress

```bash
# Watch canary status
kubectl get canary -n team-alpha -w

# View Flagger events
kubectl describe canary my-app -n team-alpha

# Check traffic weight distribution
kubectl get virtualservice my-app -n team-alpha -o yaml | grep -A5 weight

# Grafana: filter the Istio dashboard by destination_workload="my-app-primary"
# vs destination_workload="my-app-canary" to compare metrics side-by-side
```

### Manual approval gate (optional)

To require manual approval before promoting beyond 50%:

```yaml
    canary:
      analysis:
        webhooks:
          - name: approval-gate
            type: confirm-promotion
            url: http://flagger-loadtester.flagger-system/
```

Approve with: `kubectl annotate canary my-app -n team-alpha flagger.app/approve=true`

---

## Preview Environments

Preview environments give each pull request its own isolated deployment for testing before merging.

### How it works

1. A PR is opened against your app's repo
2. The GitHub Actions workflow calls `scripts/preview-env.sh` to create a temporary namespace
3. Your app is deployed into `preview-<pr-number>` with its own ingress URL
4. When the PR is closed or merged, the preview environment is automatically deleted

### Manual preview creation

```bash
# Create a preview for PR #42
./scripts/preview-env.sh create \
  --pr 42 \
  --team team-alpha \
  --image harbor.apps.sre.example.com/team-alpha/my-app \
  --tag pr-42-abc1234

# Output:
# Preview deployed to namespace: preview-42
# URL: https://pr-42.preview.apps.sre.example.com

# Delete when done
./scripts/preview-env.sh delete --pr 42
```

### GitHub Actions workflow

Add to your app repository at `.github/workflows/preview.yaml`:

```yaml
name: Preview Environment
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: <org>/sre-platform

      - name: Create or Update Preview
        if: github.event.action != 'closed'
        run: |
          ./scripts/preview-env.sh create \
            --pr ${{ github.event.pull_request.number }} \
            --team ${{ vars.TEAM_NAME }} \
            --image ${{ vars.HARBOR_REGISTRY }}/${{ vars.APP_NAME }} \
            --tag pr-${{ github.event.pull_request.number }}-${{ github.sha }}

      - name: Delete Preview
        if: github.event.action == 'closed'
        run: |
          ./scripts/preview-env.sh delete \
            --pr ${{ github.event.pull_request.number }}
```

Preview namespaces have the same security policies as production but with reduced resource quotas (1 CPU, 1Gi memory). They are automatically cleaned up after 72 hours if the PR is not closed.

---

## Environment Promotion

The platform uses Flux CD value overlays to manage configuration differences across dev, staging, and production environments. The same Git repo and chart are used everywhere -- only the values change.

### Directory structure

```
apps/tenants/team-alpha/
  apps/
    my-app.yaml                    # Base HelmRelease (used in dev)
  overlays/
    staging/
      my-app-values.yaml           # Staging overrides
    production/
      my-app-values.yaml           # Production overrides
```

### Base HelmRelease (dev)

The base HelmRelease in `apps/my-app.yaml` contains dev defaults. Staging and production override specific values using Flux `valuesFrom`:

```yaml
# apps/tenants/team-alpha/apps/my-app.yaml
spec:
  values:
    app:
      replicas: 1
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 256Mi
    autoscaling:
      enabled: false
  valuesFrom:
    - kind: ConfigMap
      name: my-app-env-values
      optional: true
```

### Staging overlay

```yaml
# apps/tenants/team-alpha/overlays/staging/my-app-values.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-env-values
  namespace: team-alpha
data:
  values.yaml: |
    app:
      replicas: 2
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
    autoscaling:
      enabled: true
      minReplicas: 2
      maxReplicas: 5
```

### Production overlay

```yaml
# apps/tenants/team-alpha/overlays/production/my-app-values.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-env-values
  namespace: team-alpha
data:
  values.yaml: |
    app:
      replicas: 3
      resources:
        requests:
          cpu: 250m
          memory: 256Mi
        limits:
          cpu: "1"
          memory: "1Gi"
    autoscaling:
      enabled: true
      minReplicas: 3
      maxReplicas: 20
```

### Promotion workflow

1. **Dev**: Merge to `main` -- Flux applies base values automatically
2. **Staging**: Apply the staging ConfigMap, verify metrics in Grafana for 24 hours
3. **Production**: Apply the production ConfigMap after staging sign-off

```bash
# Promote to staging
kubectl apply -f apps/tenants/team-alpha/overlays/staging/my-app-values.yaml
flux reconcile kustomization sre-tenants --with-source

# After staging validation, promote to production
kubectl apply -f apps/tenants/team-alpha/overlays/production/my-app-values.yaml
flux reconcile kustomization sre-tenants --with-source
```

---

## Resource Right-Sizing

Choosing the right CPU and memory requests/limits prevents wasted resources and avoids OOMKills. Use actual usage data from Prometheus to tune your values.

### Check current usage vs requests

```bash
# See resource usage for your pods
kubectl top pods -n team-alpha

# See resource requests and limits
kubectl describe pod -n team-alpha -l app.kubernetes.io/name=my-app | grep -A3 "Requests\|Limits"
```

### PromQL queries for right-sizing

Open Grafana and run these queries against your app's namespace.

**CPU -- actual usage vs request:**

```promql
# Average CPU usage over 7 days (what you actually use)
avg_over_time(rate(container_cpu_usage_seconds_total{namespace="team-alpha", container="my-app"}[5m])[7d:5m])

# CPU request (what you reserved)
kube_pod_container_resource_requests{namespace="team-alpha", container="my-app", resource="cpu"}
```

**Memory -- actual usage vs request:**

```promql
# Peak memory usage over 7 days
max_over_time(container_memory_working_set_bytes{namespace="team-alpha", container="my-app"}[7d])

# Memory request
kube_pod_container_resource_requests{namespace="team-alpha", container="my-app", resource="memory"}
```

### Sizing guidelines

| Metric | Recommendation |
|--------|---------------|
| CPU request | Set to the p95 of actual CPU usage over 7 days |
| CPU limit | Set to 2-5x the request (allows burst) |
| Memory request | Set to the peak (max) usage + 20% headroom |
| Memory limit | Set to 1.5x the request (OOMKill safety margin) |

If `kubectl top` shows your pod consistently using less than 30% of its CPU request or less than 50% of its memory request, reduce the requests. If you see OOMKilled events, increase the memory limit.

---

## Rollback

When a deployment goes wrong, you have three rollback methods depending on urgency.

### Method 1: Git revert (recommended)

The safest approach. Reverts to the previous version through the same GitOps pipeline:

```bash
# Find the commit that bumped the image tag
git log --oneline apps/tenants/team-alpha/apps/my-app.yaml

# Revert it
git revert <commit-hash>
git push

# Flux auto-deploys the previous version (within 10 minutes)
# Or force immediate reconciliation:
flux reconcile kustomization sre-tenants --with-source
```

### Method 2: Tag update (fast)

Edit the image tag back to the known-good version and push:

```bash
# Edit the tag in apps/tenants/team-alpha/apps/my-app.yaml
#   tag: "v1.0.0"  # revert from v1.1.0

git add apps/tenants/team-alpha/apps/my-app.yaml
git commit -m "fix(apps): rollback my-app to v1.0.0"
git push
```

### Method 3: Emergency Helm rollback (immediate)

For critical incidents where you cannot wait for Flux reconciliation. This bypasses GitOps and applies immediately:

```bash
# List Helm release history
helm history my-app -n team-alpha

# Rollback to previous revision
helm rollback my-app <revision-number> -n team-alpha

# IMPORTANT: After the emergency, update Git to match the rollback state.
# Otherwise Flux will re-deploy the broken version on next reconciliation.
```

After using Method 3, you **must** update the HelmRelease YAML in Git to reflect the rolled-back version. Otherwise, the next Flux reconciliation will redeploy the broken version.

---

## Health Check Configuration

Kubernetes uses probes to know when your app is ready to serve traffic and when it needs to be restarted. Misconfigured probes are the most common cause of unnecessary restarts and deployment failures.

### Probe types

| Probe | Purpose | When it fails |
|-------|---------|---------------|
| `livenessProbe` | Is the process alive? | Pod is killed and restarted |
| `readinessProbe` | Is the app ready to serve traffic? | Pod is removed from Service endpoints (no traffic) |
| `startupProbe` | Has the app finished starting? | Liveness/readiness checks are delayed |

### HTTP probe (most common)

```yaml
app:
  probes:
    liveness:
      path: /healthz           # Should return 200 if process is alive
      initialDelaySeconds: 15  # Wait before first check
      periodSeconds: 10        # Check every 10 seconds
      timeoutSeconds: 3        # Timeout per check
      failureThreshold: 3     # Restart after 3 consecutive failures
    readiness:
      path: /readyz            # Should return 200 when ready to serve
      initialDelaySeconds: 5
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 3
```

### TCP probe (for non-HTTP services)

For services that do not expose HTTP endpoints (e.g., gRPC, database proxies):

```yaml
app:
  probes:
    liveness:
      tcpSocket:
        port: 5432
      initialDelaySeconds: 15
      periodSeconds: 10
    readiness:
      tcpSocket:
        port: 5432
      initialDelaySeconds: 5
      periodSeconds: 5
```

### Exec probe (for custom checks)

Run a command inside the container:

```yaml
app:
  probes:
    liveness:
      exec:
        command:
          - /bin/sh
          - -c
          - pg_isready -U postgres
      initialDelaySeconds: 30
      periodSeconds: 10
```

### Tuning guidance

- **Slow-starting apps** (JVM, large Node.js): increase `initialDelaySeconds` to 30-60 seconds, or use a `startupProbe` with a high `failureThreshold` (e.g., 30 checks at 10s intervals = 5-minute startup window)
- **Liveness path** should be lightweight (no DB calls, no downstream checks). Return 200 if the process is alive.
- **Readiness path** should verify dependencies (DB connection, cache warmth). Return 503 until ready.
- Do **not** set `timeoutSeconds` lower than your endpoint's typical response time.
- If pods are being killed during deployments, increase `initialDelaySeconds` or add a startup probe.

---

## Secret Rotation

Secrets should be rotated regularly. The platform supports automatic rotation through OpenBao and External Secrets Operator.

### How rotation works

1. A secret is updated in OpenBao (manually or via OpenBao's auto-rotation for dynamic secrets)
2. External Secrets Operator detects the change on its next `refreshInterval` (default: 1 hour)
3. ESO updates the Kubernetes Secret in your namespace
4. Your application picks up the new value

### Configure refresh interval

For secrets that rotate frequently, reduce the ESO refresh interval:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-app-db-creds
  namespace: team-alpha
spec:
  refreshInterval: 15m     # Check for updates every 15 minutes
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: my-app-db-creds
  data:
    - secretKey: password
      remoteRef:
        key: team-alpha/my-app
        property: db-password
```

### Auto-restart on secret change

Your application must be restarted to pick up new secret values. Two approaches:

**Option A: Reloader annotation (recommended)**

Add the [Stakater Reloader](https://github.com/stakater/Reloader) annotation to your Deployment. It watches for Secret changes and triggers a rolling restart:

```yaml
metadata:
  annotations:
    reloader.stakater.com/auto: "true"
```

**Option B: Checksum annotation in Helm**

Include a checksum of the secret data in the pod template so Kubernetes triggers a rolling update when the secret changes:

```yaml
spec:
  template:
    metadata:
      annotations:
        checksum/secrets: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
```

### Verify rotation

```bash
# Check when ESO last synced
kubectl get externalsecret -n team-alpha my-app-db-creds -o jsonpath='{.status.conditions}'

# View secret update timestamp
kubectl get secret -n team-alpha my-app-db-creds -o jsonpath='{.metadata.resourceVersion}'
```

### Rotation schedule recommendations

| Secret type | Rotation frequency | Method |
|------------|-------------------|--------|
| Database credentials | 30 days | OpenBao dynamic secrets (auto) |
| API keys | 90 days | Manual rotation in OpenBao |
| TLS certificates | Auto (cert-manager) | cert-manager handles renewal |
| SSH keys | 180 days | Manual rotation in OpenBao |

See also [Secrets Management](#secrets-management) for initial secret setup, and the [Structured Logging Guide](logging-guide.md) for auditing secret access.
