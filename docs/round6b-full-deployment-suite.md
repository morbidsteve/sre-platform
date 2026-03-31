# Round 6B: Deploy Everything + Fix All Remaining Bugs

## Context

Round 6 only deployed n8n and wrote docs. Sock Shop (13 microservices), NetBox
(enterprise + database + workers), Gitea (multi-PVC), and MinIO (object storage)
were never deployed to the live cluster — only template-validated in Rounds 2-3.

Additionally, the deploy script on main is MISSING advanced flags that were added
on feature branches but never merged: --run-as-root, --persist, --add-capability,
--extra-port, --env, --command, --args, --writable-root, --startup-probe,
--config-file, --env-from-secret, --probe-type, --image-pull-secret.

Round 6 also found 3 unfixed bugs:
1. Non-numeric USER blocked by runAsNonRoot
2. Deploy script missing imagePullSecrets
3. Persist path must match effective home dir

This prompt does ALL of it: fixes the deploy script, fixes the bugs, deploys
all 4 remaining complex apps, and Playwright-verifies each one.

## The Prompt

```
You are completing the SRE platform integration testing by deploying complex
real-world applications that were only template-validated in Rounds 2-3. You
will also fix the deploy script and 3 outstanding bugs from Round 6.

BRANCH: feat/round6b-full-deployment

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. Use ONLY the deploy script or DSOP wizard to deploy. If something can't
   be deployed through those tools, fix the tools first.
3. After each deployment, verify with kubectl AND Playwright browser test.
4. If a deployment fails, document the failure, fix it, and continue.
5. Do NOT silently retry. Log every attempt.
6. Credentials: sre-admin / SreAdmin123!
7. Domain: *.apps.sre.example.com
8. Take screenshots of every deployed app's UI.

## PHASE 0: Fix the Deploy Script

The deploy script (scripts/sre-deploy-app.sh) is missing critical flags that
were developed during Rounds 4-6 but never merged to main. Check what flags
exist. If any of these are missing, ADD THEM:

Required flags (check each, implement if missing):
- --run-as-root          → sets runAsUser: 0, runAsNonRoot: false, generates PolicyException
- --writable-root        → sets readOnlyRootFilesystem: false
- --add-capability CAP   → adds Linux capability (e.g., SETUID, SETGID)
- --persist PATH:SIZE    → creates PVC + volumeMount (support MULTIPLE --persist)
- --env KEY=VALUE        → adds environment variable (support MULTIPLE --env)
- --env-from-secret NAME → adds envFrom secretRef
- --extra-port PORT      → adds additional container/service port
- --command CMD          → overrides container command
- --args ARGS            → overrides container args
- --startup-probe PATH   → adds startupProbe with generous timeout
- --probe-type TYPE      → liveness/readiness probe type (http/tcp/grpc)
- --config-file SRC:DEST → mounts ConfigMap as file
- --image-pull-secret NAME → adds imagePullSecrets
- --cpu-request VAL      → overrides CPU request
- --memory-request VAL   → overrides memory request
- --cpu-limit VAL        → overrides CPU limit
- --memory-limit VAL     → overrides memory limit
- --singleton            → sets replicas: 1, no HPA

For each flag, check the existing Round 4/5/6 branches on the remote for
reference implementations:
```bash
git log --all --oneline | grep -i "deploy\|persist\|root\|capability"
git diff main..origin/fix/round4-platform-hardening -- scripts/sre-deploy-app.sh
git diff main..origin/feat/round6-real-deployments -- scripts/sre-deploy-app.sh
```

Cherry-pick or re-implement. The deploy script must support all flags before
proceeding to Phase 1.

Also fix the 3 Round 6 bugs:
1. Non-numeric USER: When --run-as-root is used, set runAsUser: 0 explicitly
   (not just runAsNonRoot: false). This handles images with USER node, USER app, etc.
2. imagePullSecrets: Add --image-pull-secret flag AND auto-detect harbor-pull-secret
   in the target namespace if it exists.
3. Persist path validation: In the generated manifest comments, note the image's
   declared WORKDIR/USER for reference.

Validate: ./scripts/sre-deploy-app.sh --help should show all flags.

Commit: git commit -m "feat(deploy): complete deploy script with all 17+ flags + fix 3 Round 6 bugs"

## PHASE 1: Sock Shop — 13 Microservices

This is the hardest test: a full microservice architecture where services must
discover each other via Kubernetes DNS.

Deploy ALL services to a dedicated team namespace:

```bash
# Create a team for Sock Shop
./scripts/onboard-tenant.sh team-sockshop 2>/dev/null || true

