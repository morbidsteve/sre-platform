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

## For SRE Operators

After the bundle passes the DSOP pipeline, deploy with:

```bash
./scripts/sre-deploy-app.sh \
  --name n8n \
  --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/n8n \
  --tag v1.64.0 \
  --port 5678 \
  --ingress n8n.apps.sre.example.com \
  --resources small \
  --run-as-root \
  --writable-root \
  --persist /root/.n8n:5Gi \
  --startup-probe /healthz \
  --liveness /healthz \
  --readiness /healthz
```

The `--run-as-root` flag generates two files:
- `n8n.yaml` -- the HelmRelease
- `n8n-policy-exception.yaml` -- Kyverno PolicyException allowing root

## Verify

```bash
# Check pods (startup probe allows up to 150s)
kubectl get pods -n team-demo -l app.kubernetes.io/name=n8n

# Check the PolicyException was created
kubectl get policyexception -n team-demo

# Check PVC was bound
kubectl get pvc -n team-demo

# Test the endpoint
curl -sk https://n8n.apps.sre.example.com/healthz
```

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
