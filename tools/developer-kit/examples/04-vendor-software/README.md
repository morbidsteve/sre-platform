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

- Istio mTLS and sidecar injection (even for COTS)
- DestinationRule for HTTPS backend protocol handling
- Default-deny NetworkPolicy with platform exceptions
- CUI-appropriate audit logging and access controls
- Startup probe with generous failure threshold for slow-starting apps

## Reference

- `bundle.yaml` -- What the developer submits
- `helmrelease.yaml` -- What the operator generates (reference only)
