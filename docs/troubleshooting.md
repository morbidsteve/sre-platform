# Troubleshooting Guide

This guide consolidates solutions to common issues when working with the SRE platform. Each section covers symptoms, causes, and fix steps.

---

## Pod Issues

### CrashLoopBackOff

**Symptom:** Pod status shows `CrashLoopBackOff`. Pod restarts repeatedly.

**Causes:**
- Application crashes on startup (missing config, bad entrypoint)
- Application fails health checks
- Read-only filesystem error (app writes to paths that are not writable)
- Non-root enforcement (app tries to bind a privileged port or access root-owned files)

**Fix steps:**

```bash
# Check pod events
kubectl describe pod <pod-name> -n <namespace>

# Check container logs (current crash)
kubectl logs <pod-name> -n <namespace> -c <container-name>

# Check previous crash logs
kubectl logs <pod-name> -n <namespace> -c <container-name> --previous
```

Common fixes:
- If "read-only file system": configure your app to write to `/tmp` or create writable directories in your Dockerfile with correct ownership
- If "permission denied": add `USER 1000` to your Dockerfile
- If "bind: permission denied" on port 80/443: change your app to listen on 8080 or another non-privileged port

### ImagePullBackOff

**Symptom:** Pod status shows `ImagePullBackOff` or `ErrImagePull`.

**Causes:**
- Image name or tag is wrong
- Image does not exist in Harbor
- Harbor credentials are missing or expired
- Kyverno rejects the image registry (not `harbor.sre.internal` or `harbor.apps.sre.example.com`)

**Fix steps:**

```bash
# Check the error detail
kubectl describe pod <pod-name> -n <namespace> | grep -A5 "Events"

# Verify the image exists in Harbor
# Open https://harbor.apps.sre.example.com and search for your image

# Check if an image pull secret exists in your namespace
kubectl get secrets -n <namespace> | grep harbor
```

Common fixes:
- Fix the image name/tag in your HelmRelease values
- Ask the platform team to create a pull secret in your namespace
- If using a public image, ask the platform team to replicate it into Harbor first

### Pending

**Symptom:** Pod stays in `Pending` state and never starts.

**Causes:**
- ResourceQuota exceeded (namespace is at its CPU/memory/pod limit)
- No nodes have enough resources to schedule the pod
- PersistentVolumeClaim cannot be bound

**Fix steps:**

```bash
# Check pod events for scheduling errors
kubectl describe pod <pod-name> -n <namespace>

# Check namespace resource usage
kubectl describe quota -n <namespace>

# Check node resources
kubectl top nodes

# Check PVC status (if pod uses persistent storage)
kubectl get pvc -n <namespace>
```

Common fixes:
- Scale down other workloads to free up quota
- Reduce resource requests in your HelmRelease values
- Request a quota increase from the platform team
- For PVC issues, check that the storage class exists and has capacity

### OOMKilled

**Symptom:** Pod restarts with reason `OOMKilled`. Container exit code 137.

**Causes:**
- Application uses more memory than its `resources.limits.memory` allows
- Memory leak in the application

**Fix steps:**

```bash
# Confirm the OOM kill
kubectl describe pod <pod-name> -n <namespace> | grep -A3 "Last State"

# Check current memory usage
kubectl top pod <pod-name> -n <namespace>
```

Common fixes:
- Increase `resources.limits.memory` in your HelmRelease values
- Profile your application for memory leaks
- For JVM apps, set `-Xmx` to ~75% of the memory limit

---

## Network Issues

### 503 Service Unavailable

**Symptom:** HTTP requests return `503 Service Unavailable`.

**Causes:**
- Backend pods are not ready (failing readiness probes)
- Istio VirtualService misconfigured
- Service port mismatch

**Fix steps:**

```bash
# Check if pods are ready
kubectl get pods -n <namespace> -l app.kubernetes.io/name=<app-name>

# Check the Istio VirtualService
kubectl get virtualservice -n <namespace>

# Check Istio proxy logs for upstream errors
kubectl logs <pod-name> -n <namespace> -c istio-proxy | grep "503"

# Verify the service port matches the container port
kubectl get svc -n <namespace> -o wide
```

Common fixes:
- Fix your readiness probe (ensure the health endpoint returns 200)
- Verify the `app.port` in your HelmRelease matches the port your container listens on
- Wait for the Istio sidecar to become ready (it may take a few seconds after pod startup)

### Connection Refused

**Symptom:** Service-to-service calls fail with "connection refused".

**Causes:**
- Target service is not running
- NetworkPolicy blocks the traffic
- Wrong hostname or port

**Fix steps:**

```bash
# Verify the target service exists and has endpoints
kubectl get endpoints <service-name> -n <target-namespace>

# Check NetworkPolicies
kubectl get networkpolicy -n <namespace>

# Test connectivity from within the pod
kubectl exec -it <pod-name> -n <namespace> -c <container> -- \
  curl -v http://<service-name>.<target-namespace>.svc.cluster.local:<port>/health
```

