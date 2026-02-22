# Team Onboarding Guide

This guide walks through the complete process of onboarding a new team to the Secure Runtime Environment (SRE) platform -- from requesting a namespace to deploying your first application.

---

## Overview

When a new team is onboarded to SRE, the platform team provisions a dedicated namespace with the following resources already configured:

| Resource | Purpose |
|----------|---------|
| **Namespace** | Isolated workspace with Istio sidecar injection enabled |
| **RBAC RoleBindings** | Developer and viewer access mapped to Keycloak groups |
| **ResourceQuota** | Hard limits on CPU, memory, pods, services, and PVCs |
| **LimitRange** | Default and maximum container resource allocations |
| **NetworkPolicies** | Default deny-all with explicit allows for DNS, monitoring, Istio, same-namespace, and HTTPS egress |

Every workload deployed into your namespace automatically receives:

- Istio sidecar proxy for mTLS encryption (zero-trust pod-to-pod communication)
- Prometheus metric scraping via ServiceMonitor
- Kyverno policy enforcement (image registry restrictions, security contexts, required labels)
- Network isolation via default-deny NetworkPolicies

You do not need to configure any of this yourself. The platform handles it.

---

## Prerequisites

Before the onboarding process begins, the following must be in place:

### 1. Keycloak Groups

The platform team must create two Keycloak groups for your team:

| Group Name | Purpose |
|------------|---------|
| `<team-name>-developers` | Members who can create, update, and delete resources in the namespace |
| `<team-name>-viewers` | Members who have read-only access to the namespace |

Contact the identity administrator or submit a request through your organization's access management process. All team members must have active Keycloak accounts with MFA enabled before they can access the cluster.

### 2. Harbor Project

A Harbor project must be created at `harbor.sre.internal/<team-name>/` where your team will push container images. The Harbor administrator will:

- Create the project with your team name
- Enable Trivy vulnerability scanning (automatic on push)
- Configure a robot account for your CI/CD pipeline
- Set image retention and quota policies

### 3. Team Details

Gather the following information before submitting your onboarding request:

| Field | Description | Example |
|-------|-------------|---------|
| Team name | Lowercase, alphanumeric with hyphens | `team-alpha` |
| Developer group | Keycloak group for developers | `team-alpha-developers` |
| Viewer group | Keycloak group for viewers | `team-alpha-viewers` |
| CPU requests | Total CPU cores your team needs (requests) | `4` |
| Memory requests | Total memory your team needs (requests) | `8Gi` |
| CPU limits | Maximum CPU cores across all pods | `8` |
| Memory limits | Maximum memory across all pods | `16Gi` |
| Max pods | Maximum number of pods in the namespace | `20` |
| Max services | Maximum number of Services | `10` |
| Max PVCs | Maximum number of PersistentVolumeClaims | `10` |

---

## Step 1: Request a Namespace

Submit a namespace request to the platform team. Include all of the information listed in the prerequisites above.

The platform team will review the request and verify:

- The Keycloak groups exist and have the correct members
- The Harbor project is created and accessible
- The requested resource quotas are reasonable for your workload
- There are no naming conflicts with existing namespaces

Once approved, the platform team provisions your namespace as described in Step 2.

---

## Step 2: Namespace Provisioning

This section describes what the platform team creates on your behalf. You do not need to do any of this yourself, but understanding what is provisioned helps with troubleshooting.

All resources are defined as YAML manifests committed to the GitOps repository under `apps/tenants/<team-name>/`. Flux CD automatically reconciles these to the cluster.

### Namespace

A dedicated Kubernetes namespace is created with Istio sidecar injection enabled. This means every pod in your namespace will automatically get an Istio sidecar proxy for mTLS.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team-alpha
  labels:
    istio-injection: enabled
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: team-alpha
    sre.io/network-policy-configured: "true"