TEAM="team-sockshop"
DOMAIN="apps.sre.example.com"
```

### Databases first (they need to be ready before app services):

```bash
# MongoDB for carts
./scripts/sre-deploy-app.sh \
  --name carts-db --team $TEAM \
  --image mongo --tag 4.4.29 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root --singleton \
  --no-commit

# MongoDB for orders
./scripts/sre-deploy-app.sh \
  --name orders-db --team $TEAM \
  --image mongo --tag 4.4.29 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root --singleton \
  --no-commit

# MongoDB for user
./scripts/sre-deploy-app.sh \
  --name user-db --team $TEAM \
  --image weaveworksdemos/user-db --tag 0.3.0 --port 27017 \
  --persist /data/db:2Gi \
  --run-as-root --singleton \
  --no-commit

# MySQL for catalogue
./scripts/sre-deploy-app.sh \
  --name catalogue-db --team $TEAM \
  --image weaveworksdemos/catalogue-db --tag 0.3.0 --port 3306 \
  --persist /var/lib/mysql:2Gi \
  --run-as-root --singleton \
  --env MYSQL_ROOT_PASSWORD=fake_password \
  --env MYSQL_DATABASE=socksdb \
  --no-commit

# RabbitMQ
./scripts/sre-deploy-app.sh \
  --name rabbitmq --team $TEAM \
  --image rabbitmq --tag 3.13-management --port 5672 \
  --extra-port 15672 \
  --persist /var/lib/rabbitmq:1Gi \
  --run-as-root --singleton \
  --no-commit
```

### Application services:

```bash
# catalogue
./scripts/sre-deploy-app.sh \
  --name catalogue --team $TEAM \
  --image weaveworksdemos/catalogue --tag 0.3.5 --port 80 \
  --no-commit

# carts
./scripts/sre-deploy-app.sh \
  --name carts --team $TEAM \
  --image weaveworksdemos/carts --tag 0.4.8 --port 80 \
  --no-commit

# orders
./scripts/sre-deploy-app.sh \
  --name orders --team $TEAM \
  --image weaveworksdemos/orders --tag 0.4.7 --port 80 \
  --no-commit

# user
./scripts/sre-deploy-app.sh \
  --name user --team $TEAM \
  --image weaveworksdemos/user --tag 0.4.4 --port 80 \
  --no-commit

# payment
./scripts/sre-deploy-app.sh \
  --name payment --team $TEAM \
  --image weaveworksdemos/payment --tag 0.4.3 --port 80 \
  --no-commit

# shipping
./scripts/sre-deploy-app.sh \
  --name shipping --team $TEAM \
  --image weaveworksdemos/shipping --tag 0.4.8 --port 80 \
  --no-commit

# queue-master (worker — no ingress)
./scripts/sre-deploy-app.sh \
  --name queue-master --team $TEAM \
  --chart worker \
  --image weaveworksdemos/queue-master --tag 0.3.1 --port 80 \
  --no-commit

# front-end (the UI — gets ingress)
./scripts/sre-deploy-app.sh \
  --name front-end --team $TEAM \
  --image weaveworksdemos/front-end --tag 0.3.12 --port 8079 \
  --ingress sockshop.${DOMAIN} \
  --no-commit
```

### Deploy all:

```bash
# Apply all generated manifests
kubectl apply -f apps/tenants/$TEAM/apps/ --recursive 2>&1

# Wait for databases first (they take longer)
echo "Waiting for databases..."
for db in carts-db orders-db user-db catalogue-db rabbitmq; do
  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=$db \
    -n $TEAM --timeout=300s 2>&1 || echo "WARN: $db not ready"
done

# Then wait for app services
echo "Waiting for services..."
for svc in catalogue carts orders user payment shipping queue-master front-end; do
  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=$svc \
    -n $TEAM --timeout=300s 2>&1 || echo "WARN: $svc not ready"
done

