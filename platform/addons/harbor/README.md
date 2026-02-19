# Harbor Container Registry

Internal container registry with integrated vulnerability scanning, image signing, and SBOM storage. Harbor serves as the SRE platform's own "Iron Bank" -- all container images must pass through Harbor's Trivy scan gate before deployment to the cluster.

## What It Does

- **Trivy vulnerability scanning** on every image push -- blocks images with critical/high CVEs from being deployed
- **Cosign signature verification** on pull -- ensures only signed, trusted images are consumed by workloads
- **Image replication** from upstream registries (Docker Hub, GHCR, Chainguard, and optionally Iron Bank)
- **SBOM storage** in SPDX and CycloneDX formats as OCI artifacts alongside images
- **Robot accounts** for CI/CD pipeline automation (push images, trigger scans, read scan results)
- **Project-based RBAC** for multi-tenant isolation (one project per team)
- **Garbage collection** to reclaim storage from untagged and orphaned image layers
- **Quota and retention policies** per project to control storage consumption

## Architecture

```
Internet / CI Pipeline
        |
   Istio Gateway (TLS termination)
        |
   VirtualService (harbor.apps.sre.example.com)
        |
   +-----------+     +----------+     +----------+
   | Harbor    |---->| Harbor   |---->| S3       |
   | Portal    |     | Core     |     | Storage  |
   +-----------+     +----------+     +----------+
                          |
              +-----------+-----------+
              |           |           |
         +--------+  +--------+  +--------+
         |Registry|  |Jobsvc  |  | Trivy  |
         +--------+  +--------+  +--------+
              |
         +--------+  +--------+
         |Database|  | Redis  |
         +--------+  +--------+
```

## Components

| Resource | Purpose |
|----------|---------|
| `namespace.yaml` | Harbor namespace with Istio sidecar injection |
| `helmrelease.yaml` | Flux HelmRelease for Harbor chart v1.14.2 |
| `virtualservice.yaml` | Istio routing from gateway to Harbor core/portal |
| `network-policies/default-deny.yaml` | Default deny all ingress/egress |
| `network-policies/allow-harbor.yaml` | Explicit allows for required traffic flows |

## Dependencies

- **Istio** -- mTLS between Harbor components, ingress gateway for external access
- **cert-manager** -- TLS certificates for the Istio gateway
- **Monitoring** -- Prometheus ServiceMonitor for Harbor metrics

## Configuration

### Expose Type

Harbor is configured with `expose.type: clusterIP`. Istio handles all external ingress and TLS termination via the VirtualService. Harbor's built-in TLS is disabled because Istio mTLS encrypts all in-cluster traffic.

### Storage Backend

Production deployments use S3-compatible storage for the image registry. Update the S3 configuration in `helmrelease.yaml` or provide values via the `harbor-env-values` ConfigMap:

- `persistence.imageChartStorage.s3.region` -- AWS region or S3-compatible endpoint region
- `persistence.imageChartStorage.s3.bucket` -- Bucket name for image storage
- `persistence.imageChartStorage.s3.accesskey` -- Access key (use `harbor-credentials` Secret instead)
- `persistence.imageChartStorage.s3.secretkey` -- Secret key (use `harbor-credentials` Secret instead)
- `persistence.imageChartStorage.s3.regionendpoint` -- Endpoint URL for S3-compatible storage (MinIO, etc.)

For dev environments using MinIO, set `regionendpoint` to your MinIO service URL.

### Admin Password

The Harbor admin password is injected via the `harbor-credentials` Secret (managed by External Secrets Operator from OpenBao). The Secret must contain:

```yaml
harborAdminPassword: "changeme"
```

### Trivy Scanning

Trivy is enabled by default and scans every image on push. Configure scan severity thresholds in Harbor's UI under **Configuration > Vulnerability**:

- **Prevent vulnerable images from running** -- Block pull of images above a severity threshold
- **Automatically scan images on push** -- Enabled by default
- **Vulnerability database** -- Trivy auto-updates its vulnerability database

### Cosign Integration

Harbor supports Cosign signatures and attestations as OCI artifacts. To use Cosign with Harbor:

1. Generate a Cosign key pair:
   ```bash
   cosign generate-key-pair
   ```

2. Sign images after pushing to Harbor:
   ```bash
   cosign sign --key cosign.key harbor.apps.sre.example.com/team/image:tag
   ```

3. Attach SBOMs as attestations:
   ```bash
   cosign attest --key cosign.key --predicate sbom.spdx.json --type spdxjson \
     harbor.apps.sre.example.com/team/image:tag
   ```

4. Kyverno verifies signatures at admission time via the `verify-image-signatures` ClusterPolicy in `policies/custom/`.

### Replication from Upstream Registries

Configure replication rules in Harbor's UI or API to pull images from trusted upstream sources:

