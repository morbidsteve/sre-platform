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

## What Happens After You Submit

1. Upload your `.bundle.tar.gz` through the DSOP Wizard in the dashboard
2. The platform automatically scans your image for vulnerabilities and secrets
3. An ISSM (security reviewer) reviews and approves the deployment
4. Your app goes live with HTTPS, monitoring, and logging -- all automatic

Check deployment status in the dashboard under **Applications**.

## For SRE Operators

Deployment is managed entirely through the **SRE Dashboard**:

1. The developer uploads their bundle through the **Deploy tab** (DSOP Wizard)
2. Review the pipeline run in the **Security tab** → Pipeline Runs
3. Approve as ISSM if security exceptions are requested
4. Monitor the deployment in the **Applications tab**
5. Use the **Operations Cockpit** (click any app → Cockpit) for diagnostics, logs, restart, and scaling

No command-line tools needed.

## What the Platform Provides

All of this is automatic -- no developer configuration needed:

- Istio sidecar injection with mTLS STRICT
- Default-deny NetworkPolicy with platform exceptions
- TLS certificate for the ingress hostname
- Prometheus monitoring and centralized logging

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