```

Key labels:
- `istio-injection: enabled` -- Tells Istio to inject the sidecar proxy into every pod
- `sre.io/team` -- Identifies which team owns this namespace
- `sre.io/network-policy-configured` -- Indicates NetworkPolicies are in place (required by Kyverno)

### RBAC RoleBindings

Two RoleBindings are created, mapping Keycloak groups to Kubernetes ClusterRoles:

```yaml
# Developers can manage most resources in their namespace
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: team-alpha-developers
  namespace: team-alpha
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: team-alpha-developers
---
# Viewers have read-only access
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: team-alpha-viewers
  namespace: team-alpha
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: team-alpha-viewers
```

| Keycloak Group | ClusterRole | What You Can Do |
|----------------|-------------|-----------------|
| `<team>-developers` | `edit` | Create, update, and delete Deployments, Services, ConfigMaps, Secrets, and most other namespace-scoped resources |
| `<team>-viewers` | `view` | Read-only access to all resources in the namespace |

Neither role grants access to modify RBAC, ResourceQuotas, LimitRanges, or NetworkPolicies. Those are managed by the platform team.

### ResourceQuota

A ResourceQuota caps the total resource consumption for the entire namespace:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-alpha-quota
  namespace: team-alpha
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "20"
    services: "10"
    persistentvolumeclaims: "10"
```

These are hard limits. If you attempt to create a resource that would exceed the quota, the API server will reject it. To check your current usage:

```bash
kubectl describe quota team-alpha-quota -n team-alpha
```

If your team needs higher limits, submit a quota increase request to the platform team with a justification for the additional resources.

### LimitRange

A LimitRange sets default and maximum resource values for individual containers:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: team-alpha-limits
  namespace: team-alpha
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "2"
        memory: 4Gi
      min:
        cpu: 50m
        memory: 64Mi
```

| Setting | CPU | Memory | What It Means |
|---------|-----|--------|---------------|
| Default request | 100m | 128Mi | Applied if your container does not specify `resources.requests` |
| Default limit | 500m | 512Mi | Applied if your container does not specify `resources.limits` |
| Maximum | 2 cores | 4Gi | No single container can request more than this |
| Minimum | 50m | 64Mi | No container can request less than this |

It is strongly recommended to always set explicit `resources.requests` and `resources.limits` in your Helm values rather than relying on defaults.

### NetworkPolicies

Your namespace starts with a **default deny-all** policy that blocks all ingress and egress traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

On top of this, explicit allow rules are created for essential traffic:

**DNS resolution** -- Your pods can reach kube-system for name resolution:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
```

**Prometheus monitoring** -- The monitoring namespace can scrape metrics from your pods:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-monitoring
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
```

**Istio ingress gateway** -- External traffic routed through the Istio gateway can reach your pods:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-istio-gateway
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: istio-system
          podSelector:
            matchLabels:
              istio: gateway
```

**Same-namespace communication** -- Pods within your namespace can talk to each other:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
```

**HTTPS egress** -- Your pods can make outbound HTTPS calls (port 443) to any destination:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-https-egress
  namespace: team-alpha
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
          protocol: TCP
```

If your application needs additional network access (for example, a database in another namespace or a non-HTTPS external service), work with the platform team to add a custom NetworkPolicy.

---

## Step 3: Access Your Namespace

Once provisioning is complete, the platform team will notify you. To access your namespace:

### Configure kubectl

1. **Install kubelogin** -- The SRE platform uses Keycloak OIDC for authentication. The `kubelogin` plugin handles the browser-based login flow. This replaces the deprecated `--auth-provider=oidc` flag that was removed in Kubernetes 1.26+.

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

