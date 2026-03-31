# Round 6: Real Deployment of Complex Apps + Developer Integration Kit

## Context

Rounds 1-3 only validated YAML templates — never deployed to a cluster. Rounds 4-5
deployed 3 simple apps and validated the platform. Now we deploy the HARD cases:
multi-container apps, apps with databases, apps requiring exotic security contexts,
Helm charts from the wild. These are exactly the apps real developers will bring.

Every failure we hit becomes a developer guide entry. Every workaround becomes a
platform feature. The output is both a battle-tested platform AND a complete
Developer Integration Kit that tells external teams exactly how to make their
software SRE-compatible.

## The Prompt

```
You are deploying complex, real-world applications to the SRE platform and building
a Developer Integration Kit from the experience. Every app you deploy represents
a category of software that external developers will bring to this platform.

BRANCH: feat/round6-real-deployments

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. Use ONLY the deploy script (sre-deploy-app.sh) or DSOP wizard to deploy.
   If something can't be deployed through those tools, that's a PLATFORM BUG.
3. After each app, write a case study in the developer guide.
4. Take screenshots and capture evidence for every deployment.
5. If a flag or feature is missing from the deploy script, ADD IT.
6. Credentials: sre-admin / SreAdmin123!
7. Domain: *.apps.sre.example.com

## PHASE 0: Assess Deploy Script Capabilities

Before deploying anything, inventory what the deploy script can currently do:

```bash
./scripts/sre-deploy-app.sh --help
```

Document the current flags. Then check what Round 2/3 apps need that might be missing:

| Capability Needed | Current Support | Apps That Need It |
|-------------------|----------------|-------------------|
| Multiple containers (sidecar) | ? | Sock Shop, NetBox |
| Database (PostgreSQL/MySQL) | ? | NetBox, n8n, Gitea, Redash |
| Environment from Secret | --env-from-secret? | Redash (32+ env vars) |
| Multiple ports | --extra-port? | Sock Shop (many services) |
| ConfigMap mount | --config-file? | NetBox, Gitea |
| Init containers | ? | NetBox |
| StatefulSet | ? | MinIO |
| gRPC probes | --probe-type grpc? | gRPC services |
| Custom command/args | --command/--args? | Workers |
| Service-to-service deps | ? | All multi-service apps |

For any MISSING capability, implement it in the deploy script before proceeding.
This is the most important part — every new flag makes the platform more capable
for ALL future developers.

## PHASE 1: Single-Container Apps (Warm-up)

These test the basic patterns with slightly more complexity than go-httpbin.

### 1A: n8n (Workflow Automation)

Category: **Web app + persistent SQLite database**
Why it matters: Represents any developer bringing a stateful web app.

```bash
./scripts/sre-deploy-app.sh \
  --name n8n --team team-alpha \
  --image n8nio/n8n --tag 1.64.0 --port 5678 \
  --persist /home/node/.n8n:5Gi \
  --run-as-root \
  --ingress n8n.apps.sre.example.com \
  --no-commit
```

Deploy and verify:
- Pod is Running
- Web UI loads through ingress (after SSO login)
- Data persists across pod restart (kubectl delete pod, wait for reschedule, verify)

If this fails, document why and fix the platform.

### 1B: Uptime Kuma (if not already deployed from Round 4)

Category: **Monitoring app with WebSocket + persistence**

```bash
./scripts/sre-deploy-app.sh \
  --name uptime-kuma --team team-alpha \
  --image louislam/uptime-kuma --tag 1 --port 3001 \
  --run-as-root --add-capability SETUID --add-capability SETGID \
  --persist /app/data:5Gi \
  --ingress kuma.apps.sre.example.com \
  --no-commit
```

Verify WebSocket works (the monitoring dashboard uses WebSocket for live updates).

## PHASE 2: Multi-Service App (Sock Shop)

Category: **Microservice architecture with 10+ services**
Why it matters: Most real enterprise apps are multi-service. This tests
service-to-service communication, multiple deployments, and internal DNS.

Sock Shop (Weaveworks demo) has these services:
- front-end (Node.js, port 8079) — the web UI
- catalogue + catalogue-db (Go + MySQL)
- carts + carts-db (Java + MongoDB)
- orders + orders-db (Java + MongoDB)
- payment (Go)
- shipping (Java)
- user + user-db (Go + MongoDB)
- queue-master (Java) — worker consuming from RabbitMQ
- rabbitmq (RabbitMQ)

Approach: Deploy each service via the deploy script. For databases, use the
--persist flag. For services that need to talk to each other, they use Kubernetes
DNS (service-name.namespace.svc.cluster.local).

```bash
TEAM="team-alpha"
NS="team-alpha"