| Source Registry | Purpose |
|----------------|---------|
| Docker Hub (`docker.io`) | Official base images (nginx, postgres, redis) |
| GitHub Container Registry (`ghcr.io`) | Open-source project images |
| Chainguard (`cgr.dev`) | Minimal, hardened base images (distroless) |
| Iron Bank (`registry1.dso.mil`) | DoD-approved images (requires Platform One account) |

Replication policies run on a schedule and pull only specified images/tags. This enables air-gapped deployments by pre-populating Harbor with all required images.

### Robot Accounts

Create robot accounts for CI/CD pipelines that need to push images:

1. Navigate to **Administration > Robot Accounts** in Harbor UI
2. Create an account scoped to specific projects
3. Grant permissions: `push`, `pull`, `create_scan` (no admin access)
4. Store the robot account credentials in OpenBao and sync via ESO

Example CI pipeline usage:
```bash
# Login with robot account
echo "$HARBOR_ROBOT_TOKEN" | docker login harbor.apps.sre.example.com \
  --username "robot\$ci-pipeline" --password-stdin

# Push image
docker push harbor.apps.sre.example.com/team-alpha/my-app:v1.2.3
```

### Metrics

Harbor exposes Prometheus metrics on port 8001 for core, registry, jobservice, and exporter components. A ServiceMonitor is enabled by default and auto-discovered by the monitoring stack.

Key metrics to monitor:
- `harbor_project_total` -- Total number of projects
- `harbor_project_member_total` -- Members per project
- `harbor_project_repo_total` -- Repositories per project
- `harbor_project_quota_usage_byte` -- Storage usage per project
- `harbor_artifact_pulled` -- Image pull count (track usage patterns)
- `harbor_task_concurrency` -- Jobservice task concurrency (scan/replication throughput)

## NIST Controls

| Control | Description | Implementation |
|---------|-------------|----------------|
| CM-2 | Baseline Configuration | Harbor maintains an inventory of approved images; Flux reconciles the desired state |
| SI-3 | Malicious Code Protection | Trivy scans every image for malware, vulnerabilities, and misconfigurations |
| SI-7 | Software Integrity | Cosign signatures verified at push (Harbor) and at admission (Kyverno) |
| SA-11 | Developer Testing | Trivy scan gates block images with critical/high vulnerabilities from deployment |
| RA-5 | Vulnerability Scanning | Automated Trivy scanning on every push with severity-based alerting |
| CM-8 | Component Inventory | SBOM storage tracks all software components across all deployed images |

## Troubleshooting

### Harbor pods not starting

```bash
# Check HelmRelease status
flux get helmrelease harbor -n harbor

# Check pod status
kubectl get pods -n harbor

# Check events for errors
kubectl get events -n harbor --sort-by='.lastTimestamp'

# View Harbor core logs
kubectl logs -n harbor -l component=core --tail=100

# Force Flux reconciliation
flux reconcile helmrelease harbor -n harbor
```

### Image push failures

```bash
# Verify Harbor is accessible through Istio
kubectl exec -n harbor deploy/harbor-core -- curl -s http://localhost:8080/api/v2.0/health

# Check registry component
kubectl logs -n harbor -l component=registry --tail=50

# Verify Istio sidecar is running
kubectl get pods -n harbor -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].name}{"\n"}{end}'
```

### Trivy scan not running

```bash
# Check Trivy adapter logs
kubectl logs -n harbor -l component=trivy-adapter --tail=50

# Verify Trivy database is up to date
kubectl exec -n harbor deploy/harbor-trivy -- trivy --version

# Check jobservice for scan task errors
kubectl logs -n harbor -l component=jobservice --tail=50
```

### Replication failures

```bash
# Check jobservice logs for replication errors
kubectl logs -n harbor -l component=jobservice --tail=100 | grep -i replication

# Verify egress NetworkPolicy allows outbound HTTPS
kubectl get networkpolicy -n harbor

# Test connectivity to upstream registry
kubectl exec -n harbor deploy/harbor-core -- curl -s https://registry-1.docker.io/v2/
```

### Metrics not appearing in Grafana

```bash
# Verify ServiceMonitor is created
kubectl get servicemonitor -n harbor

# Check Prometheus targets
kubectl port-forward -n monitoring svc/prometheus-operated 9090:9090
# Then visit http://localhost:9090/targets and search for "harbor"

# Verify metrics endpoint is responding
kubectl exec -n harbor deploy/harbor-core -- curl -s http://localhost:8001/metrics | head -20
```

### Storage issues

```bash
# Check PVC status
kubectl get pvc -n harbor

# View S3 storage configuration
kubectl get helmrelease harbor -n harbor -o jsonpath='{.spec.values.persistence}'

# Run garbage collection manually (Harbor UI: Administration > Clean Up)
# Or via API:
kubectl exec -n harbor deploy/harbor-core -- \
  curl -s -X POST http://localhost:8080/api/v2.0/system/gc/schedule \
  -H "Content-Type: application/json" \
  -d '{"schedule":{"type":"Manual"}}'
```