# Status check
kubectl get pods -n $TEAM -o wide
```

### Verify with Playwright:

Create and run a Playwright test:
1. Navigate to https://sockshop.apps.sre.example.com/ (after SSO)
2. Verify the product catalogue loads (should see socks)
3. Click on a product
4. Add to cart
5. View cart
6. Screenshot each step

IMPORTANT: Sock Shop services find each other via Kubernetes service names.
The front-end uses environment variables or config to locate backends. If
services can't communicate:
1. Check NetworkPolicy allows intra-namespace traffic
2. Check the service names match what the app expects
3. Check Istio sidecar isn't blocking — may need AuthorizationPolicy ALLOW
   for intra-namespace traffic

If services fail to connect, fix the NetworkPolicy in the tenant base template
to explicitly allow all intra-namespace pod-to-pod traffic. This is standard
for microservice architectures.

Commit: git commit -m "deploy(team-sockshop): sock shop — 13 microservices deployed and verified"

## PHASE 2: NetBox — Enterprise App + PostgreSQL + Redis + Worker

### 2A: Check if CNPG (CloudNativePG) is available:

```bash
kubectl get crd clusters.postgresql.cnpg.io 2>/dev/null && echo "CNPG available" || echo "CNPG not available"
```

If CNPG is available, use it for PostgreSQL:
```bash
cat <<'EOF' | kubectl apply -f -
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
      secret:
        name: netbox-db-credentials
EOF

# Create credentials secret
kubectl create secret generic netbox-db-credentials -n team-alpha \
  --from-literal=username=netbox \
  --from-literal=password=changeme \
  --dry-run=client -o yaml | kubectl apply -f -
```

If CNPG is NOT available, deploy PostgreSQL manually:
```bash
./scripts/sre-deploy-app.sh \
  --name netbox-db --team team-alpha \
  --image postgres --tag 16-alpine --port 5432 \
  --persist /var/lib/postgresql/data:5Gi \
  --run-as-root --singleton \
  --env POSTGRES_DB=netbox \
  --env POSTGRES_USER=netbox \
  --env POSTGRES_PASSWORD=changeme \
  --no-commit
```

### 2B: Redis

```bash
./scripts/sre-deploy-app.sh \
  --name netbox-redis --team team-alpha \
  --image redis --tag 7-alpine --port 6379 \
  --persist /data:1Gi \
  --singleton \
  --no-commit
```

### 2C: NetBox App

```bash
./scripts/sre-deploy-app.sh \
  --name netbox --team team-alpha \
  --image netboxcommunity/netbox --tag v4.0 --port 8080 \
  --persist /opt/netbox/media:2Gi \
  --run-as-root \
  --startup-probe /api/ \
  --env DB_HOST=netbox-db \
  --env DB_NAME=netbox \
  --env DB_USER=netbox \
  --env DB_PASSWORD=changeme \
  --env REDIS_HOST=netbox-redis \
  --env SECRET_KEY=this-is-a-long-secret-key-for-netbox-change-me-in-production \
  --env SUPERUSER_NAME=admin \
  --env SUPERUSER_PASSWORD=admin \
  --env SUPERUSER_EMAIL=admin@example.com \
  --ingress netbox.apps.sre.example.com \
  --no-commit
```

### 2D: NetBox Worker

```bash
./scripts/sre-deploy-app.sh \
  --name netbox-worker --team team-alpha \
  --chart worker \
  --image netboxcommunity/netbox --tag v4.0 --port 8080 \
  --command "/opt/netbox/venv/bin/python" \
  --args "/opt/netbox/netbox/manage.py rqworker" \
  --run-as-root \
  --env DB_HOST=netbox-db \
  --env DB_NAME=netbox \
  --env DB_USER=netbox \
  --env DB_PASSWORD=changeme \
  --env REDIS_HOST=netbox-redis \
  --env SECRET_KEY=this-is-a-long-secret-key-for-netbox-change-me-in-production \
  --no-commit
```

### Deploy and verify:

```bash
kubectl apply -f apps/tenants/team-alpha/apps/ --recursive 2>&1

# Wait for DB first
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=netbox-db \
  -n team-alpha --timeout=300s
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=netbox-redis \
  -n team-alpha --timeout=300s

# Then app (needs DB to be ready for migrations)
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=netbox \
  -n team-alpha --timeout=600s
```

### Playwright verify:

1. Navigate to https://netbox.apps.sre.example.com/ (after SSO)
2. Login with admin/admin (NetBox's own auth, in addition to platform SSO)
3. Create a site (Organization > Sites > Add)
4. Create a device type
5. Screenshot each step

Commit: git commit -m "deploy(team-alpha): netbox — enterprise IPAM with PostgreSQL, Redis, worker"

## PHASE 3: Gitea — Multi-PVC + Post-Install Handling

```bash
./scripts/sre-deploy-app.sh \
  --name gitea --team team-alpha \
  --image gitea/gitea --tag 1.22-rootless --port 3000 \
  --persist /var/lib/gitea:10Gi \
  --persist /etc/gitea:100Mi \
  --startup-probe / \
  --ingress gitea.apps.sre.example.com \
  --no-commit
