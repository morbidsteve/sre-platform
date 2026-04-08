# Example 02: App with Database

A todo application backed by PostgreSQL with SSO and secrets management. Demonstrates persistent storage, database credentials via OpenBao, and custom health probes.

## What This Demonstrates

- Database service provisioning (PostgreSQL)
- SSO integration via Keycloak
- Secret references for credentials (synced from OpenBao)
- Persistent storage and custom health probes
- Medium resource allocation (250m/256Mi request, 1000m/1Gi limit)

## Bundle Configuration

The `bundle.yaml` in this directory defines the deployment. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `todo-app` | Application name |
| `port` | `8080` | Container listen port |
| `resources` | `medium` | Moderate CPU/memory allocation |
| `database.enabled` | `true` | Requests a PostgreSQL instance |
| `database.size` | `small` | Database resource tier |
| `sso.enabled` | `true` | Keycloak OIDC integration |
| `DATABASE_URL` | `secret: todo-db-creds` | Credential pulled from OpenBao |
| `ingress` | `todo.apps.sre.example.com` | External hostname |

## Create Your Bundle

```bash
# 1. Export your container image
docker save todo-app:v2.0.0 -o images/todo-app.tar

# 2. Create the bundle
tar czf todo-app.bundle.tar.gz bundle.yaml images/

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
  --name todo-app \
  --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/todo-app \
  --tag v2.0.0 \
  --port 8080 \
  --ingress todo.apps.sre.example.com \
  --resources medium \
  --persist /app/data:5Gi \
  --env DATABASE_URL=postgres://todo:changeme@todo-db:5432/todo?sslmode=disable \
  --liveness /healthz \
  --readiness /readyz
```

## Verify

```bash
# Check pods and PVC
kubectl get pods -n team-demo -l app.kubernetes.io/name=todo-app
kubectl get pvc -n team-demo

# Test the endpoint and health probes
curl -sk https://todo.apps.sre.example.com/
curl -sk https://todo.apps.sre.example.com/healthz
```

## What the Platform Provides

- Istio mTLS and sidecar injection
- PersistentVolumeClaim for `/app/data` (survives pod restarts)
- ExternalSecret syncing database credentials from OpenBao
- Keycloak OIDC client registration (when SSO enabled)
- Default-deny NetworkPolicy with platform exceptions

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