# 1. RabbitMQ
./scripts/sre-deploy-app.sh \
  --name rabbitmq --team $TEAM \
  --image rabbitmq --tag 3.13-management --port 5672 \
  --extra-port 15672 \
  --persist /var/lib/rabbitmq:2Gi \
  --no-commit

# 2. catalogue-db (MySQL)
./scripts/sre-deploy-app.sh \
  --name catalogue-db --team $TEAM \
  --image weaveworksdemos/catalogue-db --tag 0.3.0 --port 3306 \
  --persist /var/lib/mysql:2Gi \
  --run-as-root \
  --no-commit

# 3. catalogue
./scripts/sre-deploy-app.sh \
  --name catalogue --team $TEAM \
  --image weaveworksdemos/catalogue --tag 0.3.5 --port 80 \
  --no-commit

# 4. carts-db (MongoDB)
./scripts/sre-deploy-app.sh \
  --name carts-db --team $TEAM \
  --image mongo --tag 4.4 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root \
  --no-commit

# 5. carts
./scripts/sre-deploy-app.sh \
  --name carts --team $TEAM \
  --image weaveworksdemos/carts --tag 0.4.8 --port 80 \
  --no-commit

# 6. orders-db (MongoDB)
./scripts/sre-deploy-app.sh \
  --name orders-db --team $TEAM \
  --image mongo --tag 4.4 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root \
  --no-commit

# 7. orders
./scripts/sre-deploy-app.sh \
  --name orders --team $TEAM \
  --image weaveworksdemos/orders --tag 0.4.7 --port 80 \
  --no-commit

# 8. user-db (MongoDB)
./scripts/sre-deploy-app.sh \
  --name user-db --team $TEAM \
  --image weaveworksdemos/user-db --tag 0.3.0 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root \
  --no-commit

# 9. user
./scripts/sre-deploy-app.sh \
  --name user --team $TEAM \
  --image weaveworksdemos/user --tag 0.4.4 --port 80 \
  --no-commit

# 10. payment
./scripts/sre-deploy-app.sh \
  --name payment --team $TEAM \
  --image weaveworksdemos/payment --tag 0.4.3 --port 80 \
  --no-commit

# 11. shipping
./scripts/sre-deploy-app.sh \
  --name shipping --team $TEAM \
  --image weaveworksdemos/shipping --tag 0.4.8 --port 80 \
  --no-commit

# 12. queue-master (worker — no ingress)
./scripts/sre-deploy-app.sh \
  --name queue-master --team $TEAM \
  --chart worker \
  --image weaveworksdemos/queue-master --tag 0.3.1 --port 80 \
  --no-commit

# 13. front-end (the UI — this gets ingress)
./scripts/sre-deploy-app.sh \
  --name front-end --team $TEAM \
  --image weaveworksdemos/front-end --tag 0.3.12 --port 8079 \
  --ingress sockshop.apps.sre.example.com \
  --no-commit
```

Apply all generated manifests:
```bash
kubectl apply -f apps/tenants/$TEAM/apps/ --recursive
```

Wait for all pods to be ready:
```bash
kubectl wait --for=condition=Ready pod --all -n $NS --timeout=600s
```

Verify with Playwright:
- Navigate to https://sockshop.apps.sre.example.com/ (after SSO)
- The Sock Shop UI should load with products visible
- Add an item to cart, verify cart shows it
- Screenshot each step

IMPORTANT: Sock Shop services find each other via Kubernetes DNS. The services
use environment variables or hardcoded hostnames like "catalogue", "carts", etc.
In Kubernetes, these resolve to SERVICE_NAME.NAMESPACE.svc.cluster.local.
The deploy script creates Services with the --name, so "catalogue" service in
"team-alpha" namespace resolves correctly IF the app expects to find services
in the same namespace. If cross-namespace, NetworkPolicy must allow it.

If services can't find each other, check:
1. Service names match what the app expects
2. NetworkPolicy allows intra-namespace traffic
3. Istio sidecar isn't blocking (AuthorizationPolicy may need updating)

Document every issue in the developer guide.

## PHASE 3: NetBox (Enterprise IPAM/DCIM)

Category: **Python/Django app with PostgreSQL, Redis, init containers, workers**
Why it matters: Represents enterprise software with database dependencies.

NetBox needs: PostgreSQL, Redis, the app itself, and a worker process.

### 3A: PostgreSQL for NetBox

If CNPG (CloudNativePG) is installed as an addon:
```bash
# Use CNPG Cluster CRD for managed PostgreSQL
cat <<EOF | kubectl apply -f -
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: netbox-db
  namespace: team-alpha