Common fixes:
- Use the full Kubernetes DNS name: `<service>.<namespace>.svc.cluster.local`
- Ask the platform team to add a NetworkPolicy allowing egress to the target namespace
- For compose-based deployments, use the compose service name (DNS aliases are created automatically)

### DNS Resolution Failures

**Symptom:** "could not resolve host" or DNS lookup timeouts.

**Causes:**
- NetworkPolicy blocks DNS egress (port 53 to kube-system)
- CoreDNS pods are unhealthy
- Incorrect service name

**Fix steps:**

```bash
# Test DNS from within a pod
kubectl exec -it <pod-name> -n <namespace> -c <container> -- \
  nslookup kubernetes.default.svc.cluster.local

# Check if DNS egress is allowed
kubectl get networkpolicy -n <namespace> -o yaml | grep -A10 "allow-dns"

# Check CoreDNS health
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

Common fixes:
- Ensure the `allow-dns` NetworkPolicy exists in your namespace (created by default during onboarding)
- Verify you are using the correct service name

### mTLS Errors

**Symptom:** "upstream connect error" or TLS handshake failures between services.

**Causes:**
- Istio sidecar not injected in one of the communicating pods
- PeerAuthentication set to STRICT but the target pod has no sidecar
- Application making HTTPS calls when Istio already handles mTLS

**Fix steps:**

```bash
# Check that both pods have the Istio sidecar (should show 2/2 READY)
kubectl get pods -n <namespace>

# Verify namespace has Istio injection enabled
kubectl get namespace <namespace> -o jsonpath='{.metadata.labels.istio-injection}'

# Check PeerAuthentication policies
kubectl get peerauthentication -A
```

Common fixes:
- Ensure the namespace has the `istio-injection: enabled` label
- Restart pods to pick up the sidecar: `kubectl rollout restart deployment/<name> -n <namespace>`
- Remove any TLS/HTTPS configuration from your application -- Istio handles mTLS transparently; your app should make plain HTTP calls

---

## Build Issues

### Kaniko Build Failures

**Symptom:** In-cluster build job fails when deploying via "Deploy from Git".

**Causes:**
- Dockerfile COPY references files outside the build context
- Multi-stage builds use index references instead of named stages
- Build requires Docker socket access (not available in Kaniko)
- Base image cannot be pulled

**Fix steps:**

```bash
# Check build job logs
kubectl logs -n sre-builds -l job-name=<build-job-name>

# Check build job status
kubectl get jobs -n sre-builds
```

Common fixes:
- Use named stages in multi-stage builds: `FROM node:20 AS builder`
- Ensure all COPY paths are within the build context directory
- Remove any Docker-in-Docker requirements
- Pin base image tags (`:latest` is not allowed)

### Trivy Scan Failures

**Symptom:** Image push to Harbor succeeds but shows CRITICAL/HIGH vulnerabilities.

**Causes:**
- Base image has known CVEs
- Application dependencies have vulnerabilities

**Fix steps:**

```bash
# Scan locally before pushing
trivy image <your-image>:<tag>

# Check Harbor scan results
# Open https://harbor.apps.sre.example.com > your project > your image > Vulnerabilities tab
```

Common fixes:
- Update your base image to the latest patched version
- Update application dependencies (`npm audit fix`, `pip install --upgrade`, etc.)
- Use minimal base images: distroless, Alpine, or Chainguard
- If a CVE cannot be fixed, document it and request a policy exception

### Cosign Signing Errors

**Symptom:** `cosign sign` fails or Kyverno rejects the image due to missing signature.

**Causes:**
- Wrong Cosign key or password
- Image was pushed to a different registry than the one being signed
- Cosign key not registered in the Kyverno imageVerify policy

**Fix steps:**

```bash
# Verify the image is signed
cosign verify --key cosign.pub <registry>/<team>/<image>:<tag>

# Check Kyverno policy for the expected key
kubectl get clusterpolicy verify-image-signatures -o yaml
```

Common fixes:
- Use the correct Cosign key provided by the platform team
- Sign the image at the exact registry/repository/tag path
- Ask the platform team to register your public key in the Kyverno policy

---

## Policy Issues

### Kyverno Admission Denials

**Symptom:** `kubectl apply` or Flux HelmRelease fails with a Kyverno policy violation message.

**Causes:**
- Container runs as root
- Missing required labels
- Image from a disallowed registry
- Image uses `:latest` tag
- Missing security context
- Missing resource limits

**Fix steps:**

```bash
# Check the denial message (it tells you exactly what to fix)
kubectl get events -n <namespace> --field-selector reason=PolicyViolation

# Check policy reports for existing violations
kubectl get policyreport -n <namespace> -o wide

# Check cluster-wide policy reports
kubectl get clusterpolicyreport
```

**Common violations and fixes:**

| Violation | Fix |
|-----------|-----|
| "container must run as non-root" | Add `USER 1000` to your Dockerfile |
| "image registry is not allowed" | Push your image to `harbor.sre.internal` or `harbor.apps.sre.example.com` |
| ":latest tag is not allowed" | Use a specific version tag like `v1.0.0` |
| "missing required labels" | Add `app.kubernetes.io/name` and `sre.io/team` labels (SRE Helm charts do this automatically) |
| "resource limits are required" | Set `resources.requests` and `resources.limits` in your deployment spec |
| "privilege escalation not allowed" | Set `allowPrivilegeEscalation: false` in your security context |

### Security Context Errors

**Symptom:** Pod rejected due to security context requirements.

**Fix:** If using SRE Helm chart templates (`sre-web-app`, `sre-worker`, `sre-cronjob`), security contexts are set automatically. If deploying raw manifests, ensure your pod spec includes:

```yaml
spec:
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

