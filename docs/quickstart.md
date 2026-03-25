# Quickstart: Deploy Your First App on SRE

Time: ~20 minutes (assumes tools are installed per [Getting Started](getting-started-developer.md))

## Prerequisites

- kubectl configured (see [Getting Started](getting-started-developer.md) guide)
- Your team namespace exists (ask your platform admin or see [Onboarding Guide](onboarding-guide.md))
- Harbor credentials (provided during onboarding)

## Step 1: Build and Push Your Image

```bash
docker build -t harbor.apps.sre.example.com/<your-team>/<your-app>:v1.0.0 .
docker push harbor.apps.sre.example.com/<your-team>/<your-app>:v1.0.0
```

## Step 2: Deploy via Dashboard (easiest)

1. Log in to https://dashboard.apps.sre.example.com
2. Go to the **Deploy** tab
3. Click **DSOP Security Pipeline** (recommended) or **Quick Deploy**
4. Follow the wizard -- it handles security scanning, ISSM review, and deployment

## Step 3: Deploy via CLI (fastest)

```bash
./scripts/sre-deploy-app.sh \
  --name my-app \
  --team <your-team> \
  --image harbor.apps.sre.example.com/<your-team>/my-app:v1.0.0 \
  --port 8080 \
  --ingress my-app.apps.sre.example.com
```

## Step 4: Verify

```bash
kubectl get pods -n <your-team>
curl https://my-app.apps.sre.example.com
```

A healthy pod shows `2/2 READY` -- your container plus the Istio sidecar.

## What You Got for Free

- mTLS encryption to all other services (Istio)
- Prometheus metrics scraping (if `/metrics` endpoint exists)
- Network isolation (only gateway, monitoring, and same-namespace traffic allowed)
- Security policy enforcement (non-root, no privilege escalation, resource limits)
- Audit logging
- Log collection to Loki (stdout/stderr captured automatically)
- Distributed tracing via Istio

## Updating Your App

1. Build and push a new image tag
2. Update the image tag in `apps/tenants/<team>/apps/<app>.yaml`
3. Git commit and push -- Flux auto-deploys within 10 minutes

## Blocked by a Policy?

If Kyverno rejects your deployment, check the error message for details.

**Common fixes:**
- Add `USER 1000` to your Dockerfile (non-root requirement)
- Add health check endpoints (liveness/readiness probes required)
- Pin your image tag -- `:latest` is not allowed
- Use `harbor.apps.sre.example.com` as your image registry

**Cannot fix it?** Request a [Policy Exception](../policies/custom/policy-exceptions/README.md).

## Next Steps

- Set up CI/CD: [CI/CD Pipeline Guide](../ci/README.md)
- Add secrets from OpenBao: [Developer Guide > Secrets](developer-guide.md#secrets-management)
- View metrics: https://grafana.apps.sre.example.com
- Full deployment reference: [Developer Guide](developer-guide.md)
- Troubleshooting: [Troubleshooting Guide](troubleshooting.md)