spec:
  instances: 1
  storage:
    size: 5Gi
  bootstrap:
    initdb:
      database: netbox
      owner: netbox
EOF
```

If CNPG is NOT available, deploy PostgreSQL manually:
```bash
./scripts/sre-deploy-app.sh \
  --name netbox-db --team team-alpha \
  --image postgres --tag 16-alpine --port 5432 \
  --persist /var/lib/postgresql/data:5Gi \
  --run-as-root \
  --env POSTGRES_DB=netbox \
  --env POSTGRES_USER=netbox \
  --env POSTGRES_PASSWORD=changeme \
  --no-commit
```

### 3B: Redis for NetBox
```bash
./scripts/sre-deploy-app.sh \
  --name netbox-redis --team team-alpha \
  --image redis --tag 7-alpine --port 6379 \
  --persist /data:1Gi \
  --no-commit
```

### 3C: NetBox App
```bash
./scripts/sre-deploy-app.sh \
  --name netbox --team team-alpha \
  --image netboxcommunity/netbox --tag v4.0 --port 8080 \
  --persist /opt/netbox/media:2Gi \
  --run-as-root \
  --env DB_HOST=netbox-db \
  --env DB_NAME=netbox \
  --env DB_USER=netbox \
  --env DB_PASSWORD=changeme \
  --env REDIS_HOST=netbox-redis \
  --env SECRET_KEY=changeme-this-is-a-long-secret-key-for-netbox \
  --ingress netbox.apps.sre.example.com \
  --no-commit
```

### 3D: NetBox Worker
```bash
./scripts/sre-deploy-app.sh \
  --name netbox-worker --team team-alpha \
  --chart worker \
  --image netboxcommunity/netbox --tag v4.0 --port 8080 \
  --command "python" --args "/opt/netbox/netbox/manage.py rqworker" \
  --env DB_HOST=netbox-db \
  --env DB_NAME=netbox \
  --env DB_USER=netbox \
  --env DB_PASSWORD=changeme \
  --env REDIS_HOST=netbox-redis \
  --env SECRET_KEY=changeme-this-is-a-long-secret-key-for-netbox \
  --run-as-root \
  --no-commit
```

Deploy all, verify NetBox UI loads, can create sites/devices.

## PHASE 4: Gitea with Full Verification

Category: **Git server with persistence, SSH, and post-install initialization**
Why it matters: Proves multi-PVC persistence and handles the known 404 bug.

```bash
./scripts/sre-deploy-app.sh \
  --name gitea --team team-alpha \
  --image gitea/gitea --tag 1.22-rootless --port 3000 \
  --persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi \
  --ingress gitea.apps.sre.example.com \
  --no-commit
```

After deployment, use Playwright to:
1. Navigate to Gitea → should see install page
2. Configure install (site title: "SRE Gitea", admin: sre-test/SreTest123!)
3. Submit install
4. **WAIT 5 SECONDS** (known post-install 404 issue)
5. Navigate to root URL
6. If 404, wait 3s and retry (up to 3 times, log each attempt)
7. Login
8. Create repo "integration-test"
9. Clone via HTTPS, push a file
10. Verify file in UI
11. Delete pod, wait for restart
12. Verify repo + file still exist (persistence test)
13. Screenshot EVERY step including any 404s

## PHASE 5: MinIO (S3-Compatible Object Storage)

Category: **StatefulSet with multiple ports, health endpoint**
Why it matters: Many apps need S3 storage. MinIO tests the StatefulSet pattern.

```bash
./scripts/sre-deploy-app.sh \
  --name minio --team team-alpha \
  --image minio/minio --tag latest \
  --command "minio" --args "server /data --console-address :9001" \
  --port 9000 --extra-port 9001 \
  --persist /data:20Gi \
  --run-as-root \
  --liveness /minio/health/live \
  --readiness /minio/health/ready \
  --env MINIO_ROOT_USER=minioadmin \
  --env MINIO_ROOT_PASSWORD=minioadmin123 \
  --ingress minio.apps.sre.example.com \
  --no-commit