---

## Flux / GitOps Issues

### HelmRelease Not Ready

**Symptom:** `kubectl get helmrelease -n <namespace>` shows `False` in the READY column.

**Causes:**
- Values do not match the chart's `values.schema.json`
- Dependency HelmRelease is not ready
- Chart version does not exist
- Helm install/upgrade failed

**Fix steps:**

```bash
# Check the HelmRelease status message
kubectl get helmrelease <name> -n <namespace> -o yaml | grep -A10 "status:"

# Check Flux logs for the HelmRelease
flux logs --kind=HelmRelease --name=<name> -n <namespace>

# Force reconciliation
flux reconcile helmrelease <name> -n <namespace>
```

Common fixes:
- Fix values to match the chart schema
- Check that all `dependsOn` HelmReleases are healthy
- Verify the chart version exists in the HelmRepository

### Kustomization Reconciliation Failures

**Symptom:** `flux get kustomizations` shows a failed reconciliation.

**Causes:**
- YAML syntax error in manifests
- Resource conflict (two manifests define the same resource)
- Missing namespace

**Fix steps:**

```bash
# Check all kustomization statuses
flux get kustomizations -A

# Check specific kustomization
flux logs --kind=Kustomization --name=<name>

# Validate YAML locally
kubectl apply --dry-run=client -f <manifest.yaml>
```

Common fixes:
- Fix YAML syntax errors
- Ensure namespaces are created before resources that use them
- Check for duplicate resource definitions

### Changes Not Deploying

**Symptom:** You pushed changes to Git but they are not reflected in the cluster.

**Causes:**
- Flux reconciliation interval has not elapsed (default: 10 minutes)
- Git source is pointing to a different branch
- Kustomization is suspended

**Fix steps:**

```bash
# Check if kustomizations are suspended
flux get kustomizations -A | grep suspended

# Force immediate reconciliation
flux reconcile source git flux-system
flux reconcile kustomization <name> --with-source

# Check the Git source
flux get sources git -A
```

---

## Access Issues

### OIDC Login Failures

**Symptom:** `kubectl` commands fail with authentication errors or the browser login does not complete.

**Causes:**
- kubelogin not installed or not in PATH
- OIDC client ID or secret is wrong
- Keycloak is unreachable
- Token expired and refresh failed

**Fix steps:**

```bash
# Verify kubelogin is installed
kubectl oidc-login --version

# Test OIDC connectivity
curl -s https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration | head -5

# Clear cached tokens and re-authenticate
rm -rf ~/.kube/cache/oidc-login/
kubectl get pods  # Triggers fresh login
```

Common fixes:
- Install kubelogin (see [Getting Started](getting-started-developer.md#install-tools))
- Verify the OIDC issuer URL, client ID, and secret in your kubeconfig
- Check that your Keycloak account is active and MFA is configured

### kubectl Permission Denied

**Symptom:** `kubectl` returns "forbidden" errors.

**Causes:**
- User is not in the correct Keycloak group
- RoleBinding does not exist in the namespace
- Attempting to access a resource outside your namespace

**Fix steps:**

```bash
# Check what you can do
kubectl auth can-i --list -n <namespace>

# Check your identity
kubectl auth whoami

# Verify RoleBindings exist
kubectl get rolebinding -n <namespace>
```

Common fixes:
- Ask your team lead to add you to the `<team>-developers` Keycloak group
- Verify you are targeting the correct namespace: `kubectl config get-contexts`

### Harbor Push Permission Denied

**Symptom:** `docker push` to Harbor fails with "unauthorized" or "denied".

**Causes:**
- Robot account credentials are wrong or expired
- Robot account does not have push permissions for the project
- Docker login session expired

**Fix steps:**

```bash
# Re-authenticate
docker login harbor.apps.sre.example.com -u "robot\$<team>+ci" -p "<token>"

# Test with a small image
docker pull alpine:3.19
docker tag alpine:3.19 harbor.apps.sre.example.com/<team>/test:v1
docker push harbor.apps.sre.example.com/<team>/test:v1
```

Common fixes:
- Get fresh robot account credentials from the platform team
- Ensure you escape the `$` in the robot username: `robot\$team+ci`
- Verify the Harbor project exists for your team

---

## Getting More Help

If your issue is not covered here:

1. Check the pod events: `kubectl describe pod <pod-name> -n <namespace>`
2. Check Flux logs: `flux logs --kind=HelmRelease --name=<name> -n <namespace>`
3. Check Kyverno reports: `kubectl get policyreport -n <namespace> -o wide`
4. Check Grafana dashboards for metrics and logs
5. Contact the platform team with the output from the commands above
