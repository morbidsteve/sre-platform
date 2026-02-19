# SRE Platform Developer Guide

This guide walks you through deploying applications on the Secure Runtime Environment (SRE) platform. It covers everything from initial setup to production deployment, monitoring, and troubleshooting.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [App Templates](#app-templates)
5. [Configuration Reference](#configuration-reference)
6. [Secrets Management](#secrets-management)
7. [Monitoring](#monitoring)
8. [Networking](#networking)
9. [CI/CD Integration](#cicd-integration)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The SRE platform is a hardened Kubernetes environment designed for government and regulated-industry workloads. It satisfies NIST 800-53, CMMC 2.0, FedRAMP, and DISA STIG compliance requirements out of the box, so you do not need to build compliance into your application -- the platform handles it for you.

As a developer, the platform gives you:

- **Pre-built Helm chart templates** that bake in all security and compliance requirements (non-root containers, read-only filesystems, network policies, resource limits)
- **GitOps deployment via Flux CD** -- push a values file to Git, and Flux deploys your app automatically
- **Automatic mTLS** between all services via Istio (zero-trust networking with no code changes)
- **Secrets from OpenBao** delivered as standard Kubernetes Secrets via External Secrets Operator (no SDK required)
- **Built-in monitoring** with Prometheus metrics scraping and Grafana dashboards
- **Centralized logging** with Loki -- your application just needs to write structured JSON to stdout

Your workflow is: build a container image, push it to Harbor, write a small values file, commit it to Git, and Flux takes care of the rest.

---

## Prerequisites

Before deploying an application, confirm the following:

### 1. Tenant namespace

Your team must have a provisioned tenant namespace on the cluster. Each namespace comes with:

- ResourceQuota and LimitRange (resource guardrails)
- Default-deny NetworkPolicies with base allows (DNS, monitoring, Istio gateway, same-namespace, HTTPS egress)
- Istio sidecar injection enabled
- Keycloak-mapped RBAC (developers get `edit`, viewers get `view`)

If your team does not yet have a namespace, request one from the platform team. See the [tenant README](../apps/tenants/team-alpha/README.md) for an example of what gets provisioned.

### 2. Harbor project

Your team needs a project in the internal Harbor registry at `harbor.sre.internal`. All container images must be stored here -- the platform rejects images from any other registry. Your Harbor project provides:

- Trivy vulnerability scanning on every push
- Cosign signature verification
- Robot accounts for CI/CD pipelines

### 3. Tools installed locally

- `kubectl` -- configured to access the SRE cluster
- `helm` (v3.12+) -- for chart linting and local template rendering
- `git` -- for committing deployment configs to the GitOps repo
- `flux` CLI (optional) -- for checking reconciliation status

### 4. Git repo access

You need write access to the SRE GitOps repository where your team's deployment configs live under `apps/tenants/<your-team>/`.

### 5. Keycloak account

You must be a member of your team's Keycloak group (e.g., `team-alpha-developers`) to have `edit` permissions in your namespace.

---

## Quick Start

This walkthrough deploys a web application called `my-api` for `team-alpha` using the `sre-web-app` Helm chart.

### Step 1: Push your image to Harbor

Build and push your container image to the internal registry. The image tag must be a specific version -- `:latest` is blocked by policy.

```bash
docker build -t harbor.sre.internal/team-alpha/my-api:v1.0.0 .
docker push harbor.sre.internal/team-alpha/my-api:v1.0.0
```

Harbor will automatically scan the image with Trivy. If CRITICAL or HIGH vulnerabilities are found, the image will be flagged and Kyverno may block deployment depending on policy configuration.

### Step 2: Create your values file

Create a file at `apps/tenants/team-alpha/my-api/values.yaml`:

```yaml
app:
  name: my-api
  team: team-alpha
  image:
    repository: harbor.sre.internal/team-alpha/my-api
    tag: "v1.0.0"
  port: 8080
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
  probes:
    liveness:
      path: /healthz
      initialDelaySeconds: 10
      periodSeconds: 10
    readiness:
      path: /readyz
      initialDelaySeconds: 5
      periodSeconds: 5
  env: []

ingress:
  enabled: true
  host: my-api.apps.sre.example.com

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilization: 80

serviceMonitor:
  enabled: true
  interval: "30s"
  path: /metrics
```

### Step 3: Create a Flux HelmRelease

Create a file at `apps/tenants/team-alpha/my-api/helmrelease.yaml`:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-api
  namespace: team-alpha
spec:
  interval: 10m
  chart:
    spec:
      chart: sre-web-app
      version: "0.1.0"
      sourceRef:
        kind: HelmRepository
        name: sre-charts
        namespace: flux-system
  install:
    remediation:
      retries: 3
  upgrade:
    cleanupOnFail: true
    remediation:
      retries: 3
  valuesFrom:
    - kind: ConfigMap
      name: my-api-values
      optional: true
  values:
    app:
      name: my-api
      team: team-alpha
      image:
        repository: harbor.sre.internal/team-alpha/my-api
        tag: "v1.0.0"
      port: 8080
      replicas: 2
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
      probes:
        liveness:
          path: /healthz
          initialDelaySeconds: 10
          periodSeconds: 10
        readiness:
          path: /readyz
          initialDelaySeconds: 5
          periodSeconds: 5
      env: []
    ingress:
      enabled: true
      host: my-api.apps.sre.example.com
    autoscaling:
      enabled: true
      minReplicas: 2
      maxReplicas: 10
      targetCPUUtilization: 80
    serviceMonitor:
      enabled: true
      interval: "30s"
      path: /metrics
```

### Step 4: Commit and push

```bash
git add apps/tenants/team-alpha/my-api/
git commit -m "feat(team-alpha): deploy my-api v1.0.0"
git push
```

### Step 5: Verify deployment

Flux will detect the change and reconcile within 10 minutes (or sooner). Check the status:

```bash
# Check Flux reconciliation status
flux get helmreleases -n team-alpha

# Check pod status
kubectl get pods -l app.kubernetes.io/name=my-api -n team-alpha

# View logs
kubectl logs -l app.kubernetes.io/name=my-api -n team-alpha -f

# If ingress is enabled, test the endpoint
curl https://my-api.apps.sre.example.com/healthz
```

Your application is now running with mTLS encryption, network policies, Prometheus monitoring, and all compliance controls active -- without any changes to your application code.

---

## App Templates

The SRE platform provides three Helm chart templates. Choose the one that matches your workload type.

### sre-web-app

**Use for:** HTTP services that serve traffic to users or other services.

**What it creates:**
- Deployment with hardened security context
- Service (ClusterIP)
- ServiceAccount
- HorizontalPodAutoscaler
- PodDisruptionBudget
- NetworkPolicy (ingress from Istio gateway, monitoring, and same-namespace; egress to DNS, same-namespace, and HTTPS)
- ServiceMonitor (Prometheus scraping)
- Istio VirtualService (when ingress is enabled)
- ExternalSecret resources (for any `secretRef` environment variables)

**Best for:** REST APIs, web frontends, GraphQL services, gRPC services with HTTP health checks.

**Example values:**

```yaml
app:
  name: frontend
  team: team-alpha
  image:
    repository: harbor.sre.internal/team-alpha/frontend
    tag: "v2.1.0"
  port: 3000
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: "1"
      memory: 1Gi
  probes:
    liveness:
      path: /healthz
      initialDelaySeconds: 15
      periodSeconds: 10
    readiness:
      path: /readyz
      initialDelaySeconds: 5
      periodSeconds: 5

ingress:
  enabled: true
  host: frontend.apps.sre.example.com
```

### sre-worker

**Use for:** Background processors that consume messages from queues, run async tasks, or perform data processing. Workers do not receive inbound HTTP traffic.

**What it creates:**
- Deployment with hardened security context
- ServiceAccount
- HorizontalPodAutoscaler (disabled by default)
- PodDisruptionBudget
- NetworkPolicy (egress-only: DNS, same-namespace, HTTPS)
- ServiceMonitor (scrapes a separate metrics port, default 9090)

**Key differences from web-app:**
- No Service or VirtualService (no inbound traffic)
- Uses exec-based health probes instead of HTTP (workers often lack HTTP endpoints)
- Metrics exposed on a dedicated port (default: 9090)
- Supports `command` and `args` overrides for the container

**Best for:** Queue consumers, event processors, data pipeline workers, ETL jobs.

**Example values:**

```yaml
app:
  name: order-processor
  team: team-alpha
  image:
    repository: harbor.sre.internal/team-alpha/order-processor
    tag: "v1.3.0"
  replicas: 3
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "1"
      memory: 2Gi
  command:
    - /bin/order-processor
  args:
    - "--queue=orders"
    - "--concurrency=10"
  env:
    - name: QUEUE_URL
      secretRef: order-queue-credentials
  probes:
    liveness:
      exec:
        command:
          - /bin/sh
          - -c
          - "pgrep -f worker || exit 1"
      initialDelaySeconds: 10
      periodSeconds: 30
    readiness:
      exec:
        command:
          - /bin/sh
          - -c
          - "pgrep -f worker || exit 1"
      initialDelaySeconds: 5
      periodSeconds: 10

autoscaling:
  enabled: false

serviceMonitor:
  enabled: true
  port: 9090
  path: /metrics
```

### sre-cronjob

**Use for:** Scheduled tasks that run on a cron schedule. The platform creates a CronJob that runs pods on your defined schedule.

**What it creates:**
- CronJob with hardened security context
- ServiceAccount
- NetworkPolicy (egress-only: DNS, same-namespace, HTTPS)
- ServiceMonitor (optional, disabled by default)

**Key differences from web-app and worker:**
- No Deployment -- uses CronJob instead
- Schedule is defined via standard cron expressions
- Configurable concurrency policy, deadline, backoff, and history retention
- No autoscaling or PodDisruptionBudget (jobs are ephemeral)

**Best for:** Nightly reports, periodic data cleanup, scheduled notifications, database maintenance tasks.

**Example values:**

```yaml
app:
  name: nightly-report
  team: team-alpha
  image:
    repository: harbor.sre.internal/team-alpha/report-generator
    tag: "v1.0.5"
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 4Gi
  command:
    - /bin/generate-report
  args:
    - "--type=daily"
    - "--output=s3"
  env:
    - name: S3_BUCKET
      value: "sre-reports"
    - name: DB_CONNECTION
      secretRef: report-db-credentials

schedule:
  cron: "0 2 * * *"
  timezone: "America/New_York"
  concurrencyPolicy: "Forbid"
  activeDeadlineSeconds: 3600
  backoffLimit: 3
  restartPolicy: "Never"
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
```

---

## Configuration Reference

This section documents the key values you will configure when deploying an application.

### app.name

**Required.** The name of your application. Used for all Kubernetes resource names, labels, and selectors.

```yaml
app:
  name: my-api
```

Rules:
- Must be a valid Kubernetes name (lowercase, alphanumeric, hyphens allowed)
- Must be unique within your namespace
- Keep it short and descriptive

### app.team

**Required.** Your team name. Used for labeling, RBAC mapping, and OpenBao secret path scoping.

```yaml
app:
  team: team-alpha
```

This value must match the team name in your tenant namespace configuration.

### app.image

**Required.** Container image reference. Must point to the internal Harbor registry.

```yaml
app:
  image:
    repository: harbor.sre.internal/team-alpha/my-api
    tag: "v1.0.0"
    pullPolicy: IfNotPresent
```

Rules:
- `repository` must start with `harbor.sre.internal/`. Images from any other registry are rejected by Kyverno.
- `tag` must be a specific version. The value `latest` is explicitly blocked by policy.
- Always quote the tag value to prevent YAML parsing issues (e.g., `"1.0"` not `1.0`).

### app.env

Environment variables for your application. Supports two patterns: plain values and secret references.

**Plain value:**

```yaml
app:
  env:
    - name: LOG_LEVEL
      value: "info"
    - name: APP_ENV
      value: "production"
```

**Secret reference (from OpenBao via ESO):**

```yaml
app:
  env:
    - name: DATABASE_URL
      secretRef: my-api-db-credentials
    - name: API_KEY
      secretRef: my-api-external-key
```

When you use `secretRef`, the chart automatically creates an ExternalSecret resource that syncs the secret from OpenBao into a Kubernetes Secret. See [Secrets Management](#secrets-management) for details.

**Mixed example:**

```yaml
app:
  env:
    - name: LOG_LEVEL
      value: "info"
    - name: DATABASE_URL
      secretRef: my-api-db-credentials
    - name: CACHE_TTL
      value: "300"
    - name: API_KEY
      secretRef: my-api-external-key
```

### app.resources

**Required (has defaults).** CPU and memory requests and limits for your container.

```yaml
app:
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

Guidelines:
- `requests` define the guaranteed resources your pod receives and are used for scheduling.
- `limits` define the maximum resources your pod can use.
- Set requests close to your actual usage to avoid wasting cluster capacity.
- Set limits with headroom for traffic spikes.
- Your namespace has a ResourceQuota -- total requests and limits across all pods cannot exceed the quota (default: 4 CPU / 8Gi requests, 8 CPU / 16Gi limits).
- If you do not specify resources, the namespace LimitRange applies defaults (100m CPU / 128Mi memory requests, 500m CPU / 512Mi memory limits).

### app.replicas

Number of pod replicas when autoscaling is disabled.

```yaml
app:
  replicas: 3
```

When `autoscaling.enabled` is `true`, this value is ignored and the HPA manages replica count.

### app.probes

Health check probes that Kubernetes uses to determine if your pod is alive and ready to receive traffic.

**HTTP probes (web-app):**

```yaml
app:
  probes:
    liveness:
      path: /healthz
      initialDelaySeconds: 10
      periodSeconds: 10
    readiness:
      path: /readyz
      initialDelaySeconds: 5
      periodSeconds: 5
```

- `liveness` -- if this fails, Kubernetes restarts the container. Use a lightweight check that verifies the process is running.
- `readiness` -- if this fails, the pod is removed from the Service endpoints. Use a check that verifies the app can handle requests (e.g., database connection is healthy).
- `initialDelaySeconds` -- how long to wait after container start before probing. Set this high enough for your app to initialize.
- `periodSeconds` -- how often to probe.

**Exec probes (workers):**

```yaml
app:
  probes:
    liveness:
      exec:
        command:
          - /bin/sh
          - -c
          - "pgrep -f worker || exit 1"
      initialDelaySeconds: 10
      periodSeconds: 30
```

Workers without HTTP endpoints use exec probes that check whether the worker process is running.

### ingress

Configures external access to your application via Istio VirtualService. Only available with `sre-web-app`.

```yaml
ingress:
  enabled: true
  host: my-api.apps.sre.example.com
  gateway: "istio-system/sre-gateway"
```

- `enabled` -- set to `true` to create a VirtualService for external traffic.
- `host` -- the hostname your app will be reachable at. DNS must be configured to point to the Istio ingress gateway.
- `gateway` -- the Istio gateway to attach to. The default (`istio-system/sre-gateway`) is the platform's shared gateway. You should not need to change this.

When ingress is disabled, your application is only accessible within the cluster via its ClusterIP Service (e.g., `my-api.team-alpha.svc.cluster.local`).

### autoscaling

Configures the HorizontalPodAutoscaler.

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilization: 80
```

- When enabled, the HPA scales pod count between `minReplicas` and `maxReplicas` based on CPU utilization.
- `targetCPUUtilization` is the percentage of CPU request at which the HPA adds more replicas.
- Set `minReplicas` to at least 2 for high availability.
- Default for `sre-web-app`: enabled. Default for `sre-worker`: disabled.

### serviceMonitor

Configures Prometheus metric scraping.

```yaml
serviceMonitor:
  enabled: true
  interval: "30s"
  path: /metrics
```

- Your application must expose a Prometheus-compatible `/metrics` endpoint.
- The ServiceMonitor tells Prometheus to scrape this endpoint at the configured interval.
- For workers, metrics are scraped from a separate port (default: 9090):

```yaml
serviceMonitor:
  enabled: true
  interval: "30s"
  port: 9090
  path: /metrics
```

### networkPolicy

Controls network access to and from your pods. Enabled by default.

```yaml
networkPolicy:
  enabled: true
  additionalIngress: []
  additionalEgress: []
```

The default policy allows:
- **Ingress from:** Istio gateway (when ingress enabled), Prometheus (monitoring namespace), same-namespace pods
- **Egress to:** DNS (kube-system), same-namespace pods, HTTPS (port 443) to any destination

To add custom rules, use `additionalIngress` and `additionalEgress`. See [Networking](#networking) for details.

### podDisruptionBudget

Ensures your application stays available during node maintenance and cluster upgrades.

```yaml
podDisruptionBudget:
  enabled: true
  minAvailable: 1
```

- `minAvailable: 1` means at least one pod must remain running at all times during voluntary disruptions (node drain, rolling upgrade).
- If you run 2 replicas with `minAvailable: 1`, the cluster can drain one node at a time without downtime.

---

## Secrets Management

The SRE platform uses OpenBao (an open-source Vault-compatible secrets manager) with the External Secrets Operator (ESO) to deliver secrets to your application as standard Kubernetes Secrets. You do not need any SDK or library in your application -- secrets appear as regular environment variables.

### How it works

1. Your platform admin stores a secret in OpenBao at path `sre/<team>/<secret-name>`.
2. You reference the secret in your values file using `secretRef`.
3. The Helm chart creates an ExternalSecret resource.
4. ESO reads the secret from OpenBao and creates a Kubernetes Secret in your namespace.
5. Your pod mounts the Kubernetes Secret as an environment variable.
6. ESO refreshes the secret every hour (configurable).

### Using secretRef in values

```yaml
app:
  env:
    - name: DATABASE_URL
      secretRef: my-api-db-credentials
```

This configuration:
1. Creates an ExternalSecret named `my-api-db-credentials` in your namespace.
2. The ExternalSecret pulls the value from OpenBao at `sre/team-alpha/my-api-db-credentials`.
3. Creates a Kubernetes Secret named `my-api-db-credentials` with key `value`.
4. The pod sees `DATABASE_URL` set to the secret value.

### What the ExternalSecret looks like

The chart generates this resource automatically -- you do not write it:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: my-api-db-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: my-api-db-credentials
  data:
    - secretKey: value
      remoteRef:
        key: sre/team-alpha/my-api-db-credentials
```

### Requesting a secret

To have a secret stored in OpenBao:

1. Submit a request to the platform team with:
   - Secret name (e.g., `my-api-db-credentials`)
   - Team name (e.g., `team-alpha`)
   - Secret value (communicate securely, never via Git or chat)
2. The platform team stores it at `sre/team-alpha/my-api-db-credentials` in OpenBao.
3. Reference it in your values file as shown above.

### Secret rotation

When a secret is updated in OpenBao, ESO automatically syncs the new value to the Kubernetes Secret within the refresh interval (default: 1 hour). However, your pod must be restarted to pick up the new environment variable value. You can trigger a rolling restart:

```bash
kubectl rollout restart deployment/my-api -n team-alpha
```

### Important rules

- Never commit actual secret values to the Git repository.
- Always use `secretRef` for sensitive data -- never use plain `value` for passwords, tokens, or credentials.
- Secret paths follow the convention `sre/<team>/<secret-name>`.

---

## Monitoring

Every application deployed with SRE templates gets automatic Prometheus monitoring. The platform runs kube-prometheus-stack (Prometheus + Grafana + AlertManager) and provides pre-built dashboards.

### Exposing metrics

Your application must expose a Prometheus-compatible metrics endpoint. The default configuration expects:

- **Path:** `/metrics`
- **Port:** Same as `app.port` for web-apps, port `9090` for workers
- **Format:** Prometheus text exposition format

Most language frameworks have Prometheus client libraries:

| Language | Library |
|----------|---------|
| Go | `prometheus/client_golang` |
| Python | `prometheus_client` |
| Java | `micrometer-registry-prometheus` |
| Node.js | `prom-client` |
| Rust | `prometheus` crate |

### ServiceMonitor

The chart creates a ServiceMonitor automatically when `serviceMonitor.enabled` is `true` (the default). This tells Prometheus to scrape your application.

```yaml
serviceMonitor:
  enabled: true
  interval: "30s"
  path: /metrics
```

You can verify the ServiceMonitor is working:

```bash
kubectl get servicemonitor -n team-alpha
```

### Grafana dashboards

Access Grafana at `https://grafana.sre.example.com` (SSO via Keycloak).

Available dashboards:
- **Cluster Health** -- node resource usage, pod counts, API server latency
- **Namespace Overview** -- resource consumption per namespace
- **Istio Traffic** -- request rates, latencies, error rates per service
- **Kyverno Policy Violations** -- policy compliance status
- **NeuVector Security** -- runtime security events

You can create custom dashboards for your application's metrics using Grafana's dashboard editor.

### Viewing logs

Application logs are collected by Alloy and stored in Loki. Access them through Grafana:

1. Open Grafana and navigate to Explore.
2. Select the Loki datasource.
3. Query your app's logs:

```
{namespace="team-alpha", app="my-api"}
```

For structured JSON logs (recommended), you can filter by fields:

```
{namespace="team-alpha", app="my-api"} | json | level="error"
```

Best practice: write structured JSON logs to stdout/stderr. Alloy collects them automatically.

### Alerts

The platform has pre-configured alerts for common issues. You can also request custom PrometheusRules from the platform team for application-specific alerting (e.g., error rate thresholds, latency SLOs).

---

## Networking

The SRE platform enforces a zero-trust network model. Every tenant namespace starts with a default-deny NetworkPolicy, and traffic is only allowed through explicit rules.

### Default network rules

When your namespace is provisioned, these rules are created automatically:

| Rule | Direction | Description |
|------|-----------|-------------|
| `default-deny-all` | Ingress + Egress | Blocks all traffic by default |
| `allow-dns` | Egress | Allows DNS resolution to kube-system (port 53 UDP/TCP) |
| `allow-monitoring` | Ingress | Allows Prometheus scraping from the monitoring namespace |
| `allow-istio-gateway` | Ingress | Allows external traffic through the Istio ingress gateway |
| `allow-same-namespace` | Ingress + Egress | Allows pod-to-pod communication within your namespace |
| `allow-https-egress` | Egress | Allows outbound HTTPS traffic (port 443) to any destination |

In addition, each `sre-web-app` deployment creates its own NetworkPolicy that refines these rules for the specific application.

### Istio mTLS

All pod-to-pod traffic is automatically encrypted with mutual TLS via Istio. The platform enforces `STRICT` mTLS mode cluster-wide. This means:

- All inter-service communication is encrypted in transit.
- Every pod has a unique SPIFFE identity certificate.
- No unencrypted service-to-service traffic is allowed.

You do not need to configure TLS in your application. Istio's sidecar proxy handles it transparently.

### Adding custom network rules

If your application needs to reach a service in another namespace or a non-HTTPS external endpoint, add custom rules via `additionalIngress` or `additionalEgress` in your values.

**Example: Allow egress to a PostgreSQL database in another namespace:**

```yaml
networkPolicy:
  enabled: true
  additionalEgress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: databases
          podSelector:
            matchLabels:
              app: postgresql
      ports:
        - port: 5432
          protocol: TCP
```

**Example: Allow ingress from another team's namespace:**

```yaml
networkPolicy:
  enabled: true
  additionalIngress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: team-beta
          podSelector:
            matchLabels:
              app: upstream-service
      ports:
        - port: 8080
          protocol: TCP
```

**Example: Allow egress to a non-HTTPS external API on port 8443:**

```yaml
networkPolicy:
  enabled: true
  additionalEgress:
    - to:
        - ipBlock:
            cidr: 10.200.0.0/16
      ports:
        - port: 8443
          protocol: TCP
```

### Debugging network issues

If your application cannot reach a service, check these in order:

1. Verify NetworkPolicies allow the traffic:
   ```bash
   kubectl get networkpolicy -n team-alpha
   kubectl describe networkpolicy <policy-name> -n team-alpha
   ```

2. Verify Istio sidecar is injected:
   ```bash
   kubectl get pods -n team-alpha -o jsonpath='{.items[*].spec.containers[*].name}' | tr ' ' '\n' | sort -u
   # Should include "istio-proxy"
   ```

3. Check Istio AuthorizationPolicies:
   ```bash
   kubectl get authorizationpolicy -n team-alpha
   ```

4. Test connectivity from within the pod:
   ```bash
   kubectl exec -it <pod-name> -n team-alpha -c <container-name> -- wget -qO- http://target-service:8080/healthz
   ```

---

## CI/CD Integration

The SRE platform uses a GitOps model. Your CI pipeline builds and pushes images; Flux handles deployment.

### Recommended CI pipeline

The following steps should run in your CI/CD system (GitHub Actions, GitLab CI, Jenkins, etc.):

1. **Build** the container image.
2. **Scan** with Trivy -- fail the pipeline on CRITICAL or HIGH vulnerabilities.
3. **Generate SBOM** with Syft (SPDX + CycloneDX formats).
4. **Sign** the image with Cosign.
5. **Push** to Harbor at `harbor.sre.internal/<team>/<app>:<version>`.
6. **Update** the image tag in your Flux HelmRelease values.
7. **Commit and push** the updated tag to the GitOps repo.

Flux detects the commit and reconciles within its interval (default: 10 minutes).

### Updating the image tag

When you release a new version, update the image tag in your HelmRelease. Change this line:

```yaml
# Before
app:
  image:
    tag: "v1.0.0"

# After
app:
  image:
    tag: "v1.1.0"
```

Commit and push. Flux handles the rolling update automatically.

### Example: GitHub Actions workflow

```yaml
name: Build and Deploy
on:
  push:
    tags:
      - "v*"

env:
  REGISTRY: harbor.sre.internal
  TEAM: team-alpha
  APP: my-api

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: |
          docker build -t $REGISTRY/$TEAM/$APP:${{ github.ref_name }} .

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: "${{ env.REGISTRY }}/${{ env.TEAM }}/${{ env.APP }}:${{ github.ref_name }}"
          exit-code: "1"
          severity: "CRITICAL,HIGH"

      - name: Generate SBOM
        run: |
          syft $REGISTRY/$TEAM/$APP:${{ github.ref_name }} -o spdx-json > sbom.spdx.json

      - name: Sign image
        run: |
          cosign sign --key cosign.key $REGISTRY/$TEAM/$APP:${{ github.ref_name }}

      - name: Push to Harbor
        run: |
          docker push $REGISTRY/$TEAM/$APP:${{ github.ref_name }}

      - name: Update GitOps repo
        run: |
          git clone https://github.com/org/sre-gitops.git
          cd sre-gitops
          sed -i "s/tag: .*/tag: \"${{ github.ref_name }}\"/" \
            apps/tenants/$TEAM/$APP/helmrelease.yaml
          git add .
          git commit -m "feat($TEAM): update $APP to ${{ github.ref_name }}"
          git push
```

### Checking deployment status

After pushing a new image tag:

```bash
# Watch Flux reconciliation
flux get helmreleases -n team-alpha --watch

# Check rollout status
kubectl rollout status deployment/my-api -n team-alpha

# View deployment events
kubectl describe deployment my-api -n team-alpha

# Verify the new image is running
kubectl get pods -n team-alpha -o jsonpath='{.items[*].spec.containers[*].image}'
```

### Rollback

If a deployment fails, Flux automatically retries (up to 3 times by default). For manual rollback, revert the image tag in Git:

```bash
git revert HEAD
git push
```

Flux will reconcile to the previous version.

---

## Troubleshooting

### Pod rejected by admission webhook

**Symptom:** Pod fails to create with a message like `admission webhook "validate.kyverno.svc" denied the request`.

**Common causes:**

1. **Missing security context.** The SRE chart templates handle this automatically, but if you are customizing templates, every pod must include:
   ```yaml
   securityContext:
     runAsNonRoot: true
     seccompProfile:
       type: RuntimeDefault
   containers:
     - securityContext:
         allowPrivilegeEscalation: false
         readOnlyRootFilesystem: true
         runAsNonRoot: true
         capabilities:
           drop:
             - ALL
   ```

2. **Image from disallowed registry.** Only images from `harbor.sre.internal` are allowed. Verify your image repository:
   ```bash
   kubectl get policyreport -n team-alpha -o yaml
   ```

3. **Using `:latest` tag.** The platform blocks the `latest` tag. Always use a specific version.

4. **Missing required labels.** All resources must have `app.kubernetes.io/name`, `sre.io/team`, and other standard labels. The chart templates include these automatically.

**How to investigate:**

```bash
# Check Kyverno policy reports for violations
kubectl get policyreport -n team-alpha -o wide

# Describe the specific policy report for details
kubectl describe policyreport -n team-alpha

# View Kyverno admission events
kubectl get events -n team-alpha --field-selector reason=PolicyViolation
```

### Image pull errors (ImagePullBackOff / ErrImagePull)

**Symptom:** Pod stuck in `ImagePullBackOff` or `ErrImagePull` state.

**Common causes:**

1. **Image does not exist in Harbor.** Verify the image and tag:
   ```bash
   # Check the exact image reference in the pod spec
   kubectl describe pod <pod-name> -n team-alpha | grep "Image:"
   ```

2. **Trivy scan failed.** Harbor may be blocking the image due to critical vulnerabilities. Check Harbor's web UI for scan results.

3. **Cosign signature missing.** Kyverno verifies image signatures. Make sure your CI pipeline signs images with Cosign.

4. **Typo in image repository or tag.** Double-check the `app.image.repository` and `app.image.tag` values.

### Pod stuck in Pending

**Symptom:** Pod remains in `Pending` state and never starts.

**Common causes:**

1. **ResourceQuota exceeded.** Your namespace has CPU and memory limits:
   ```bash
   kubectl describe quota -n team-alpha
   ```
   If you are at the limit, reduce resource requests on existing pods or request a quota increase from the platform team.

2. **Insufficient cluster resources.** The cluster may not have enough capacity. Check node resources:
   ```bash
   kubectl describe nodes | grep -A 5 "Allocated resources"
   ```

3. **PVC not bound.** If your pod requires a PersistentVolumeClaim, verify it is bound:
   ```bash
   kubectl get pvc -n team-alpha
   ```

### Network connectivity issues

**Symptom:** Application cannot reach another service, a database, or an external API.

**Diagnosis steps:**

1. Check if the destination is allowed by NetworkPolicy:
   ```bash
   kubectl get networkpolicy -n team-alpha -o yaml
   ```

2. For cross-namespace traffic, you need a custom rule in `additionalEgress` (see [Networking](#networking)).

3. For non-HTTPS external endpoints (anything not port 443), you need a custom egress rule.

4. Verify the Istio sidecar is not blocking traffic:
   ```bash
   kubectl logs <pod-name> -c istio-proxy -n team-alpha | grep "403"
   ```

### Application crashes on startup (CrashLoopBackOff)

**Symptom:** Pod starts, crashes, and restarts repeatedly.

**Common causes:**

1. **Read-only filesystem.** The SRE security context mounts the root filesystem as read-only. If your application writes to the filesystem (temp files, caches, logs to files), you need to add an `emptyDir` volume for writable paths. Contact the platform team to customize the deployment template.

2. **Probe misconfiguration.** If `initialDelaySeconds` is too short, the liveness probe kills the container before the application finishes starting. Increase `initialDelaySeconds`:
   ```yaml
   app:
     probes:
       liveness:
         path: /healthz
         initialDelaySeconds: 30
   ```

3. **Missing environment variables.** If a required `secretRef` secret does not exist in OpenBao, the ExternalSecret will fail to sync and the Kubernetes Secret will not be created. Check ExternalSecret status:
   ```bash
   kubectl get externalsecret -n team-alpha
   kubectl describe externalsecret <name> -n team-alpha
   ```

4. **Insufficient memory.** If the container is OOM-killed, increase memory limits:
   ```yaml
   app:
     resources:
       limits:
         memory: 1Gi
   ```
   Check if the container was OOM-killed:
   ```bash
   kubectl describe pod <pod-name> -n team-alpha | grep -A 3 "Last State"
   ```

### Flux not reconciling

**Symptom:** You pushed changes to Git but Flux has not picked them up.

**Diagnosis:**

```bash
# Check Flux HelmRelease status
flux get helmreleases -n team-alpha

# Check Flux Kustomization status
flux get kustomizations -A

# View Flux logs for errors
flux logs --kind=HelmRelease --name=my-api -n team-alpha

# Force immediate reconciliation
flux reconcile helmrelease my-api -n team-alpha
```

Common causes:
- Syntax error in the HelmRelease YAML (check Flux logs).
- Chart version mismatch (the pinned version does not exist in the HelmRepository).
- Values schema validation failure (the `values.schema.json` rejected a value).

### Getting help

If you have exhausted these troubleshooting steps:

1. Check the Grafana dashboards for your namespace and application metrics.
2. Review Kyverno policy reports for compliance violations.
3. Check the Loki logs for your pod and the Istio sidecar proxy.
4. Contact the platform team with:
   - Your namespace and application name
   - The output of `kubectl describe pod <pod-name> -n <namespace>`
   - The output of `kubectl get events -n <namespace> --sort-by=.lastTimestamp`
   - The relevant Flux HelmRelease YAML