```

NOTE: Use a pinned tag, not :latest. Check for the current stable version.

Verify: MinIO console accessible, can create bucket, upload file.

## PHASE 6: Developer Integration Kit

After deploying all the above, create the Developer Integration Kit. This is the
documentation and tooling that external developers need to bring their software
to the SRE platform.

### 6A: Developer Compatibility Guide

Create docs/developer-guides/sre-compatibility.md:

```markdown
# Making Your Software SRE-Compatible

## Overview
The SRE platform runs your containers securely with zero-trust networking,
Keycloak SSO, and NIST 800-53 compliance. This guide covers what you need
to know to deploy smoothly.

## Quick Compatibility Checklist

- [ ] Container runs as non-root (or document why it can't)
- [ ] No :latest tags — pin all image versions
- [ ] Exposes a single HTTP port (additional ports supported)
- [ ] Has a health endpoint (or responds 200 on /)
- [ ] Reads config from environment variables (not hardcoded files)
- [ ] Writes data to a known directory (for persistence)
- [ ] Logs to stdout/stderr in structured format (JSON preferred)
- [ ] No hardcoded credentials

## Deployment Paths

### Path 1: Deploy Script (CLI)
Best for: Operators, automation, CI/CD pipelines

### Path 2: DSOP Wizard (Web UI)
Best for: Developers who want a guided experience

### Path 3: GitOps (Direct Helm values)
Best for: Teams who want full control

## Common Patterns

### Simple Web App
(go-httpbin example with exact deploy command)

### App with Database
(NetBox example showing app + PostgreSQL + Redis pattern)

### Multi-Service Architecture
(Sock Shop example showing bulk deploy pattern)

### App Requiring Root
(Uptime Kuma example with --run-as-root and PolicyException)

### App with Persistent Data
(Gitea example with --persist for multiple volumes)

### App with Custom Commands
(Worker pattern with --command and --args)

## Security Context Requirements

The platform enforces these by default:
- runAsNonRoot: true
- readOnlyRootFilesystem: true
- allowPrivilegeEscalation: false
- capabilities: drop ALL

If your app needs different settings, use:
- --run-as-root: Runs as root (generates Kyverno PolicyException)
- --writable-root: Allows writing to container filesystem
- --add-capability CAP: Adds a specific Linux capability

## Authentication

All apps are automatically protected by Keycloak SSO. Your app receives
these headers after authentication:
- x-auth-request-user: Authenticated username
- x-auth-request-email: User's email
- x-auth-request-groups: Comma-separated group memberships

You do NOT need to implement authentication. The platform handles it.

## Networking

Your app runs inside an Istio service mesh:
- All traffic is mTLS-encrypted automatically
- Default-deny NetworkPolicy — only explicitly allowed traffic passes
- Ingress through Istio gateway with TLS termination

To allow your services to communicate with each other, they must be in
the same namespace. Cross-namespace traffic requires a NetworkPolicy.

## Monitoring

If your app exposes a /metrics endpoint (Prometheus format), add --metrics
to the deploy command. A ServiceMonitor will be created automatically.

## Troubleshooting

### Pod won't start
1. Check: kubectl logs <pod> -n <namespace>
2. If "permission denied": Your app needs --run-as-root or --writable-root
3. If OOMKilled: Increase memory limits

### App returns 404 after deploy
1. Check: kubectl get virtualservice -n <namespace>
2. Verify the hostname matches your --ingress value
3. Some apps need time after first start (e.g., Gitea setup wizard)

### SSO redirect loop
1. Check: Is your app trying to handle its own auth?
2. The platform handles auth — your app should just read the headers
3. Check cookie domain matches .apps.sre.example.com
```

### 6B: Pre-Flight Compatibility Scanner

Create scripts/sre-compat-check.sh that developers run BEFORE deploying:

```bash
#!/usr/bin/env bash
# sre-compat-check.sh — Check if a container image is SRE-compatible
#
# Usage: ./scripts/sre-compat-check.sh IMAGE:TAG
#
# Checks:
# 1. Image exists and can be pulled
# 2. Runs as non-root? (or needs --run-as-root)
# 3. Exposes ports?
# 4. Has a health endpoint?
# 5. Needs writable filesystem?
# 6. What capabilities it needs?
```

This script should:
1. Pull the image (or inspect it if already local)
2. Check the USER directive in the image
3. Check EXPOSE ports
4. Check ENTRYPOINT/CMD
5. Try running it briefly and checking if it crashes with read-only fs
6. Output a recommended deploy command

### 6C: App Requirements Template

Create docs/developer-guides/app-requirements-template.md that developers fill out:

```markdown
# App Requirements for SRE Deployment

## Basic Info
- App name:
- Team/Namespace:
- Image: (registry/name:tag)
- Port:

## Security Requirements
- Needs root? Yes/No (why):
- Needs writable filesystem? Yes/No (which paths):
- Needs capabilities? List:

## Data
- Persistent volumes needed:
  - Path: /data, Size: 5Gi, Purpose: database storage
- Environment variables:
  - DB_HOST (from: manual / secret / config)

## Dependencies
- External services needed:
  - PostgreSQL (deploy with app / external / CNPG)
  - Redis (deploy with app / external)

## Health
- Liveness endpoint:
- Readiness endpoint:
- Startup time (seconds):

## Compliance
- Data classification:
- Contains PII? Yes/No:
- External network access needed? Yes/No:
```

### 6D: Update DSOP Wizard

Check if the wizard handles all the patterns tested above. Specifically:
1. Can it deploy an app that needs --run-as-root?
2. Can it handle multiple --persist flags?
3. Does Step 3 (Detection) correctly identify security requirements?
4. Does Step 6 (Deploy) generate PolicyExceptions when needed?

If any of these are missing, update the wizard code.

## PHASE 7: Cleanup and Report

### 7A: Cleanup test deployments

For any apps that were deployed just for testing (not meant to stay):
```bash
# List all apps in team-alpha
kubectl get deployments -n team-alpha

# Decide which to keep and which to remove
# Keep: anything useful for demos
# Remove: test duplicates (httpbin-r5, etc.)
```

Do NOT remove apps that serve as useful demos of the platform's capabilities.

### 7B: Final Report

Create tests/e2e/round6/FINAL-REPORT.md:

| App | Category | Deploy Method | Status | Issues | Guide Entry |
|-----|----------|---------------|--------|--------|-------------|
| n8n | Stateful web app | CLI | ? | ? | Yes |
| Sock Shop | Microservices (13 svc) | CLI bulk | ? | ? | Yes |
| NetBox | Enterprise + DB | CLI + CNPG | ? | ? | Yes |
| Gitea | Git server + multi-PVC | CLI | ? | ? | Yes |
| MinIO | Object storage | CLI | ? | ? | Yes |

### Deploy Script Improvements Made:
(list any new flags or fixes added during this round)

### Developer Guide Entries Created:
(list all docs created or updated)

### Platform Bugs Found:
(list with severity)

### Evidence for ATO:
(additional evidence collected — diverse workload proof)

## Commit

```bash
git add .
git commit -m "feat: Round 6 — real deployment of complex apps + Developer Integration Kit

Deployed and verified:
- n8n (stateful web app)
- Sock Shop (13 microservices)
- NetBox (enterprise + PostgreSQL + Redis + worker)
- Gitea (multi-PVC persistence)
- MinIO (object storage)

Created Developer Integration Kit:
- docs/developer-guides/sre-compatibility.md
- scripts/sre-compat-check.sh
- docs/developer-guides/app-requirements-template.md
- DSOP wizard updates for complex patterns"

git push -u origin feat/round6-real-deployments
gh pr create --title "feat: Round 6 — complex app deployments + Developer Integration Kit" \
  --body "$(cat <<'EOF'
## Summary
Deploys 5 complex real-world applications to prove the platform handles diverse
workloads. Creates a Developer Integration Kit with guides, templates, and tooling
for external developers bringing their software to SRE.

## Apps Deployed
- n8n (workflow automation, stateful)
- Sock Shop (13 microservices, service mesh)
- NetBox (enterprise IPAM, PostgreSQL, Redis, workers)
- Gitea (git server, multi-PVC, post-install handling)
- MinIO (S3 storage, StatefulSet pattern)

## Developer Kit
- Compatibility guide with checklist and common patterns
- Pre-flight scanner script
- App requirements template
- DSOP wizard updates

## Test Plan
- [ ] All 5 apps running and accessible via ingress
- [ ] SSO works for all apps
- [ ] Persistence verified (pod restart test)
- [ ] Sock Shop inter-service communication works
- [ ] Developer guide covers all patterns encountered
- [ ] Pre-flight scanner produces useful output

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
```

---

## Kick-Off Prompt

```
Read docs/round6-real-deployments-and-dev-guide.md and execute the prompt in
"The Prompt" section. Deploy complex real-world apps AND build a Developer
Integration Kit. Start with Phase 0 (assess deploy script capabilities).
Do not stop or ask questions.
```
