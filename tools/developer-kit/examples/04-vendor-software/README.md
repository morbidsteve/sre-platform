# Example 04: Vendor Software (COTS)

Deploying ACME Enterprise Portal -- commercial off-the-shelf software. Demonstrates security relaxations needed for third-party applications: writable root filesystem, HTTPS backend protocol, startup probes, and CUI classification.

## What This Demonstrates

- `--writable-root` for apps that write to the root filesystem
- `--protocol https` for backend services that speak TLS
- `--startup-probe` for slow-starting applications (Java, .NET)
- Large resource allocation (500m/512Mi request, 2000m/2Gi limit)
- CUI data classification handling
- SSO integration for vendor software

## Bundle Configuration

The `bundle.yaml` in this directory defines the deployment. Key settings:

| Field | Value | Purpose |
|-------|-------|---------|
| `name` | `acme-portal` | Application name |
| `port` | `443` | HTTPS listen port |
| `resources` | `large` | High CPU/memory for Java app |
| `sso.enabled` | `true` | Keycloak OIDC integration |
| `classification` | `CUI` | Controlled Unclassified Information handling |
| `source.included` | `false` | No source code (vendor binary) |

**Note:** The `--writable-root` and `--protocol https` flags are SRE operator decisions made during deployment based on vendor requirements. The bundle declares what the app needs; the operator configures security exceptions.

## Create Your Bundle

```bash
# 1. Export the vendor container image
docker save acme-portal:v3.1.0 -o images/acme-portal.tar

# 2. Create the bundle
tar czf acme-portal.bundle.tar.gz bundle.yaml images/

# 3. Submit to your SRE platform operator
```

Or use the visual builder: open `bundle-builder.html` in your browser.

## For SRE Operators

After the bundle passes the DSOP pipeline, deploy with:

```bash
./scripts/sre-deploy-app.sh \
  --name acme-portal --team team-demo \
  --image harbor.apps.sre.example.com/team-demo/acme-portal --tag v3.1.0 \
  --port 8443 --protocol https \
  --ingress acme.apps.sre.example.com \
  --resources large --writable-root \
  --startup-probe /health --liveness /health --readiness /health
```

Key operator flags for COTS software:

| Flag | Why It's Needed |
|------|-----------------|
| `--protocol https` | Vendor app speaks TLS internally; Istio needs a DestinationRule |
| `--writable-root` | Vendor writes to temp files, logs, caches at runtime |
| `--startup-probe` | Java app needs up to 150s to start (5s x 30 retries) |

## Verify

```bash
# Check pods (startup probe may take up to 2 minutes)
kubectl get pods -n team-demo -l app.kubernetes.io/name=acme-portal

# Test the endpoint
curl -sk https://acme.apps.sre.example.com/health
```

## What the Platform Provides

- Istio mTLS and sidecar injection (even for COTS)
- DestinationRule for HTTPS backend protocol handling
- Default-deny NetworkPolicy with platform exceptions
- CUI-appropriate audit logging and access controls
- Startup probe with generous failure threshold for slow-starting apps

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
