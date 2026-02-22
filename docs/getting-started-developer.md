# Getting Started: Deploy Your App to SRE

This guide takes you from zero to a running application on the Secure Runtime Environment. It covers every tool you need to install, how to get credentials, how to build a compliant container image, and how to integrate with platform services.

**Audience:** Application developers deploying workloads to the SRE platform.

**Prerequisites:** Your team must already have an SRE tenant namespace. If not, ask your platform team to follow the [Onboarding Guide](onboarding-guide.md) first.

---

## Table of Contents

1. [Install Tools](#install-tools)
2. [Get Your Credentials](#get-your-credentials)
3. [Connect to the Cluster](#connect-to-the-cluster)
4. [Build a Compliant Container Image](#build-a-compliant-container-image)
5. [Push to Harbor](#push-to-harbor)
6. [Deploy with the SRE Helm Chart](#deploy-with-the-sre-helm-chart)
7. [Integrate with Platform Services](#integrate-with-platform-services)
8. [Set Up CI/CD](#set-up-cicd)
9. [Common Tasks](#common-tasks)

---

## Install Tools

Install these on your local machine (macOS, Linux, or Windows). All tools are free and open-source.

> **Windows users:** We recommend using [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) (Windows Subsystem for Linux) with Ubuntu. Once inside WSL2, follow the **Linux** instructions below. Alternatively, native Windows install commands are provided where available.

### Required

| Tool | Purpose | Minimum Version |
|------|---------|-----------------|
| `kubectl` | Interact with the Kubernetes cluster | 1.28+ |
| `kubelogin` | OIDC authentication for kubectl | 0.0.30+ |
| `helm` | Chart linting and local template rendering | 3.12+ |
| `docker` | Build and push container images | 24+ |
| `git` | Commit deployment configs to the GitOps repo | 2.30+ |

**kubectl:**
```bash
# macOS
brew install kubectl

# Linux / WSL2
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# Windows (native — PowerShell as Administrator)
# winget install Kubernetes.kubectl
```

**kubelogin** (OIDC authentication plugin for kubectl):
```bash
# macOS
brew install int128/kubelogin/kubelogin

# Linux / WSL2
curl -LO "https://github.com/int128/kubelogin/releases/latest/download/kubelogin_linux_amd64.zip"
unzip kubelogin_linux_amd64.zip && sudo mv kubelogin /usr/local/bin/kubectl-oidc_login
rm kubelogin_linux_amd64.zip

# Windows (native — PowerShell)
# Download from https://github.com/int128/kubelogin/releases (kubelogin_windows_amd64.zip)
# Rename kubelogin.exe to kubectl-oidc_login.exe and add to your PATH
```

**helm:**
```bash
# macOS
brew install helm

# Linux / WSL2
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Windows (native — PowerShell as Administrator)
# winget install Helm.Helm
```

**docker:**
```bash
# macOS
brew install --cask docker    # Docker Desktop

# Linux (Ubuntu/Debian) / WSL2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER  # Log out and back in after this

# Windows (native)
# Install Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/
# winget install Docker.DockerDesktop
# Enable WSL2 integration in Docker Desktop settings for best performance
```

**git:**
```bash
# macOS (included with Xcode CLI tools)
xcode-select --install

# Linux / WSL2
sudo apt-get install git    # Debian/Ubuntu
sudo dnf install git        # RHEL/Rocky

# Windows (native — PowerShell as Administrator)
# winget install Git.Git
```

### Recommended

| Tool | Purpose |
|------|---------|
| `flux` | Check GitOps reconciliation status |
| `cosign` | Sign container images (required for CI/CD) |
| `trivy` | Scan images for vulnerabilities locally |
| `syft` | Generate SBOMs (required for CI/CD) |

**flux CLI:**
```bash
# macOS
brew install fluxcd/tap/flux

# Linux / WSL2
curl -s https://fluxcd.io/install.sh | bash

# Windows (native — PowerShell as Administrator)
# winget install FluxCD.Flux
```

**cosign** (image signing):
```bash
# macOS
brew install cosign

# Linux / WSL2
curl -LO "https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64"
chmod +x cosign-linux-amd64 && sudo mv cosign-linux-amd64 /usr/local/bin/cosign

# Windows (native — PowerShell as Administrator)
# winget install sigstore.cosign
```

**trivy** (vulnerability scanning):
```bash
# macOS
brew install trivy

# Linux / WSL2
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Windows (native — PowerShell)
# Download from https://github.com/aquasecurity/trivy/releases (trivy_*_windows-64bit.zip)
# Extract and add to your PATH
```

**syft** (SBOM generation):
```bash
# macOS
brew install syft

# Linux / WSL2
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Windows (native — PowerShell)
# Download from https://github.com/anchore/syft/releases (syft_*_windows_amd64.zip)
# Extract and add to your PATH
```

### Verify installation

```bash
kubectl version --client
kubectl oidc-login --version
helm version
docker version
git version
flux version --client      # optional
cosign version             # optional
trivy version              # optional
syft version               # optional
```

---

## Get Your Credentials

You need three sets of credentials. Your platform team provides all of these during onboarding.

### 1. Keycloak account

Your identity on the platform. Used for:
- kubectl access (via OIDC)
- Grafana dashboards
- Harbor web UI

**What you receive from the platform team:**
- Keycloak URL (e.g., `https://keycloak.sre.example.com`)
- Realm name (e.g., `sre`)
- Your username and initial password
- MFA setup instructions

**Action:** Log into Keycloak, change your password, and configure MFA (required).

### 2. Harbor robot account

Used for pushing container images from your local machine or CI/CD pipeline.

**What you receive from the platform team:**
- Harbor URL (e.g., `https://harbor.sre.internal`)
- Robot account username (e.g., `robot$team-alpha+ci`)
- Robot account token

**Action:** Test the credentials:
```bash
docker login harbor.sre.internal -u "robot\$team-alpha+ci" -p "YOUR_ROBOT_TOKEN"
```

Note the backslash before `$` -- the `$` in the robot account name must be escaped in most shells.

### 3. Cosign signing key (for CI/CD)

Used to cryptographically sign your container images. Kyverno on the cluster verifies these signatures before allowing deployment.

**What you receive from the platform team:**
- `cosign.key` (private key file, keep secure)
- `cosign.pub` (public key, already registered in the Kyverno policy)
- Key password

**Action:** Store the private key securely. In CI/CD, use it as a secret:
```bash
# Test locally
cosign sign --key cosign.key harbor.sre.internal/team-alpha/my-app:v1.0.0
```

If your organization uses keyless signing (Sigstore/Fulcio), the platform team will provide those instructions instead.

---

## Connect to the Cluster

### Configure kubectl with OIDC

The SRE platform uses Keycloak as the OIDC provider for kubectl authentication. The `kubelogin` plugin handles the browser-based login flow.

**Your platform team will provide a kubeconfig file or these values:**
- Cluster API server URL
- CA certificate (or a flag to skip verification for lab environments)
- OIDC issuer URL
- OIDC client ID and client secret

Set up your kubeconfig:

```bash
# Set the cluster
kubectl config set-cluster sre-platform \
  --server=https://api.sre.example.com:6443 \
  --certificate-authority=/path/to/ca.crt

# Set credentials using kubelogin (OIDC)
kubectl config set-credentials sre-oidc \
  --exec-api-version=client.authentication.k8s.io/v1beta1 \
  --exec-command=kubectl \
  --exec-arg=oidc-login \
  --exec-arg=get-token \
  --exec-arg=--oidc-issuer-url=https://keycloak.sre.example.com/realms/sre \
  --exec-arg=--oidc-client-id=kubernetes \
  --exec-arg=--oidc-client-secret=REPLACE_ME

# Set the context with your team's namespace as default
kubectl config set-context sre \
  --cluster=sre-platform \
  --user=sre-oidc \
  --namespace=team-alpha

# Use the context
kubectl config use-context sre
```

### Test the connection

```bash
# This will open a browser window for Keycloak login
kubectl get pods
```

The first time you run a kubectl command, kubelogin opens your browser for Keycloak authentication. After login, the token is cached locally and refreshed automatically.

### Verify your permissions

```bash
# Should succeed (you have 'edit' role in your namespace)
kubectl auth can-i create deployments

# Should fail (you cannot modify other namespaces)
kubectl auth can-i create deployments -n kube-system

# Check your namespace details
kubectl get namespace team-alpha --show-labels
kubectl describe quota team-alpha-quota
```

---

## Build a Compliant Container Image

SRE enforces strict container security policies. Your image must meet these requirements or Kyverno will reject it at deploy time.

### Requirements checklist

- [ ] Runs as a non-root user (UID >= 1000)
- [ ] Does not require a writable root filesystem (use tmpfs for temp files)
- [ ] Does not require any Linux capabilities
- [ ] Exposes a health check endpoint (`/healthz` for liveness, `/readyz` for readiness)
- [ ] Exposes a Prometheus metrics endpoint (`/metrics`)
- [ ] Writes logs as structured JSON to stdout/stderr
- [ ] Uses a minimal base image (distroless, Alpine, or Chainguard)

### Example Dockerfile

```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM gcr.io/distroless/static-debian12:nonroot

# Copy the binary
COPY --from=builder /app/server /server

# Run as non-root user (65532 is the 'nonroot' user in distroless)
USER 65532:65532

# Expose application port
EXPOSE 8080

ENTRYPOINT ["/server"]
```

Key points:
- Multi-stage build keeps the final image small
- `distroless/static:nonroot` has no shell, no package manager, minimal attack surface
- `USER 65532:65532` ensures the container runs as non-root
- No writable filesystem needed (the binary runs from read-only root)

### For applications that need temp files

If your app writes temporary files, the SRE Helm chart mounts an `emptyDir` volume at `/tmp`. Your application should write temp files there:

```dockerfile
# In your application code, use /tmp for any temporary files
ENV TMPDIR=/tmp
```

### Build and scan locally

```bash
# Build
docker build -t harbor.sre.internal/team-alpha/my-app:v1.0.0 .

# Scan for vulnerabilities (same check that Harbor runs)
trivy image harbor.sre.internal/team-alpha/my-app:v1.0.0

# Verify it runs as non-root
docker run --rm harbor.sre.internal/team-alpha/my-app:v1.0.0 whoami
# Should output: nonroot (or a UID like 65532)
```

Fix any CRITICAL or HIGH vulnerabilities before pushing. Harbor may block images with unfixed critical CVEs.

---

## Push to Harbor

```bash
# Log in to the internal registry
docker login harbor.sre.internal -u "robot\$team-alpha+ci" -p "YOUR_ROBOT_TOKEN"

# Push the image
docker push harbor.sre.internal/team-alpha/my-app:v1.0.0

# Sign the image (required by Kyverno policy)
cosign sign --key cosign.key harbor.sre.internal/team-alpha/my-app:v1.0.0

# Generate and attach an SBOM (recommended)
syft harbor.sre.internal/team-alpha/my-app:v1.0.0 -o spdx-json > sbom.spdx.json
cosign attach sbom --sbom sbom.spdx.json harbor.sre.internal/team-alpha/my-app:v1.0.0
```

### Verify in Harbor

1. Open `https://harbor.sre.example.com` and log in
2. Navigate to your project (`team-alpha`)
3. Confirm the image shows a green checkmark for the Trivy scan
4. Confirm the image shows a signature icon for the Cosign signature

---

## Deploy with the SRE Helm Chart

The SRE platform provides pre-built Helm chart templates that include all required security contexts, network policies, monitoring, and compliance controls.

### Choose your chart

| Chart | Use Case | Creates |
|-------|----------|---------|
| `sre-web-app` | HTTP services (APIs, web frontends) | Deployment, Service, VirtualService, HPA, PDB, NetworkPolicy, ServiceMonitor |
| `sre-worker` | Background processors (queue consumers) | Deployment, HPA, PDB, NetworkPolicy, ServiceMonitor |
| `sre-cronjob` | Scheduled jobs (reports, cleanup) | CronJob, NetworkPolicy |

### Deploy a web application

Create the deployment files in the GitOps repository:

```bash
mkdir -p apps/tenants/team-alpha/apps/my-app
```

Create `apps/tenants/team-alpha/apps/my-app/helmrelease.yaml`:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-app
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
  values:
    app:
      name: my-app
      team: team-alpha
      image:
        repository: harbor.sre.internal/team-alpha/my-app
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
        readiness:
          path: /readyz
          initialDelaySeconds: 5
      env:
        - name: LOG_LEVEL
          value: "info"
        # Secrets from OpenBao (see "Integrate with Platform Services" below)
        # - name: DATABASE_URL
        #   secretRef: my-app-db-credentials

    ingress:
      enabled: true
      host: my-app.apps.sre.example.com

    autoscaling:
      enabled: true
      minReplicas: 2
      maxReplicas: 10
      targetCPUUtilization: 80

    serviceMonitor:
      enabled: true
      interval: "30s"
      path: /metrics

    networkPolicy:
      enabled: true

    podDisruptionBudget:
      enabled: true
      minAvailable: 1
```

### Commit and deploy

```bash
git add apps/tenants/team-alpha/apps/my-app/
git commit -m "feat(team-alpha): deploy my-app v1.0.0"
git push
```

Flux detects the change and deploys your application within 10 minutes.

### Watch the deployment

```bash
# Watch Flux reconcile
flux get helmreleases -n team-alpha --watch

# Watch pods start
kubectl get pods -n team-alpha -w

# Check the deployment
kubectl rollout status deployment/my-app -n team-alpha
```

A healthy pod shows `2/2 READY` -- your container plus the Istio sidecar.

---

## Integrate with Platform Services

The SRE platform provides several services that your application integrates with. Most require zero code changes; some require a metrics endpoint or structured log format.

### Istio Service Mesh (automatic)

**What it does:** Encrypts all traffic between your pods and other services with mutual TLS. Provides traffic routing, retries, and observability.

**What you need to do:** Nothing. The Istio sidecar is automatically injected into every pod in your namespace. All pod-to-pod traffic is encrypted.

**Calling other services:** Use the Kubernetes DNS name:
```
http://other-service.team-alpha.svc.cluster.local:8080
```

The Istio sidecar handles mTLS transparently. Your application makes plain HTTP calls; the sidecar encrypts them.

**Debugging Istio issues:**
```bash
# Verify sidecar is injected (should show istio-proxy container)
kubectl describe pod <pod-name> -n team-alpha | grep istio-proxy

# Check Istio proxy status
kubectl exec <pod-name> -n team-alpha -c istio-proxy -- pilot-agent request GET /stats | grep upstream_cx
```

### Prometheus Monitoring (expose /metrics)

**What it does:** Scrapes metrics from your application and stores them in Prometheus. Visualized in Grafana.

**What you need to do:** Expose a Prometheus-compatible `/metrics` endpoint on your application port.

Choose a Prometheus client library for your language:

```
Go:       go get github.com/prometheus/client_golang/prometheus
Python:   pip install prometheus-client
Java:     io.micrometer:micrometer-registry-prometheus
Node.js:  npm install prom-client
Rust:     cargo add prometheus
```

**Minimal Go example:**
```go
import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    http.Handle("/metrics", promhttp.Handler())
    http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })
    http.ListenAndServe(":8080", nil)
}
```

**Verify metrics are being scraped:**
```bash
# Port-forward to your pod and check the endpoint
kubectl port-forward deployment/my-app 8080:8080 -n team-alpha
curl http://localhost:8080/metrics

# Check the ServiceMonitor exists
kubectl get servicemonitor -n team-alpha

# Query in Grafana: go to Explore > Prometheus > run:
# up{namespace="team-alpha", job="my-app"}
```

### Loki Logging (write JSON to stdout)

**What it does:** Collects all container logs (stdout/stderr) and stores them in Loki. Queryable via Grafana.

**What you need to do:** Write structured JSON logs to stdout. Alloy (the log collector) picks them up automatically.

**Recommended log format:**
```json
{"timestamp":"2024-01-15T10:30:00Z","level":"info","msg":"request handled","method":"GET","path":"/api/users","status":200,"duration_ms":45}
```

**Why JSON:** Loki can parse JSON fields, letting you filter by level, status code, or any other field:

```
# In Grafana Explore > Loki datasource:
{namespace="team-alpha", container="my-app"} | json | level="error"
{namespace="team-alpha", container="my-app"} | json | status >= 500
{namespace="team-alpha", container="my-app"} | json | duration_ms > 1000
```

**Plain text logs work too** -- they just cannot be filtered by field. If you cannot change your log format immediately, your logs will still be collected and searchable by text.

### OpenBao Secrets (via secretRef)

**What it does:** Delivers secrets from OpenBao (Vault-compatible) to your pod as environment variables. No SDK required.

**What you need to do:**

1. Ask the platform team to store your secret in OpenBao at path `sre/team-alpha/my-app-db-credentials`
2. Reference it in your HelmRelease values:

```yaml
app:
  env:
    - name: DATABASE_URL
      secretRef: my-app-db-credentials
```

3. Your application reads `DATABASE_URL` as a normal environment variable:

```go
dbURL := os.Getenv("DATABASE_URL")
```

**How it works under the hood:**
1. The Helm chart creates an ExternalSecret resource
2. External Secrets Operator (ESO) reads the secret from OpenBao
3. ESO creates a standard Kubernetes Secret in your namespace
4. The secret is mounted as an environment variable in your pod
5. ESO refreshes the secret every hour

**After a secret rotation**, restart your pods to pick up the new value:
```bash
kubectl rollout restart deployment/my-app -n team-alpha
```

### Tempo Distributed Tracing (automatic via Istio)

**What it does:** Captures distributed traces across services. Visualized in Grafana.

**What you get for free:** Istio generates trace spans for all inbound and outbound HTTP requests automatically. You can see request flow across services in Grafana without any code changes.

**For richer traces** (adding custom spans within your application), use an OpenTelemetry SDK:

```
Go:       go.opentelemetry.io/otel
Python:   pip install opentelemetry-api opentelemetry-sdk
Java:     io.opentelemetry:opentelemetry-api
Node.js:  npm install @opentelemetry/api @opentelemetry/sdk-node
```

Configure the OTLP exporter to send traces to the collector:
```yaml
app:
  env:
    - name: OTEL_EXPORTER_OTLP_ENDPOINT
      value: "http://tempo-distributor.tracing.svc.cluster.local:4317"
    - name: OTEL_SERVICE_NAME
      value: "my-app"
```

### Network Policies (automatic, customizable)

**What you get by default:**

| Direction | Allowed |
|-----------|---------|
| Ingress | From Istio gateway (external traffic), from monitoring (Prometheus), from same namespace |
| Egress | To DNS (kube-system:53), to same namespace, to any destination on port 443 (HTTPS) |
| Everything else | **Blocked** |

**If your app needs to reach a database in another namespace:**

Add `additionalEgress` in your HelmRelease values:
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

**If another team's app needs to call your service:**

Add `additionalIngress`:
```yaml
networkPolicy:
  enabled: true
  additionalIngress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: team-beta
      ports:
        - port: 8080
          protocol: TCP
```

---

## Set Up CI/CD

The SRE platform uses a GitOps model: your CI pipeline builds and pushes images, then Flux handles deployment.

### Required CI pipeline steps

```
Build image → Scan with Trivy → Generate SBOM → Sign with Cosign → Push to Harbor → Update GitOps repo
```

### GitHub Actions example

Create `.github/workflows/deploy.yml` in your application repository:

```yaml
name: Build and Deploy to SRE
on:
  push:
    tags:
      - "v*"

env:
  REGISTRY: harbor.sre.internal
  TEAM: team-alpha
  APP: my-app

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Log in to Harbor
        run: |
          echo "${{ secrets.HARBOR_TOKEN }}" | docker login $REGISTRY \
            -u "${{ secrets.HARBOR_USER }}" --password-stdin

      - name: Build image
        run: |
          docker build -t $REGISTRY/$TEAM/$APP:${{ github.ref_name }} .

      - name: Scan with Trivy
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: "${{ env.REGISTRY }}/${{ env.TEAM }}/${{ env.APP }}:${{ github.ref_name }}"
          exit-code: "1"
          severity: "CRITICAL,HIGH"

      - name: Push image
        run: |
          docker push $REGISTRY/$TEAM/$APP:${{ github.ref_name }}

      - name: Generate SBOM
        uses: anchore/sbom-action@v0
        with:
          image: "${{ env.REGISTRY }}/${{ env.TEAM }}/${{ env.APP }}:${{ github.ref_name }}"
          format: spdx-json
          output-file: sbom.spdx.json

      - name: Sign image with Cosign
        env:
          COSIGN_KEY: ${{ secrets.COSIGN_KEY }}
          COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}
        run: |
          echo "$COSIGN_KEY" > /tmp/cosign.key
          cosign sign --key /tmp/cosign.key \
            $REGISTRY/$TEAM/$APP:${{ github.ref_name }}
          rm /tmp/cosign.key

      - name: Attach SBOM
        env:
          COSIGN_KEY: ${{ secrets.COSIGN_KEY }}
          COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}
        run: |
          echo "$COSIGN_KEY" > /tmp/cosign.key
          cosign attach sbom --sbom sbom.spdx.json \
            $REGISTRY/$TEAM/$APP:${{ github.ref_name }}
          rm /tmp/cosign.key

      - name: Update GitOps repo
        env:
          GITOPS_TOKEN: ${{ secrets.GITOPS_TOKEN }}
        run: |
          git clone https://x-access-token:${GITOPS_TOKEN}@github.com/morbidsteve/sre-platform.git gitops
          cd gitops
          # Update the image tag in the HelmRelease
          sed -i 's|tag: "v[0-9]*\.[0-9]*\.[0-9]*"|tag: "${{ github.ref_name }}"|' \
            apps/tenants/$TEAM/apps/$APP/helmrelease.yaml
          git config user.name "CI Bot"
          git config user.email "ci@sre.example.com"
          git add .
          git commit -m "feat($TEAM): update $APP to ${{ github.ref_name }}"
          git push
```

### Required GitHub Secrets

| Secret | Value | Source |
|--------|-------|--------|
| `HARBOR_USER` | `robot$team-alpha+ci` | Platform team |
| `HARBOR_TOKEN` | Robot account token | Platform team |
| `COSIGN_KEY` | Contents of `cosign.key` | Platform team |
| `COSIGN_PASSWORD` | Cosign key password | Platform team |
| `GITOPS_TOKEN` | GitHub PAT with repo access | Your GitHub account settings |

---

## Common Tasks

### Update your application

1. Build and push a new image tag:
   ```bash
   docker build -t harbor.sre.internal/team-alpha/my-app:v1.1.0 .
   docker push harbor.sre.internal/team-alpha/my-app:v1.1.0
   cosign sign --key cosign.key harbor.sre.internal/team-alpha/my-app:v1.1.0
   ```

2. Update the tag in your HelmRelease:
   ```yaml
   app:
     image:
       tag: "v1.1.0"  # was "v1.0.0"
   ```

3. Commit and push. Flux handles the rolling update.

### Rollback a deployment

Revert the Git commit:
```bash
git revert HEAD
git push
```

Flux reconciles to the previous version automatically.

### Check your resource usage

```bash
kubectl describe quota team-alpha-quota -n team-alpha
kubectl top pods -n team-alpha
```

### View your application logs

```bash
# Real-time via kubectl
kubectl logs -f deployment/my-app -n team-alpha

# Historical via Grafana > Explore > Loki
# Query: {namespace="team-alpha", container="my-app"}
```

### Restart your application

```bash
kubectl rollout restart deployment/my-app -n team-alpha
```

### Debug a failing pod

```bash
# Check pod events
kubectl describe pod <pod-name> -n team-alpha

# Check container logs
kubectl logs <pod-name> -n team-alpha -c my-app

# Check Istio sidecar logs (for network issues)
kubectl logs <pod-name> -n team-alpha -c istio-proxy

# Check Kyverno policy violations
kubectl get policyreport -n team-alpha -o wide

# Exec into the container (if the image has a shell)
kubectl exec -it <pod-name> -n team-alpha -c my-app -- /bin/sh
```

---

## What Happens Automatically

When you deploy using the SRE Helm chart templates, the platform provides all of this without any additional configuration:

| Feature | How It Works |
|---------|-------------|
| **Encrypted traffic (mTLS)** | Istio sidecar encrypts all pod-to-pod communication |
| **Network isolation** | Default-deny NetworkPolicy with explicit allows |
| **Image verification** | Kyverno verifies Cosign signatures before allowing pods |
| **Non-root enforcement** | Kyverno blocks any pod running as root |
| **Resource limits** | Enforced by LimitRange and ResourceQuota |
| **Prometheus metrics** | ServiceMonitor scrapes your `/metrics` endpoint |
| **Log collection** | Alloy collects stdout/stderr and sends to Loki |
| **Distributed tracing** | Istio generates trace spans automatically |
| **Auto-scaling** | HPA scales pods based on CPU utilization |
| **Disruption protection** | PDB ensures minimum availability during upgrades |
| **Drift detection** | Flux reconciles any manual changes back to Git state |
| **Automated rollback** | Flux retries failed upgrades and can rollback automatically |

---

## Further Reading

- [Developer Guide](developer-guide.md) -- Full reference for all values and configuration options
- [Onboarding Guide](onboarding-guide.md) -- What gets provisioned when your team namespace is created
- [Operator Guide](operator-guide.md) -- Day-2 operations and troubleshooting runbooks
- [Architecture](architecture.md) -- Full platform architecture and design decisions