```

Deploy and verify:

```bash
kubectl apply -f apps/tenants/team-alpha/apps/ --recursive 2>&1
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=gitea \
  -n team-alpha --timeout=300s
kubectl get pvc -n team-alpha | grep gitea
# Should show 2 PVCs
```

### Playwright verify (with 404 handling):

1. Navigate to https://gitea.apps.sre.example.com/
2. If install page: fill in settings (Site Title: "SRE Gitea", admin: sre-test / SreTest123!)
3. Submit install
4. **WAIT 5 SECONDS** — known Gitea post-install 404 issue
5. Navigate to root URL
6. If 404, log "Attempt 1: 404" and wait 3s, retry up to 3 times
7. Login with sre-test / SreTest123!
8. Create repo "platform-test"
9. Push a test file via git clone + git push
10. Verify file shows in UI
11. Delete pod: kubectl delete pod -l app.kubernetes.io/name=gitea -n team-alpha
12. Wait for pod restart
13. Verify repo + file still exist (persistence test for BOTH PVCs)
14. Screenshot EVERY step, including any 404s — label failures clearly

Commit: git commit -m "deploy(team-alpha): gitea — multi-PVC persistence verified with post-install handling"

## PHASE 4: MinIO — Object Storage

```bash
# Check current stable MinIO tag (don't use :latest)
# Use RELEASE.2024-01-16T16-07-38Z or similar dated tag
./scripts/sre-deploy-app.sh \
  --name minio --team team-alpha \
  --image minio/minio --tag RELEASE.2024-01-16T16-07-38Z --port 9000 \
  --extra-port 9001 \
  --command "minio" \
  --args "server /data --console-address :9001" \
  --persist /data:20Gi \
  --run-as-root --singleton \
  --liveness /minio/health/live \
  --readiness /minio/health/ready \
  --env MINIO_ROOT_USER=minioadmin \
  --env MINIO_ROOT_PASSWORD=minioadmin123 \
  --ingress minio.apps.sre.example.com \
  --no-commit
```

Deploy and verify:

```bash
kubectl apply -f apps/tenants/team-alpha/apps/ --recursive 2>&1
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=minio \
  -n team-alpha --timeout=300s
```

### Playwright verify:

NOTE: MinIO console runs on port 9001 but ingress might route to port 9000 (API).
The VirtualService may need to route to the console port for browser access.
If the ingress shows the S3 API (XML response), create a separate ingress for
the console:

```bash
# If needed, create a separate VirtualService for console
./scripts/sre-deploy-app.sh \
  --name minio-console --team team-alpha \
  --image minio/minio --tag RELEASE.2024-01-16T16-07-38Z --port 9001 \
  --ingress minio-console.apps.sre.example.com \
  --no-commit
```

Actually, the better approach: if the deploy script's --extra-port doesn't create
a second VirtualService, just deploy MinIO with port 9001 (console) as the primary:

```bash
./scripts/sre-deploy-app.sh \
  --name minio --team team-alpha \
  --image minio/minio --tag RELEASE.2024-01-16T16-07-38Z --port 9001 \
  --command "minio" \
  --args "server /data --console-address :9001" \
  --persist /data:20Gi \
  --run-as-root --singleton \
  --liveness /minio/health/live \
  --readiness /minio/health/ready \
  --env MINIO_ROOT_USER=minioadmin \
  --env MINIO_ROOT_PASSWORD=minioadmin123 \
  --ingress minio.apps.sre.example.com \
  --no-commit
```

Playwright:
1. Navigate to https://minio.apps.sre.example.com/ (after SSO)
2. Login with minioadmin / minioadmin123
3. Create a bucket "test-bucket"
4. Upload a file
5. Verify file is listed
6. Screenshot each step

Commit: git commit -m "deploy(team-alpha): minio — S3-compatible object storage"

## PHASE 5: Verification Suite

After all 4 apps are deployed, run a comprehensive check:

### 5A: All pods healthy

```bash
echo "=== All pods ==="
kubectl get pods -A | grep -v Running | grep -v Completed
echo "=== Sock Shop ==="
kubectl get pods -n team-sockshop
echo "=== Team Alpha ==="
kubectl get pods -n team-alpha
```

### 5B: All ingress endpoints respond

```bash
for app in sockshop netbox gitea minio; do
  STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "https://${app}.apps.sre.example.com/" 2>/dev/null)
  echo "${app}: ${STATUS}"