2. **Configure your kubeconfig.** The platform team will provide the cluster details and OIDC credentials:

   ```bash
   kubectl config set-cluster sre-platform \
     --server=https://api.sre.example.com:6443 \
     --certificate-authority=/path/to/ca.crt

   kubectl config set-credentials sre-oidc \
     --exec-api-version=client.authentication.k8s.io/v1beta1 \
     --exec-command=kubectl \
     --exec-arg=oidc-login \
     --exec-arg=get-token \
     --exec-arg=--oidc-issuer-url=https://keycloak.sre.example.com/realms/sre \
     --exec-arg=--oidc-client-id=kubernetes \
     --exec-arg=--oidc-client-secret=REPLACE_ME

   kubectl config set-context sre \
     --cluster=sre-platform \
     --user=sre-oidc \
     --namespace=<team-name>

   kubectl config use-context sre
   ```

   The first time you run a kubectl command, kubelogin will open your browser for Keycloak authentication. After login, the token is cached locally and refreshed automatically.

   Your platform team may provide a pre-configured kubeconfig file instead of these individual commands. See the [Developer Getting Started Guide](getting-started-developer.md#connect-to-the-cluster) for more detail.

2. Set your default namespace so you do not need to pass `-n <team-name>` on every command:

   ```bash
   kubectl config set-context --current --namespace=<team-name>
   ```

### Verify Access

Run the following commands to confirm everything is working:

```bash
# Verify you can list pods (should return empty or "No resources found")
kubectl get pods

# Verify the namespace exists with correct labels
kubectl get namespace <team-name> --show-labels

# Check your ResourceQuota
kubectl describe quota <team-name>-quota

# Check your LimitRange
kubectl describe limitrange <team-name>-limits

# Check NetworkPolicies
kubectl get networkpolicy

# Verify Istio injection is enabled
kubectl get namespace <team-name> -o jsonpath='{.metadata.labels.istio-injection}'
# Expected output: enabled
```

If any of these commands fail with a permissions error, verify that you are a member of the correct Keycloak group and that your OIDC token is valid.

---

## Step 4: Push Your First Image

All container images must be hosted in the internal Harbor registry. Images from external registries (Docker Hub, GitHub Container Registry, etc.) will be rejected by Kyverno admission policies.

### Tag and Push

```bash
# Tag your locally built image for the internal registry
docker tag my-app:v1.0.0 harbor.sre.internal/<team-name>/my-app:v1.0.0

# Log in to Harbor
docker login harbor.sre.internal

# Push the image
docker push harbor.sre.internal/<team-name>/my-app:v1.0.0
```

### CI/CD Pipeline

For automated builds, use the robot account provided by the Harbor administrator. Your CI pipeline should:

1. Build the container image
2. Run a Trivy vulnerability scan (fail on CRITICAL or HIGH findings)
3. Generate an SBOM with Syft
4. Sign the image with Cosign
5. Push to `harbor.sre.internal/<team-name>/<app-name>:<tag>`

Kyverno policies on the cluster require that all images:
- Come from `harbor.sre.internal` (other registries are blocked)
- Have a pinned version tag (`:latest` is blocked)
- Are signed with a valid Cosign signature

### Verify the Image

After pushing, verify the image is available and scanned in Harbor:

1. Open the Harbor UI at `https://harbor.sre.example.com`
2. Navigate to your project (`<team-name>`)
3. Confirm the image appears with a Trivy scan result
4. Verify the image is signed (green shield icon)

---

## Step 5: Deploy Your First App

SRE provides standardized Helm chart templates that bake in all required compliance and security configurations. For a web application, use the `sre-web-app` chart.

### 1. Create Your Values File

Create a `values.yaml` file for your application:

```yaml
app:
  name: my-service
  team: team-alpha
  image:
    repository: harbor.sre.internal/team-alpha/my-service
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
  env: []
  # To use secrets from OpenBao via External Secrets Operator:
  # env:
  #   - name: DATABASE_URL
  #     secretRef: my-service-db
  probes:
    liveness:
      path: /healthz
      initialDelaySeconds: 10
      periodSeconds: 10
    readiness:
      path: /readyz
      initialDelaySeconds: 5
      periodSeconds: 5

ingress:
  enabled: true
  host: my-service.apps.sre.example.com
  gateway: "istio-system/sre-gateway"

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

Key points:
- `app.image.repository` must start with `harbor.sre.internal/`
- `app.image.tag` must be a pinned version (never `latest`)
- `app.probes` must be set -- Kubernetes uses these to determine pod health
- `ingress.enabled: true` creates an Istio VirtualService for external access

### 2. Create a Flux HelmRelease

Create a HelmRelease manifest that tells Flux to deploy your app using the sre-web-app chart:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-service
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
    remediation:
      retries: 3
  values:
    app:
      name: my-service
      team: team-alpha
      image:
        repository: harbor.sre.internal/team-alpha/my-service
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
        readiness:
          path: /readyz
    ingress:
      enabled: true
      host: my-service.apps.sre.example.com
```

### 3. Commit and Push

Place both files under `apps/tenants/<team-name>/apps/` in the GitOps repository and commit:

```bash
git add apps/tenants/team-alpha/apps/my-service/
git commit -m "feat(team-alpha): deploy my-service v1.0.0"
git push
```

Flux watches the repository and will automatically reconcile the HelmRelease, deploying your application to the cluster.

---

## Step 6: Verify Deployment

After pushing your changes, verify that the deployment succeeded.

### Check Pod Status

```bash
# Watch pods come up (Ctrl+C to exit)
kubectl get pods -n <team-name> -w

# Check that the Istio sidecar was injected (should show 2/2 READY)
kubectl get pods -n <team-name>

# View pod details if something is not right
kubectl describe pod <pod-name> -n <team-name>

# Check logs
kubectl logs <pod-name> -n <team-name> -c my-service
```

A healthy pod will show `2/2` in the READY column -- one container for your application and one for the Istio sidecar proxy.

### Check Flux Reconciliation Status

```bash
# Check HelmRelease status
kubectl get helmrelease -n <team-name>

# View detailed status
kubectl describe helmrelease my-service -n <team-name>
```

The HelmRelease should show `Ready: True` when the deployment is complete.

### Access Via Istio Gateway

If you enabled ingress, your application is accessible through the Istio gateway at the hostname you configured:

```bash
# Test from within the cluster
kubectl run curl-test --rm -it --image=curlimages/curl:8.5.0 -- \
  curl -H "Host: my-service.apps.sre.example.com" http://istio-ingressgateway.istio-system.svc.cluster.local

# Test externally (once DNS is configured)
curl https://my-service.apps.sre.example.com/healthz
```

### Check Metrics in Grafana

Your application's metrics are automatically scraped by Prometheus if you enabled the ServiceMonitor. To view them:

1. Open Grafana at `https://grafana.sre.example.com`
2. Log in with your Keycloak credentials
3. Navigate to **Explore** and select the **Prometheus** data source
4. Query your application metrics, for example: `up{namespace="<team-name>"}`

Pre-built dashboards for namespace resource usage, pod health, and Istio traffic are available in the **SRE Platform** dashboard folder.

### Check Kyverno Policy Compliance

```bash
# View policy reports for your namespace
kubectl get policyreport -n <team-name>

# View detailed report
kubectl describe policyreport -n <team-name>
```

Any policy violations will appear here. Fix them before considering your deployment production-ready.

---

## What You Get

Every workload deployed into your SRE namespace automatically receives the following security controls without any additional configuration:

| Control | What It Does | NIST 800-53 |
|---------|-------------|-------------|
| **Istio mTLS** | All pod-to-pod traffic is encrypted via mutual TLS | SC-8 |
| **Network isolation** | Default deny-all with explicit allow rules | AC-4, SC-7 |
| **Image verification** | Only signed images from Harbor are allowed | SI-7, SA-10 |
| **Registry restriction** | Only `harbor.sre.internal` images are permitted | CM-11 |
| **No latest tags** | All images must have pinned version tags | CM-2 |
| **Security contexts** | Pods must run as non-root, drop all capabilities, read-only rootfs | AC-6 |
| **Resource limits** | Every container has CPU and memory limits enforced | SC-6 |
| **Required labels** | All resources must have standard identification labels | CM-8 |
| **Prometheus monitoring** | Metrics are collected automatically via ServiceMonitor | SI-4, CA-7 |
| **Centralized logging** | stdout/stderr logs are collected by Alloy and stored in Loki | AU-2, AU-12 |
| **Distributed tracing** | Istio generates trace data automatically, stored in Tempo | AU-3 |
| **Pod disruption budgets** | Rolling updates maintain minimum availability | CP-10 |
| **Horizontal autoscaling** | Pods scale based on CPU utilization | SC-6 |

---

## FAQ

### How do I get access to the cluster?

You need to be a member of your team's Keycloak group (`<team>-developers` or `<team>-viewers`). Contact your team lead to request group membership. Once added, follow the kubectl configuration steps in Step 3.

### Can I use images from Docker Hub or other public registries?

No. Kyverno policies enforce that all images must come from `harbor.sre.internal`. If you need a public image (for example, a database or cache), ask the platform team to replicate it into Harbor. Harbor will scan it with Trivy and make it available at `harbor.sre.internal/<team-name>/<image-name>:<tag>`.

### Why is my pod showing 2/2 containers?

The second container is the Istio sidecar proxy (`istio-proxy`). It handles mTLS encryption, traffic routing, and telemetry collection automatically. You do not need to interact with it directly.

### My pod is stuck in Pending. What do I do?

Check if you have exceeded the ResourceQuota:

```bash
kubectl describe quota <team-name>-quota -n <team-name>
```

If you are at the limit, either scale down existing workloads or request a quota increase from the platform team.

### My pod was rejected by admission control. How do I fix it?

Check the Kyverno policy report for details:

```bash
kubectl get policyreport -n <team-name> -o yaml
```

Common reasons for rejection:
- **Missing required labels** -- Add `app.kubernetes.io/name`, `sre.io/team`, and other required labels. The sre-web-app chart handles this automatically.
- **Disallowed image registry** -- Your image must come from `harbor.sre.internal`.
- **Using :latest tag** -- Pin your image to a specific version tag.
- **Missing security context** -- Your pod must run as non-root, drop all capabilities, and use a read-only root filesystem. The sre-web-app chart handles this automatically.
- **Missing resource limits** -- Specify `resources.requests` and `resources.limits`. The LimitRange provides defaults, but explicit values are recommended.

### My application needs to connect to a service in another namespace. How?

The default NetworkPolicies only allow traffic within your namespace and to/from platform services. To communicate with another namespace, the platform team must create an additional NetworkPolicy. Submit a request specifying:
- Source namespace and pod labels
- Destination namespace and pod labels
- Port and protocol

### How do I use secrets from OpenBao?

Use the External Secrets Operator (ESO). Add a `secretRef` entry to the `env` section of your Helm values:

```yaml
app:
  env:
    - name: DATABASE_URL
      secretRef: my-service-db
```

The sre-web-app chart automatically creates an ExternalSecret that syncs the value from OpenBao at the path `sre/<team-name>/<secret-name>`. Ask the platform team to create the corresponding secret in OpenBao.

### How do I update my application?

1. Build and push a new image tag to Harbor (for example, `v1.1.0`)
2. Update the `app.image.tag` value in your HelmRelease manifest
3. Commit and push to the GitOps repository
4. Flux detects the change and performs a rolling update automatically

### How do I view logs for my application?

Application logs (stdout/stderr) are collected by Alloy and stored in Loki. To view them:

1. Open Grafana at `https://grafana.sre.example.com`
2. Go to **Explore** and select the **Loki** data source
3. Use this query: `{namespace="<team-name>", container="<app-name>"}`

You can also use kubectl for real-time logs:

```bash
kubectl logs -f <pod-name> -n <team-name> -c <app-name>
```

### How do I request a quota increase?

Submit a request to the platform team with:
- Current quota usage (`kubectl describe quota -n <team-name>`)
- Requested new limits
- Justification (new services, increased traffic, etc.)

### What Helm chart templates are available?

| Chart | Use Case |
|-------|----------|
| `sre-web-app` | HTTP services with external or internal ingress |
| `sre-worker` | Background processors with no ingress |
| `sre-cronjob` | Scheduled jobs |

Each chart includes all required security contexts, NetworkPolicies, ServiceMonitors, and PodDisruptionBudgets. Use these charts instead of writing your own Kubernetes manifests to ensure compliance.

### Who do I contact for help?

- **Namespace provisioning, quota changes, network policy changes** -- Platform team
- **Keycloak access and group membership** -- Identity administrator
- **Harbor project setup and robot accounts** -- Platform team
- **OpenBao secrets** -- Platform team
- **Application deployment issues** -- Check the FAQ above first, then contact the platform team
