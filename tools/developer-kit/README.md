# SRE Developer Kit

Everything you need to get your application deployed on the Secure Runtime Environment (SRE) platform.

## How Deployment Works

```
 YOU (Developer)                    SRE Platform
 ──────────────                    ────────────
 1. Create a bundle               4. SRE operator deploys
    (image + manifest)                your app via GitOps
         │                                 │
         ▼                                 ▼
 2. Submit bundle ──────────►  3. DSOP Pipeline
    to SRE team                   ├── SAST scan
                                  ├── Secrets scan
                                  ├── Container build
                                  ├── SBOM generation
                                  ├── CVE scan
                                  ├── DAST scan
                                  ├── ISSM review
                                  └── Image signing
                                       │
                                       ▼
                                  5. App is live
                                     (mTLS, monitoring,
                                      NetworkPolicies — automatic)
```

**You create a bundle. The platform handles everything else** — security scanning, compliance, networking, certificates, monitoring, and deployment.

## What's in This Kit

| Item | Description |
|------|-------------|
| `bundle-builder.html` | Visual form in your browser to create a bundle (recommended) |
| `sre-bundle.sh` | Command-line tool for creating bundles (requires bash + docker) |
| `bundle.yaml.template` | Manifest template with comments explaining every field |
| `examples/` | Six example bundles from simple to complex |

## Quick Start

### Option A: Visual Builder (recommended)

1. Open `bundle-builder.html` in your web browser
2. Fill in the form with your app details
3. Upload your container image (`.tar` file from `docker save`)
4. Click "Generate Bundle"
5. Send the `.bundle.tar.gz` file to your SRE platform operator

### Option B: Command Line

```bash
bash sre-bundle.sh
```

Follow the interactive prompts. The script exports your Docker image and creates the bundle.

### Option C: Manual

1. Copy `bundle.yaml.template` to `bundle.yaml`
2. Edit the required fields (name, version, team, image, port)
3. Export your image: `docker save myimage:v1.0.0 -o images/myimage.tar`
4. Package: `tar czf myapp.bundle.tar.gz bundle.yaml images/`

## What Goes in a Bundle

A bundle is a `.tar.gz` containing:

```
myapp.bundle.tar.gz
├── bundle.yaml          # Manifest describing your app
└── images/
    └── myapp.tar        # Container image (from docker save)
```

The `bundle.yaml` tells the platform:
- **What to run**: image, port, replicas, resource requirements
- **What it needs**: database, redis, storage, SSO, environment variables
- **How to check health**: liveness and readiness probe paths
- **Security posture**: classification level, root requirements

## Multi-Service Applications

The bundle spec supports three patterns depending on your architecture:

### Single container (most apps)

One image, one deployment. Use `spec.app` only.

```yaml
spec:
  app:
    image: images/myapp.tar
    port: 8080
```

### Multiple services / microservices (components)

Separate deployments that run independently — each gets its own pods, scaling,
and lifecycle. Use `spec.components[]` alongside `spec.app`.

Example: a frontend + backend API + background worker.

```yaml
spec:
  app:
    type: web-app
    image: images/frontend.tar
    port: 3000
    ingress: myapp.apps.sre.example.com
  components:
    - name: api
      type: api-service
      image: images/api.tar
      port: 8080
      resources: medium
    - name: worker
      type: worker
      image: images/worker.tar
      resources: small
```

Each component becomes a separate Kubernetes Deployment. They communicate via
cluster DNS (e.g., `api.team-alpha.svc.cluster.local`).

### Sidecar containers (same pod)

Containers that MUST run alongside your main app in the same pod, sharing
network and storage. Use `spec.sidecars[]`.

Example: a log shipper that reads your app's log files.

```yaml
spec:
  app:
    image: images/myapp.tar
    port: 8080
  sidecars:
    - name: log-shipper
      image: images/log-shipper.tar
      port: 9090
      resources: small
```

**When to use which:**

| Pattern | When | Example |
|---------|------|---------|
| Single app | One container does everything | A web app, an API |
| Components | Independent services with separate scaling | Frontend + backend + worker |
| Sidecars | Helpers that must share the pod network/filesystem | Log shipper, metrics exporter |

You do NOT need to add the Istio sidecar — the platform injects it automatically.

## Examples

Each example includes a `bundle.yaml` (what you create) and a `helmrelease.yaml` (what the operator generates — for reference only).

| Example | What It Shows |
|---------|---------------|
| [01 - Simple Web App](examples/01-simple-web-app/) | Minimum viable deployment — just an image and a port |
| [02 - App with Database](examples/02-app-with-database/) | PostgreSQL, SSO, environment variables, secrets |
| [03 - Multi-Container](examples/03-multi-container/) | API + background worker + scheduled job (components) |
| [04 - Vendor Software](examples/04-vendor-software/) | Commercial off-the-shelf (COTS), security relaxation |
| [05 - Gitea](examples/05-gitea-self-hosted/) | Stateful app with persistent storage, startup probe |
| [06 - n8n](examples/06-n8n-workflow-automation/) | App requiring root, Kyverno policy exception |
| [07 - Fullstack App](examples/07-fullstack-app/) | React + Go API + PostgreSQL (frontend + backend + database) |

## What the Platform Does for You

When your bundle passes the DSOP pipeline and gets deployed, the platform automatically provides:

- **mTLS encryption** between all services (via Istio)
- **Network isolation** with default-deny NetworkPolicies
- **Prometheus monitoring** with ServiceMonitor
- **Centralized logging** to Loki via structured JSON stdout
- **TLS certificates** for your ingress hostname (via cert-manager)
- **SSO authentication** via Keycloak (if enabled in bundle)
- **Secret management** via OpenBao + External Secrets Operator
- **Container scanning** via Trivy in Harbor
- **Runtime protection** via NeuVector

You don't need to configure any of this. It's built into the platform.

## Security Defaults

All apps run with hardened security by default:

| Setting | Default | Override in bundle.yaml |
|---------|---------|------------------------|
| Run as non-root | Yes | `security.runAsNonRoot: false` |
| Read-only filesystem | Yes | `security.readOnlyRootFilesystem: false` |
| Drop all capabilities | Yes | `security.capabilities: [NET_BIND_SERVICE]` |
| Resource limits enforced | Yes | Set in `resources` section |

Apps can always write to `/tmp` and any mounted persistent volumes regardless of the read-only filesystem setting.

## For SRE Operators

All deployment operations are managed through the **SRE Dashboard**:

1. **Deploy tab** — Upload bundles and manage the DSOP security pipeline
2. **Applications tab** — Monitor deployed apps, access the Operations Cockpit for diagnostics, restart, scale, and force re-pull
3. **Security tab** — Review pipeline runs, approve/reject as ISSM, manage policy exceptions
4. **Admin tab** — Onboard tenants, manage users/groups, rotate secrets, configure SSO
5. **Compliance tab** — Generate live compliance reports, view NIST controls, download ATO packages

No command-line tools are needed for day-to-day operations.

For a full working three-tier reference application (React + Go + PostgreSQL), see [`apps/demo-fullstack/`](../../apps/demo-fullstack/).
