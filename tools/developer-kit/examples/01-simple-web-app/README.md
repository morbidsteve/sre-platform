# Example 01: Simple Web App

A minimal "hello world" web application. The simplest possible deployment on the SRE platform -- a single container with external access.

## What This Demonstrates

- Minimum viable bundle configuration
- External ingress via Istio VirtualService
- Small resource allocation (50m/64Mi request, 200m/256Mi limit)
- Automatic mTLS, NetworkPolicy, and sidecar injection

## Bundle Configuration

The `bundle.yaml` in this directory defines the deployment. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `hello-web` | Application name |
| `type` | `web-app` | Standard HTTP service |
| `port` | `3000` | Container listen port |
| `resources` | `small` | Minimal CPU/memory allocation |
| `ingress` | `hello-web.apps.sre.example.com` | External hostname |

## Create Your Bundle

```bash
# 1. Export your container image
docker save hello-web:v1.0.0 -o images/hello-web.tar

# 2. Create the bundle
tar czf hello-web.bundle.tar.gz bundle.yaml images/

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

After the bundle passes the DSOP pipeline, deploy with:

```bash
./scripts/sre-deploy-app.sh \
  --name hello-web \
  --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/hello-web \
  --tag v1.0.0 \
  --port 3000 \
  --ingress hello-web.apps.sre.example.com \
  --resources small
```

## Verify

```bash
# Check pods are running
kubectl get pods -n team-demo -l app.kubernetes.io/name=hello-web

# Test the endpoint
curl -sk https://hello-web.apps.sre.example.com/

# Force immediate reconciliation
flux reconcile kustomization sre-tenants --with-source
```

## What the Platform Provides

All of this is automatic -- no developer configuration needed:

- Istio sidecar injection with mTLS STRICT
- Default-deny NetworkPolicy with platform exceptions
- ServiceAccount with no auto-mounted token
- Non-root security context with dropped capabilities

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