done
# All should be 302 (SSO redirect) when unauthenticated
```

### 5C: Service mesh healthy

```bash
kubectl get peerauthentication -A
kubectl get authorizationpolicy -A | wc -l
```

### 5D: Additional ATO evidence

```bash
mkdir -p tests/e2e/round6b/evidence

# Pod inventory across all namespaces
kubectl get pods -A -o wide > tests/e2e/round6b/evidence/all-pods.txt

# PVC inventory (proves persistence is working)
kubectl get pvc -A > tests/e2e/round6b/evidence/all-pvcs.txt

# NetworkPolicy inventory
kubectl get networkpolicy -A > tests/e2e/round6b/evidence/all-netpol.txt

# PolicyException inventory
kubectl get policyexception -A 2>/dev/null > tests/e2e/round6b/evidence/all-policy-exceptions.txt

# Service inventory
kubectl get svc -A > tests/e2e/round6b/evidence/all-services.txt

# VirtualService inventory
kubectl get virtualservice -A > tests/e2e/round6b/evidence/all-virtualservices.txt
```

## PHASE 6: Final Report

Create tests/e2e/round6b/FINAL-REPORT.md:

### Summary Table

| App | Services | Pods | Status | Ingress | Playwright | Evidence |
|-----|----------|------|--------|---------|------------|----------|
| Sock Shop | 13 | ?/26 | ? | sockshop.apps... | ? screenshots | ? |
| NetBox | 4 (app+db+redis+worker) | ?/8 | ? | netbox.apps... | ? screenshots | ? |
| Gitea | 1 | ?/2 | ? | gitea.apps... | ? screenshots | ? |
| MinIO | 1 | ?/2 | ? | minio.apps... | ? screenshots | ? |

### Deploy Script Improvements
- List every flag added or fixed

### Platform Bugs Found
- List with severity and status (fixed/workaround/open)

### Networking Issues
- Document any NetworkPolicy or Istio issues discovered

### ATO Evidence Added
- List all new evidence files collected

### Cumulative Platform Stats
- Total apps deployed: X
- Total pods running: X
- Total PVCs: X
- Total namespaces: X
- Total Kyverno policies: X
- Total NetworkPolicies: X

## COMMIT AND PR

```bash
git add .
git commit -m "feat: Round 6B — deploy Sock Shop (13 svc), NetBox, Gitea, MinIO + fix deploy script

Deploy script upgraded with 17+ flags. 4 complex apps deployed and verified:
- Sock Shop: 13 microservices with inter-service communication
- NetBox: enterprise IPAM with PostgreSQL + Redis + worker
- Gitea: multi-PVC persistence with post-install 404 handling
- MinIO: S3-compatible object storage

3 Round 6 bugs fixed:
- Non-numeric USER handling
- imagePullSecrets auto-detection
- Persist path validation"

git push -u origin feat/round6b-full-deployment
gh pr create --title "feat: Round 6B — 4 complex apps + complete deploy script" \
  --body "$(cat <<'EOF'
## Summary
Completes the integration testing by deploying 4 complex real-world apps to the
live cluster. Upgrades the deploy script with all 17+ flags needed for production use.

## Apps Deployed
- **Sock Shop**: 13 microservices (5 databases, 7 app services, 1 worker, 1 queue)
- **NetBox**: Enterprise IPAM with PostgreSQL, Redis, and background worker
- **Gitea**: Git server with multi-PVC persistence and post-install handling
- **MinIO**: S3-compatible object storage with console UI

## Deploy Script
Now supports: --run-as-root, --persist (multiple), --env (multiple), --extra-port,
--command, --args, --add-capability, --writable-root, --startup-probe, --probe-type,
--config-file, --env-from-secret, --image-pull-secret, --singleton, resource overrides

## Test Plan
- [ ] All Sock Shop pods Running (13 services)
- [ ] Sock Shop UI loads, can browse products and add to cart
- [ ] NetBox UI loads, can create sites/devices
- [ ] Gitea install, login, create repo, push, persistence survives restart
- [ ] MinIO console loads, can create bucket and upload file
- [ ] All apps behind SSO (302 redirect when unauthenticated)
- [ ] No CrashLoopBackOff or Error pods

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
```

---

## Kick-Off Prompt

```
Read docs/round6b-full-deployment-suite.md and execute the prompt in "The Prompt"
section. Fix the deploy script first (Phase 0), then deploy all 4 complex apps.
Playwright-verify each one. Do not stop or ask questions. Start with Phase 0.
```
