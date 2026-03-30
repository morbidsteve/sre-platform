# App Contract

## Overview

An App Contract is a simplified YAML file that describes your application in roughly 15 lines. Instead of writing 50+ lines of HelmRelease configuration and Helm values by hand, you write a short contract file and run `task deploy-app`. The task reads your contract, generates the full HelmRelease with all required security contexts, network policies, service monitors, and Istio configuration, then writes it to the correct tenant directory so Flux can deploy it.

The contract abstracts away the platform internals. You describe _what_ your app needs (image, port, resources, services). The platform decides _how_ to wire it up (security contexts, sidecar injection, mTLS, monitoring, network policies).

---

## Contract Format

Below is the full contract schema. Required fields are marked; everything else has sensible defaults.

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: my-service          # Required. Kebab-case app name.
  team: team-alpha           # Required. Must match a tenant namespace (team-*).
spec:
  type: web-app              # Required. web-app | api-service | worker | cronjob
  image: harbor.sre.internal/team-alpha/my-service:v1.0.0  # Required. Must be from Harbor.
  port: 8080                 # Optional. Default: 8080. Range: 1-65535.
  replicas: 2                # Optional. Default: 2 (web-app/api-service), 1 (worker/cronjob).
  resources: small            # Required. small | medium | large | custom
  customResources:            # Required only when resources: custom.
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
  ingress: app.example.com   # Optional. Hostname for external access via Istio gateway.
  probes:                     # Optional. Defaults: /healthz (liveness), /readyz (readiness).
    liveness: /healthz
    readiness: /readyz
  env:                        # Optional. Environment variables.
    - name: KEY
      value: plain-value
    - name: SECRET_KEY
      secret: openbao-secret-name
  services:                   # Optional. Platform service integrations.
    database:
      enabled: true
      size: small             # small | medium | large
    redis:
      enabled: true
      size: small
    sso:
      enabled: true
  externalApis:               # Optional. External API access (Istio ServiceEntry).
    - api.stripe.com
    - api.sendgrid.com
  schedule: "0 */6 * * *"   # Required for cronjob type. Forbidden for other types.
  canary:
    enabled: true             # Optional. Progressive deployment via Flagger.
```

---

## Resource Presets

### Application resources

| Preset | CPU Request | Memory Request | CPU Limit | Memory Limit |
|--------|-------------|----------------|-----------|--------------|
| small  | 100m        | 128Mi          | 500m      | 512Mi        |
| medium | 250m        | 256Mi          | 1000m     | 1Gi          |
| large  | 500m        | 512Mi          | 2000m     | 2Gi          |

### Database sizes

| Size   | Instances | Storage |
|--------|-----------|---------|
| small  | 1         | 5Gi     |
| medium | 2         | 10Gi    |
| large  | 3         | 20Gi    |

### Redis sizes

| Size   | Storage |
|--------|---------|
| small  | 1Gi     |
| medium | 2Gi     |
| large  | 5Gi     |

---

## Quick Start: Deploy Your First App

### Step 1: Create a contract file

Create a file at `apps/contracts/hello-web.yaml`:

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: hello-web
  team: team-alpha
spec:
  type: web-app
  image: harbor.sre.internal/team-alpha/hello-web:v1.0.0
  port: 8080
  resources: small
  ingress: hello-web.apps.sre.example.com
```

That is the entire file. Nine lines under `spec`.

### Step 2: Generate the HelmRelease

```bash
task deploy-app -- apps/contracts/hello-web.yaml
```

This validates the contract, resolves resource presets, and writes a full HelmRelease manifest to the correct tenant directory.

### Step 3: Review the generated output

The generated file lives at:

```
apps/tenants/team-alpha/apps/hello-web.yaml
```

It contains a complete HelmRelease with security contexts, NetworkPolicy, ServiceMonitor, Istio VirtualService, HPA, and PodDisruptionBudget -- all derived from your 15-line contract.

### Step 4: Commit and push

```bash
git add apps/contracts/hello-web.yaml apps/tenants/team-alpha/apps/hello-web.yaml
git commit -m "feat(team-alpha): deploy hello-web v1.0.0"
git push
```

Flux detects the change and deploys your app. Within a few minutes, it is running with full platform integration.

---

## Adding Services

To add a database, Redis cache, or SSO integration, add the `services` block to your contract.

### Example: full-stack app with database, Redis, and SSO

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: full-stack-app
  team: team-alpha
spec:
  type: web-app
  image: harbor.sre.internal/team-alpha/full-stack-app:v2.1.0
  port: 3000
  resources: medium
  ingress: app.apps.sre.example.com
  env:
    - name: DATABASE_URL
      secret: full-stack-app-db-creds
    - name: REDIS_URL
      secret: full-stack-app-redis-creds
  services:
    database:
      enabled: true
      size: medium
    redis:
      enabled: true
      size: small
    sso:
      enabled: true
```

When `services.database` is enabled, the platform provisions a PostgreSQL instance in your team namespace and stores the connection string in OpenBao. The `DATABASE_URL` secret reference pulls it in automatically via External Secrets Operator.

When `services.redis` is enabled, a Redis instance is provisioned the same way.

When `services.sso` is enabled, an OIDC client is registered in Keycloak for your app. Your app receives `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `OIDC_ISSUER_URL` as environment variables.

---

## Custom Resources

