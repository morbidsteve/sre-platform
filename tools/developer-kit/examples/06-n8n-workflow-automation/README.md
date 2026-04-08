# Example 06: n8n -- Workflow Automation Platform

Deploys [n8n](https://n8n.io) as a self-hosted workflow automation tool. Demonstrates deploying an application that requires root access, which triggers a Kyverno PolicyException.

## What This Demonstrates

- Deploying an app that requires root (`runAsNonRoot: false` in bundle)
- Automatic Kyverno PolicyException generation by the operator
- Non-standard port (5678)
- Relaxing `readOnlyRootFilesystem` for apps that write to disk
- Startup probe for slow-starting Node.js apps
- Persistent volume for workflow data

## Bundle Configuration

The `bundle.yaml` in this directory defines the deployment. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `n8n` | Application name |
| `port` | `5678` | n8n's default HTTP port |
| `storage.enabled` | `true` | 5Gi PVC for workflow data |
| `storage.mountPath` | `/root/.n8n` | n8n's default data directory |
| `security.runAsNonRoot` | `false` | n8n's process manager requires root |
| `security.readOnlyRootFilesystem` | `false` | n8n writes workflow data and temp files |

When the operator sees `runAsNonRoot: false`, they generate a Kyverno PolicyException alongside the HelmRelease.

## Create Your Bundle

```bash
# 1. Export your container image
docker save n8nio/n8n:1.64.0 -o images/n8n.tar

# 2. Create the bundle
tar czf n8n.bundle.tar.gz bundle.yaml images/

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
- Kyverno PolicyException scoped to this app only

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
