# Example 07: Fullstack App — React + Go API + PostgreSQL

A three-tier web application demonstrating how to bundle multiple services for the SRE platform. Based on the Task Board demo app.

## What This Demonstrates

- Multiple services as **components** (frontend + backend API)
- Platform-managed **PostgreSQL database** (you don't install it)
- **SSO integration** via Keycloak (automatic login for users)
- **Secret management** — database credentials come from the platform, not your code
- Source code included for **SAST scanning**

## Architecture

```
Browser → taskboard.apps.sre.example.com
             │
         ┌───┴───┐
         │       │
    Frontend   API (backend)
    React      Go :9090
    nginx:8080    │
                  │
              PostgreSQL
              (managed by platform)
```

The platform handles routing: `/api/*` goes to the backend, everything else goes to the frontend. You don't configure this — it's automatic when you declare components.

## What You Create

Just two things:

1. **Your source code** (frontend/ and backend/ with Dockerfiles)
2. **bundle.yaml** (this file — describes what your app needs)

That's it. The platform generates everything else: Kubernetes deployments, networking, TLS, monitoring, database provisioning, SSO configuration.

## Bundle Configuration

| Field | Value | Why |
|-------|-------|-----|
| `app.type` | `web-app` | Frontend serves HTTP |
| `app.port` | `8080` | nginx default |
| `components[0].type` | `api-service` | Backend is an internal API |
| `components[0].port` | `9090` | Go API port |
| `services.database` | `enabled: true` | App needs PostgreSQL |
| `services.sso` | `enabled: true` | Users authenticate via Keycloak |
| `env.DATABASE_URL` | `secret: taskboard-db-credentials` | Platform injects credentials automatically |

## Create Your Bundle

```bash
# 1. Build both images (from your project root)
docker build -t taskboard-frontend:v1.0.0 frontend/
docker build -t taskboard-backend:v1.0.0 backend/

# 2. Save images
mkdir -p images
docker save taskboard-frontend:v1.0.0 -o images/frontend.tar
docker save taskboard-backend:v1.0.0 -o images/backend.tar

# 3. Package the bundle
tar czf taskboard.bundle.tar.gz bundle.yaml images/

# 4. Upload through the DSOP Wizard in the dashboard
```

## How Components Talk to Each Other

Once deployed, the backend API is reachable from the frontend at:
```
http://api.team-demo.svc.cluster.local:9090
```

But you don't hardcode this — the platform sets up routing so that requests to `taskboard.apps.sre.example.com/api/*` automatically go to the backend. Your frontend just calls `/api/tasks` and it works.

## What About the Database?

You set `services.database.enabled: true` in bundle.yaml. The platform:
1. Creates a PostgreSQL instance in your namespace
2. Generates secure credentials
3. Injects `DATABASE_URL` into your backend container automatically

You never see the password. Your app just reads `DATABASE_URL` from the environment.

## What Happens After You Submit

1. Upload your `.bundle.tar.gz` through the DSOP Wizard in the dashboard
2. The platform automatically scans your image for vulnerabilities and secrets
3. An ISSM (security reviewer) reviews and approves the deployment
4. Your app goes live with HTTPS, monitoring, and logging — all automatic

Check deployment status in the dashboard under **Applications**.

## For SRE Operators

Deployment is managed entirely through the **SRE Dashboard**:

1. The developer uploads their bundle through the **Deploy tab** (DSOP Wizard)
2. Review the pipeline run in the **Security tab** → Pipeline Runs
3. Approve as ISSM if security exceptions are requested
4. Monitor the deployment in the **Applications tab**
5. Use the **Operations Cockpit** (click any app → Cockpit) for diagnostics, logs, restart, and scaling

No command-line tools needed.

## Reference

- `bundle.yaml` — What the developer submits
- Full source code: [`apps/demo-fullstack/`](../../../../apps/demo-fullstack/) (includes Go backend, React frontend, Dockerfiles)