If the small/medium/large presets do not fit your workload, use `resources: custom` and specify exact values:

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: memory-heavy-worker
  team: team-alpha
spec:
  type: worker
  image: harbor.sre.internal/team-alpha/memory-heavy-worker:v3.0.0
  resources: custom
  customResources:
    requests:
      cpu: 100m
      memory: 2Gi
    limits:
      cpu: 500m
      memory: 4Gi
```

When `resources` is set to `custom`, the `customResources` block is required. Both `requests` and `limits` must be specified with `cpu` and `memory` values.

---

## App Types

### web-app

HTTP services with optional external ingress. Generates a Deployment, Service, HPA, PDB, ServiceMonitor, and NetworkPolicy. If `ingress` is set, an Istio VirtualService routes external traffic through the gateway.

### api-service

Internal APIs consumed by other services in the cluster. Same resources as web-app, but adds an Istio AuthorizationPolicy that restricts which service accounts can call the API. No external ingress by default.

### worker

Background processors that consume from queues or run long-lived tasks. Generates a Deployment with no Service and no ingress. Egress-only NetworkPolicy allows the worker to reach internal services and any declared `externalApis`.

### cronjob

Scheduled jobs that run on a cron expression. Generates a CronJob instead of a Deployment. The `schedule` field is required and must be a valid cron expression. No Service, no ingress. Each job run gets its own Pod with the same security context as all other app types.

---

## Environment Variables

Environment variables come in two forms: plain values and OpenBao secrets.

```yaml
env:
  - name: LOG_LEVEL
    value: info                # Plain text value, stored in the HelmRelease.
  - name: DATABASE_URL
    secret: my-db-creds        # Synced from OpenBao via External Secrets Operator.
```

**Plain values** are embedded directly in the generated HelmRelease. Use these for non-sensitive configuration like log levels, feature flags, and service URLs.

**Secret references** create an ExternalSecret that syncs the named secret from OpenBao into a Kubernetes Secret in your namespace. The secret is mounted as an environment variable in your container. The OpenBao path is derived from your team and secret name: `sre/<team>/<secret-name>`.

To store a secret in OpenBao before deploying:

```bash
# Using the OpenBao CLI (requires platform-admin or tenant-admin role)
bao kv put sre/team-alpha/my-db-creds value="postgresql://user:pass@db:5432/mydb"
```

---

## External API Access

The platform enforces default-deny networking. Pods cannot reach external endpoints unless explicitly allowed. If your app needs to call an external API, declare it in the contract:

```yaml
externalApis:
  - api.stripe.com
  - api.sendgrid.com
```

This generates Istio ServiceEntry resources that allow HTTPS traffic to those hostnames. Only port 443 is opened. If you need a non-standard port or protocol, contact your platform admin.

Without this declaration, outbound requests to external services will be blocked by the mesh.

---

## What Happens After You Commit

When you push your contract and generated HelmRelease to Git, the following sequence runs automatically:

1. **Flux detects the change.** The GitRepository source polls every minute (or receives a webhook notification).
2. **Flux renders the HelmRelease.** It resolves the chart reference, merges values, and generates Kubernetes manifests from the SRE Helm chart template.
3. **Kyverno validates the manifests.** Policies check for required labels, security contexts, image registry restrictions, and image signature verification.
4. **Pods deploy with full platform integration.** Each pod gets an Istio sidecar (mTLS), a read-only root filesystem, non-root user, dropped capabilities, and resource limits.
5. **Monitoring and logging activate.** The ServiceMonitor starts scraping metrics. Alloy collects logs. Grafana dashboards show your app alongside the rest of the platform.
6. **Ingress becomes available.** If you set an `ingress` hostname, traffic flows through the Istio gateway with TLS termination, and your app is reachable externally.

The full cycle from push to running pods typically takes 1-3 minutes.

---

## Troubleshooting

### "Image must be from Harbor"

The image field must reference the internal Harbor registry. Images from Docker Hub, GHCR, or other public registries are not allowed directly. Push your image to Harbor first:

```bash
docker tag my-app:v1.0.0 harbor.sre.internal/team-alpha/my-app:v1.0.0
docker push harbor.sre.internal/team-alpha/my-app:v1.0.0
```

### "Latest tag not allowed"

The platform requires pinned image versions. Replace `:latest` with a specific version tag like `:v1.0.0` or a SHA digest.

### "Team namespace not found"

Your team must be onboarded before you can deploy. Ask your platform admin to run the tenant onboarding script, or run it yourself if you have permissions:

```bash
./scripts/onboard-tenant.sh team-alpha
```

### App not deploying

Check the HelmRelease status in your team namespace:

```bash
flux get helmreleases -n team-alpha
```

If the release is in a failed state, check the Flux logs for details:

```bash
flux logs --kind=HelmRelease --name=hello-web -n team-alpha
```

### Pod rejected by admission control

Kyverno policies may reject pods that violate security requirements. Check the policy reports:

```bash
kubectl get policyreport -n team-alpha
```

Common causes: missing security context, privileged containers, host path mounts, or missing required labels. The contract system handles all of these automatically, so this usually indicates a problem with the generated output or a custom override.

### Cannot reach external API

If your app gets connection timeouts to an external service, you likely need to add the hostname to the `externalApis` list in your contract. The platform blocks all outbound traffic by default. After adding the entry, re-run `task deploy-app` and push the updated files.
