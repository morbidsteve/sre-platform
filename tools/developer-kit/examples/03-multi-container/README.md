# Example 03: Multi-Container Application

An order processing system with three components: API service, background worker, and database migration cron job. Demonstrates multi-component bundles using different chart templates.

## What This Demonstrates

- Multiple components in a single bundle (API + worker + cron job)
- Different chart templates (`api-service`, `worker`, `cronjob`)
- External API access declarations (egress to `api.stripe.com`)
- Database and Redis service provisioning
- Secret references for API keys

## Bundle Configuration

The `bundle.yaml` in this directory defines three components. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `order-service` | System name |
| `app.type` | `web-app` | Primary API component |
| `app.port` | `8080` | API listen port |
| `components[0]` | `order-worker` (worker) | Background queue processor |
| `components[1]` | `db-migrate` (cronjob) | Nightly database migration |
| `database.size` | `medium` | PostgreSQL instance |
| `redis.size` | `small` | Redis instance |
| `externalApis` | `api.stripe.com` | Allowed egress for payment processing |
| `STRIPE_KEY` | `secret: order-stripe-key` | API key from OpenBao |

## Create Your Bundle

```bash
# 1. Export all container images
docker save order-api:v1.0.0 -o images/order-api.tar
docker save order-worker:v1.0.0 -o images/order-worker.tar
docker save db-migrate:v1.0.0 -o images/db-migrate.tar

# 2. Create the bundle
tar czf order-service.bundle.tar.gz bundle.yaml images/

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

After the bundle passes the DSOP pipeline, deploy all three components. Use `--no-commit` to batch them into a single Git push:

```bash
# API service
./scripts/sre-deploy-app.sh \
  --name order-api --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/order-api --tag v1.0.0 \
  --port 8080 --chart api-service --resources medium \
  --ingress orders.apps.sre.example.com \
  --liveness /healthz --readiness /readyz --metrics --no-commit

# Background worker
./scripts/sre-deploy-app.sh \
  --name order-worker --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/order-worker --tag v1.0.0 \
  --chart worker --resources small --singleton --no-commit

# Commit all at once
git add apps/tenants/team-demo/ && git commit -m "feat: deploy order processing system" && git push
```

## Verify

```bash
# Check all components
kubectl get helmrelease -n team-demo
kubectl get pods -n team-demo

# Test the API endpoint
curl -sk https://orders.apps.sre.example.com/healthz

# Confirm worker is running as singleton
kubectl get pods -n team-demo -l app.kubernetes.io/name=order-worker
```

## What the Platform Provides

- Each component gets its own Deployment, ServiceAccount, and NetworkPolicy
- API gets Istio VirtualService + AuthorizationPolicy; worker gets no Service
- Prometheus ServiceMonitor for metrics scraping (when `--metrics` is used)
- Egress NetworkPolicy allowing traffic to declared external APIs only

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease-api.yaml` -- API manifest the operator generates (reference only)
- `helmrelease-worker.yaml` -- Worker manifest the operator generates (reference only)
