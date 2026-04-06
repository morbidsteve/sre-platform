# Example 05: Gitea -- Self-Hosted Git Server

Deploys [Gitea](https://gitea.io) as a self-hosted Git server. Demonstrates deploying a stateful third-party application with persistent storage and a startup probe for slow initialization.

## What This Demonstrates

- Persistent storage for stateful applications (10Gi for Git repos)
- Startup probe for slow-starting apps (Gitea takes 30-60s on first run)
- Relaxing `readOnlyRootFilesystem` for apps that write temp files and caches
- Non-standard port (3000)

## Bundle Configuration

The `bundle.yaml` in this directory defines the deployment. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `gitea` | Application name |
| `port` | `3000` | Gitea's default HTTP port |
| `storage.enabled` | `true` | 10Gi PVC for Git repository data |
| `storage.mountPath` | `/var/lib/gitea` | Gitea's data directory |
| `security.readOnlyRootFilesystem` | `false` | Gitea writes temp files and caches |

## Create Your Bundle

```bash
# 1. Export your container image
docker save gitea/gitea:1.22-rootless -o images/gitea.tar

# 2. Create the bundle
tar czf gitea.bundle.tar.gz bundle.yaml images/

# 3. Submit to your SRE platform operator
```

Or use the visual builder: open `bundle-builder.html` in your browser.

## For SRE Operators

After the bundle passes the DSOP pipeline, deploy with:

```bash
./scripts/sre-deploy-app.sh \
  --name gitea \
  --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/gitea \
  --tag v1.22-rootless \
  --port 3000 \
  --ingress gitea.apps.sre.example.com \
  --resources small \
  --writable-root \
  --persist /var/lib/gitea:10Gi \
  --startup-probe /
```

## Verify

```bash
# Check pods (startup probe allows up to 150s)
kubectl get pods -n team-demo -l app.kubernetes.io/name=gitea

# Check PVC was bound
kubectl get pvc -n team-demo

# Test the endpoint
curl -sk https://gitea.apps.sre.example.com/
```

## What the Platform Provides

All of this is automatic -- no developer configuration needed:

- Istio sidecar injection with mTLS STRICT
- Default-deny NetworkPolicy with platform exceptions
- TLS certificate for the ingress hostname
- Prometheus monitoring and centralized logging

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
