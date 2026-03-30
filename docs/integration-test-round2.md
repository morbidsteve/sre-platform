# SRE Platform — Integration Test Round 2 (Complex Deployments)

## Context

Round 1 tested 5 apps (go-httpbin, uptime-kuma, spring-petclinic, fastapi-stack, wordpress).
Results: 18 issues found, 4 fixed during the run, 5 workarounds, 9 remaining gaps.

**Round 1 Findings That MUST Be Fixed Before Round 2:**

| # | Issue | Severity | Status After Round 1 |
|---|-------|----------|---------------------|
| 1 | Hardcoded `runAsUser: 1000` in sre-lib | High | FIXED on branch — needs merge |
| 2 | Default probes `/healthz` `/readyz` fail most apps | Medium | FIXED on branch — needs merge |
| 3 | Liveness delay 10s kills JVM apps | Medium | FIXED on branch — needs merge |
| 4 | No `extraVolumeMounts` in chart | Medium | FIXED on branch — needs merge |
| 5 | Contract requires `harbor.*` prefix | Low | By design — skip |
| 6 | Helm test pod hardcodes busybox | Low | Low priority — skip |
| 7 | Team onboarding doesn't create Harbor project | Medium | NOT FIXED |
| 8 | App runs as root — contract can't express | **High** | **NOT FIXED — #1 gap** |
| 9 | `readOnlyRootFilesystem` blocks stateful apps | **High** | Workaround only — NOT AUTOMATED |
| 10 | WebSocket needs explicit VirtualService config | Medium | Chart supports it — needs docs |
| 11 | SQLite requires `replicas: 1` | Low | Manual override only |
| 12 | No PVC support (data lost on restart) | Medium | NOT FIXED |
| 13 | No `startupProbe` support | Low | NOT FIXED |
| 14 | Multi-container Compose mapping undocumented | Medium | NOT FIXED |
| 15 | No MySQL service (only CNPG PostgreSQL) | High | NOT FIXED — fundamental gap |
| 16 | Port 80 needs `NET_BIND_SERVICE` capability | High | Workaround only — NOT AUTOMATED |
| 17 | App Contract unusable for legacy apps | **High** | **NOT FIXED — same as #8** |
| 18 | No "deploying legacy apps" documentation | Medium | NOT FIXED |

**The core problem:** Round 1 left issues 8, 9, 12, 15, 16, and 17 as "manual HelmRelease
overrides." That means the human still had to hand-craft YAML for any non-trivial app.
Round 2 fixes this. NOTHING should require manual overrides. The platform tooling (App
Contract, Helm charts, generator script, deploy script) must handle every pattern
automatically.

---

## The Test Repos

| # | Repo | Type | Why It's Hard |
|---|------|------|--------------|
| 1 | [microservices-demo/microservices-demo](https://github.com/microservices-demo/microservices-demo) | 11 polyglot microservices | Service mesh stress test: Go, Java, Node.js, Python services + RabbitMQ + MongoDB + MySQL. Inter-service auth, cascading failures, distributed transactions. |
| 2 | [netbox-community/netbox-docker](https://github.com/netbox-community/netbox-docker) | Django enterprise app | PostgreSQL + Redis + background workers (RQ) + LDAP/SSO + file uploads + REST API + web UI. The "enterprise internal tool" pattern. |
| 3 | [n8n-io/n8n](https://github.com/n8n-io/n8n) | Workflow automation | Webhook ingress + worker scaling + credential vault + PostgreSQL + Redis + queue mode. Tests horizontal scaling of workers, persistent encrypted credentials, dynamic webhook routing. |
| 4 | [go-gitea/gitea](https://github.com/go-gitea/gitea) | Self-hosted Git | Dual-protocol ingress (HTTP + SSH), persistent git repos, SQLite/PostgreSQL, webhook delivery to external APIs, LFS storage, SSO/LDAP. |
| 5 | [getredash/redash](https://github.com/getredash/redash) | Data visualization | Python + PostgreSQL + Redis + Celery workers + scheduled query runner + multi-data-source. Tests CronJob scheduling, worker pools, secret management for DB credentials. |

---

## The Prompt

```
You are an autonomous integration test engineer running ROUND 2 of SRE platform
testing. Round 1 tested simple apps and found 18 issues — 4 were fixed, but 9 gaps
remain because the fixes were workarounds, not automation. Your FIRST job is to fix
the platform so those gaps become automated. Your SECOND job is to test 5 complex
enterprise apps and fix MORE gaps.

THE RULE: Nothing is "manual." Every pattern must be expressible through the platform
tooling (App Contract, deploy script, Helm values) without hand-editing HelmRelease YAML.
If a developer has to write raw Helm to deploy, that's a platform bug. Fix the platform.

BRANCH: feat/integration-test-round2

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. FIX THE PLATFORM AS YOU GO — after each repo, edit Helm charts, contracts,
   scripts, policies, and docs so future developers benefit permanently.
3. After EACH repo: commit test report AND platform fixes as separate commits.
4. If a docker build fails, use official Docker Hub images as fallback.
5. If a tool/script doesn't exist, document it as a gap and work around it.
6. Keep a running log at tests/integration/round2/RUN-LOG.md.
7. Before moving to the next repo, run task lint and helm template on changed charts
   to confirm nothing broke.
8. If a fix is too risky, mark "needs human review" and skip. DO NOT break existing
   functionality.
9. These are complex apps — focus on PLATFORM GAPS, not perfect deployments.
   Documenting that "the platform has no pattern for X" is only acceptable if you
   ALSO file a fix or at minimum add the values/schema/docs for it.
10. After every platform fix, re-validate existing charts:
    helm template test apps/templates/web-app/ -f apps/templates/web-app/ci/test-values.yaml
    helm template test apps/templates/api-service/ -f apps/templates/api-service/ci/test-values.yaml
    helm template test apps/templates/worker/ -f apps/templates/worker/ci/test-values.yaml
    If any break, your fix is wrong — revert and try again.

## PHASE 0: FIX ROUND 1 GAPS (before testing ANY new repo)

Round 1 left these as "manual workarounds." Fix them NOW as automated platform features.
After EVERY fix below, run: task lint && helm template with test values to verify.

### Fix 0A: Security Context Overrides in sre-lib + All Charts

THE #1 GAP. Apps that run as root (uptime-kuma, wordpress, many vendor apps) currently
need a hand-crafted HelmRelease. Fix this so the App Contract and deploy script handle it.

1. Read apps/templates/sre-lib/templates/_helpers.tpl
2. The podSecurityContext and containerSecurityContext helpers already support
   .Values.podSecurityContext and .Values.containerSecurityContext overrides — GOOD.
   But the DEFAULTS still hardcode runAsUser: 1000. Fix:
   - Remove runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 from the default pod
     security context. Keep runAsNonRoot: true as the safe default.
   - This way, apps that DON'T set a user get the Kubernetes-assigned UID, and apps
     that NEED root can set podSecurityContext.runAsNonRoot: false.

3. Add these to web-app/values.yaml, api-service/values.yaml, worker/values.yaml,
   AND cronjob/values.yaml (currently missing):
   ```yaml
   # -- Security context overrides (for legacy/vendor apps that need relaxed security)
   # Set these ONLY when the app requires it. Default is maximum security.
   # podSecurityContext: {}
   # containerSecurityContext: {}
   ```

4. Update values.schema.json for ALL charts to allow these optional fields:
   ```json
   "podSecurityContext": {
     "type": "object",
     "description": "Override pod-level security context. Only use for legacy apps."
   },
   "containerSecurityContext": {
     "type": "object",
     "description": "Override container-level security context. Only use for legacy apps."
   }
   ```

5. Update scripts/sre-deploy-app.sh to support:
   --run-as-root        (sets podSecurityContext.runAsNonRoot=false, runAsUser=0)
   --writable-root      (sets containerSecurityContext.readOnlyRootFilesystem=false)
   --add-capability CAP (adds capabilities.add=[CAP] to containerSecurityContext)
   These flags generate the right Helm values automatically. NO manual YAML needed.

6. Validate: helm template with test values for ALL 4 charts. Verify existing apps
   (with no overrides) still get the hardened defaults.

Commit: git commit -m "fix(sre-lib): security context overrides — remove hardcoded UID, support root/writable/capabilities"

### Fix 0B: Persistence (PVC) Support

Round 1 had apps losing data on restart (uptime-kuma, wordpress). Fix:

1. Add to web-app/values.yaml (and api-service, worker):
   ```yaml
   persistence:
     enabled: false
     # Mount path inside the container
     mountPath: "/data"
     # Storage size
     size: "1Gi"
     # Storage class (empty = cluster default)
     storageClass: ""
     # Access mode
     accessModes:
       - ReadWriteOnce
   ```

2. Add PVC template: apps/templates/web-app/templates/pvc.yaml
   ```yaml
   {{- if .Values.persistence.enabled }}
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: {{ include "sre-web-app.fullname" . }}-data
     labels:
       {{- include "sre-web-app.labels" . | nindent 4 }}
   spec:
     accessModes:
       {{- toYaml .Values.persistence.accessModes | nindent 6 }}
     resources:
       requests:
         storage: {{ .Values.persistence.size }}
     {{- if .Values.persistence.storageClass }}
     storageClassName: {{ .Values.persistence.storageClass }}
     {{- end }}
   {{- end }}
   ```

3. Add the volume mount in deployment.yaml (after existing volumeMounts):
   ```yaml
   {{- if .Values.persistence.enabled }}
   - name: data
     mountPath: {{ .Values.persistence.mountPath }}
   {{- end }}
   ```
   And the volume:
   ```yaml
   {{- if .Values.persistence.enabled }}
   - name: data
     persistentVolumeClaim:
       claimName: {{ include "sre-web-app.fullname" . }}-data
   {{- end }}
   ```

4. Update sre-deploy-app.sh:
   --persist PATH:SIZE  (e.g., --persist /app/data:5Gi)
   Generates persistence.enabled=true, mountPath=PATH, size=SIZE

5. Do the same for api-service and worker charts.

Commit: git commit -m "feat(charts): PVC persistence support for stateful apps"

### Fix 0C: Extra Volume Mounts in Deploy Script

The Helm chart already has extraVolumes/extraContainers, but the deploy script doesn't
generate them. Fix sre-deploy-app.sh:
   --extra-volume NAME:PATH    (adds emptyDir volume + mount)
   --extra-volume-pvc NAME:PATH:CLAIM  (adds existing PVC mount)

Commit: git commit -m "feat(deploy): extra volume mount flags"

### Fix 0D: Default Probe Paths

Round 1 found that /healthz and /readyz fail most apps. Fix the DEFAULTS in all
chart values.yaml files:

- web-app: liveness.path: "/" readiness.path: "/"
- api-service: liveness.path: "/" readiness.path: "/"
- worker: (workers often don't have HTTP — default to tcp probe type)
- cronjob: N/A

Also increase default liveness initialDelaySeconds to 15 (was 10) for JVM/heavy apps.

Update sre-deploy-app.sh: --liveness-path and --readiness-path flags already exist,
but verify the DEFAULTS match the chart changes.

Commit: git commit -m "fix(charts): default probe paths to / with 15s liveness delay"

### Fix 0E: startupProbe Support

Many real apps (JVM, Django, Rails) have slow cold starts. Add startupProbe:

1. Add to all chart values.yaml:
   ```yaml
   startupProbe:
     enabled: false
     path: "/"
     initialDelaySeconds: 5
     periodSeconds: 5
     failureThreshold: 30   # 30 × 5s = 150s max startup time
   ```

2. Add to deployment.yaml template (before livenessProbe):
   ```yaml
   {{- if .Values.startupProbe.enabled }}
   startupProbe:
     httpGet:
       path: {{ .Values.startupProbe.path }}
       port: http
     initialDelaySeconds: {{ .Values.startupProbe.initialDelaySeconds }}
     periodSeconds: {{ .Values.startupProbe.periodSeconds }}
     failureThreshold: {{ .Values.startupProbe.failureThreshold }}
   {{- end }}
   ```

3. Update sre-deploy-app.sh: --startup-probe PATH (enables startup probe with path)

Commit: git commit -m "feat(charts): startupProbe support for slow-starting apps"

### Fix 0F: Custom Command/Entrypoint in Worker Chart

Background workers are often the same image as the web app, just different command.
The worker chart needs:

1. Add to worker/values.yaml:
   ```yaml
   app:
     command: []    # Override container command (entrypoint)
     args: []       # Override container args
   ```

2. Add to worker deployment.yaml:
   ```yaml
   {{- with .Values.app.command }}
   command:
     {{- toYaml . | nindent 12 }}
   {{- end }}
   {{- with .Values.app.args }}
   args:
     {{- toYaml . | nindent 12 }}
   {{- end }}
   ```

3. Also add command/args to web-app and api-service (some apps override entrypoint).

4. Update sre-deploy-app.sh: --command "cmd" --args "arg1,arg2"

Commit: git commit -m "feat(charts): custom command/args for all chart types"

### Fix 0G: Singleton Worker Support (maxReplicas: 1)

Celery Beat, RQ schedulers, and similar MUST run exactly 1 replica. Add:

1. worker/values.yaml:
   ```yaml
   singleton: false  # When true, forces replicas=1 and disables HPA
   ```

2. worker deployment.yaml: when singleton=true, set replicas: 1 regardless of HPA.

Commit: git commit -m "feat(worker): singleton mode for scheduler/beat workers"

### Fix 0H: Compose-to-SRE Translation Documentation

Round 1 showed multi-container apps have no clear deployment path. Create:
docs/developer-guides/compose-to-sre.md

Contents:
- How to read a docker-compose.yml and map services to SRE charts
- Web frontend → web-app, API backend → api-service, background job → worker, cron → cronjob
- Database → platform CNPG (PostgreSQL) or bring-your-own (standalone Deployment)
- Redis → platform Redis service
- Message queue → standalone StatefulSet pattern
- Example: full mapping of a 4-service compose app
- Common pitfalls: networking, shared env vars, startup ordering

Commit: git commit -m "docs: compose-to-SRE translation guide"

### Fix 0I: Non-PostgreSQL Database Documentation

Round 1's WordPress needed MySQL, which the platform doesn't provide. Create:
docs/developer-guides/bring-your-own-database.md

Contents:
- Platform provides PostgreSQL (CNPG) and Redis out of the box
- For MySQL, MongoDB, etc.: deploy as a standalone StatefulSet or use an external managed service
- Template: standalone MySQL StatefulSet with persistence, security context, NetworkPolicy
- Template: standalone MongoDB StatefulSet
- How to connect your app to the standalone DB (env vars, NetworkPolicy allows)
- ExternalSecret pattern for DB credentials

Also create: apps/templates/standalone-db/ with a minimal StatefulSet Helm chart
for deploying arbitrary database containers alongside apps.

Commit: git commit -m "docs: bring-your-own-database guide + standalone DB template"

### Fix 0J: Legacy App Deployment Documentation

Create: docs/developer-guides/deploying-legacy-apps.md

Contents:
- What makes an app "legacy" (root user, writable FS, privileged ports, non-12-factor)
- Step-by-step: use deploy script with --run-as-root --writable-root --add-capability
- Security review process (these flags trigger Kyverno PolicyException, needs ISSM approval)
- Examples: WordPress, vendor COTS software, PHP apps, legacy Java (Tomcat with webapps/)
- Kyverno PolicyException: explain what it does, when it's needed, how to request

Commit: git commit -m "docs: deploying legacy apps guide"

### Phase 0 Validation

After all fixes, run full validation:
```bash
task lint
helm template test apps/templates/web-app/ -f apps/templates/web-app/ci/test-values.yaml
helm template test apps/templates/api-service/ -f apps/templates/api-service/ci/test-values.yaml
helm template test apps/templates/worker/ -f apps/templates/worker/ci/test-values.yaml
helm template test apps/templates/cronjob/ -f apps/templates/cronjob/ci/test-values.yaml
```

Then RE-TEST Round 1 apps with the improved platform:

1. **go-httpbin** — deploy via sre-deploy-app.sh (no flags). Should work as before.
2. **uptime-kuma** — deploy via:
   ```bash
   ./scripts/sre-deploy-app.sh --name uptime-kuma --team team-test \
     --image louislam/uptime-kuma --tag 1 --port 3001 \
     --run-as-root --writable-root --persist /app/data:1Gi --no-commit
   ```
   This MUST generate a working HelmRelease with NO manual YAML editing.
3. **wordpress** — deploy via:
   ```bash
   ./scripts/sre-deploy-app.sh --name wordpress --team team-test \
     --image wordpress --tag 6.7-php8.2-apache --port 80 \
     --run-as-root --writable-root --add-capability NET_BIND_SERVICE \
     --persist /var/www/html:5Gi --no-commit
   ```
   This MUST generate a working HelmRelease with NO manual YAML editing.

If any of these fail, the Phase 0 fixes are incomplete. Go back and fix them.
Do NOT proceed to Phase 1 until Round 1 apps work through automation.

Commit: git commit -m "test(integration): phase 0 — round 1 re-validation with automated fixes"

## SETUP

```bash
mkdir -p tests/integration/round2/sock-shop
mkdir -p tests/integration/round2/netbox
mkdir -p tests/integration/round2/n8n
mkdir -p tests/integration/round2/gitea
mkdir -p tests/integration/round2/redash
mkdir -p /tmp/test-repos-r2
```

Create tests/integration/round2/RUN-LOG.md with header and timestamp.

## THE FIX-AS-YOU-GO CYCLE (same as Round 1, but stricter)

For EVERY repo:
```
Step 1: UNDERSTAND — Clone, read docker-compose.yml, map services to SRE app types
Step 2: DEPLOY — Use sre-deploy-app.sh or App Contract. If you have to hand-write
        HelmRelease YAML, that's a platform bug. Fix the tooling FIRST, then deploy.
Step 3: VALIDATE — helm template dry-run, task validate
Step 4: DOCUMENT — Issues with WHAT, WHY, WHO affected, SEVERITY
Step 5: FIX THE PLATFORM — Edit actual platform files (charts, contracts, scripts,
        docs, policies). After each fix: task lint + helm template to verify.
        CRITICAL: The fix must be AUTOMATED — a flag, a values field, a script feature.
        "Add this YAML manually" is NOT a fix. It's a workaround. Fix the tooling.
Step 6: DEPLOY AGAIN — Re-run with fixed platform to prove the fix works
Step 7: REPORT + COMMIT — test report and platform fixes as separate commits
```

---

## REPO 1: Sock Shop — Microservices Stress Test

SOURCE: https://github.com/microservices-demo/microservices-demo
WHAT: Canonical e-commerce microservices demo — 11 services in 5 languages

### Service Mapping (compose → SRE)

Map these from the docker-compose.yml:

| Compose Service | Language | SRE Chart | Port | Notes |
|----------------|----------|-----------|------|-------|
| front-end | Node.js | web-app | 8079 | Main UI, ingress |
| catalogue | Go | api-service | 80 | Product catalog API |
| catalogue-db | MySQL | standalone-db | 3306 | Use new standalone DB template |
| carts | Java | api-service | 80 | Shopping cart API |
| carts-db | MongoDB | standalone-db | 27017 | Use new standalone DB template |
| orders | Java | api-service | 80 | Order processing |
| orders-db | MongoDB | standalone-db | 27017 | Shared with carts-db or separate? |
| payment | Go | api-service | 80 | Payment processing |
| user | Go | api-service | 80 | User authentication |
| user-db | MongoDB | standalone-db | 27017 | User data |
| shipping | Java | worker | — | Async shipping via RabbitMQ |
| queue-master | Java | worker | — | RabbitMQ consumer |
| rabbitmq | — | standalone-db | 5672/15672 | Message broker — use standalone template |

### Key Challenges to Test

a) **11 services = 11 deploys** — Does sre-deploy-app.sh handle bulk deployment cleanly?
   Can you script: `for svc in front-end catalogue carts orders payment user shipping; do ./scripts/sre-deploy-app.sh --name $svc ...; done`?
   If not, add bulk deploy support or a manifest file that describes all services.

b) **3 databases (MySQL + MongoDB × 2)** — Use the new standalone-db template from Fix 0I.
   If the template doesn't cover MongoDB, extend it. AUTOMATE IT.

c) **RabbitMQ message queue** — Deploy via standalone-db template or create a new
   "standalone-stateful" chart. Workers need RABBITMQ_URL env var. The deploy script
   should handle --env "RABBITMQ_URL=amqp://rabbitmq:5672" cleanly.

d) **Inter-service networking** — All 11 services need to talk to each other and to
   databases. The default NetworkPolicy allows same-namespace traffic (good). Verify
   it works with 11 services. If it doesn't, fix the NetworkPolicy template.

e) **Mixed resource profiles** — Go services: small (128Mi). Java services: medium (512Mi).
   Node.js: small-medium. The deploy script's resource handling must work for each.
   Add --resources small|medium|large|custom if not already there.

f) **Port 80 services** — catalogue, carts, orders, payment, user all listen on 80.
   With Phase 0 Fix 0A, --add-capability NET_BIND_SERVICE should handle this.
   Verify it works across multiple services.

### Platform Improvements Expected

After Sock Shop, the platform should have:
- Bulk deployment pattern (script or manifest for multi-service apps)
- Standalone StatefulSet template handling MySQL, MongoDB, RabbitMQ
- Proven inter-service networking for 11+ services in one namespace
- Documentation for deploying microservices architectures

Write: tests/integration/round2/sock-shop/report.md
Commit report, then commit platform fixes separately.

---

## REPO 2: NetBox — Enterprise Django App

SOURCE: https://github.com/netbox-community/netbox-docker
WHAT: Network infrastructure management tool. Django + PostgreSQL + Redis + workers.
Used by ISPs, data centers, and government agencies for DCIM/IPAM.

### Service Mapping

| Compose Service | SRE Chart | Port | Notes |
|----------------|-----------|------|-------|
| netbox | web-app | 8080 | Django app server (Gunicorn) |
| netbox-worker | worker | — | RQ (Redis Queue) background worker — SAME IMAGE, different command |
| netbox-housekeeping | cronjob | — | Periodic cleanup — SAME IMAGE, different command |
| postgres | platform CNPG | 5432 | PostgreSQL — use platform service |
| redis | platform Redis | 6379 | Use platform Redis service |
| redis-cache | platform Redis | 6379 | Second Redis for caching |

### Key Challenges to Test

a) **Same image, three roles** — netbox, netbox-worker, netbox-housekeeping all use the
   same Docker image with different commands. With Fix 0F (custom command/args),
   deploy each via the deploy script:
   ```bash
   # Web app
   ./scripts/sre-deploy-app.sh --name netbox --chart web-app --command "/opt/netbox/launch.sh" ...
   # Worker
   ./scripts/sre-deploy-app.sh --name netbox-worker --chart worker --command "/opt/netbox/launch-worker.sh" ...
   # Housekeeping
   ./scripts/sre-deploy-app.sh --name netbox-housekeeping --chart cronjob --command "/opt/netbox/housekeeping.sh" ...
   ```
   If the deploy script can't express this, FIX IT.

b) **Two Redis instances** — NetBox needs Redis for queue AND cache on different DBs.
   If platform Redis only gives one, the deploy script needs:
   --redis-db 0 (for queue) on the worker, and a second Redis instance or DB index.
   Fix: add redis.database field to values, or deploy a second Redis via standalone.

c) **Shared environment** — Web, worker, and housekeeping all need the same DB URL,
   Redis URL, and SECRET_KEY. The deploy script should support:
   --env-from-secret netbox-shared-env (a single Secret with all shared vars)
   or at minimum --env "KEY=VALUE" repeated for each.

d) **File uploads** — NetBox stores media at /opt/netbox/netbox/media/.
   Use --persist /opt/netbox/netbox/media:5Gi from Fix 0B.

e) **Secrets at scale** — NetBox needs 5+ secrets. The ExternalSecret pattern should
   scale. Create a single ExternalSecret that syncs multiple keys, or document how
   to deploy multiple ExternalSecrets via the tooling.

f) **Static files** — Django collectstatic needs writable /opt/netbox/netbox/static/.
   Use --extra-volume static:/opt/netbox/netbox/static (emptyDir) from Fix 0C,
   with an init container running collectstatic.

### Platform Improvements Expected

- Shared env pattern across web + worker + cronjob (same app, different roles)
- Multiple secrets per app via ExternalSecret
- Init container for Django collectstatic pattern (documented)
- Second Redis instance pattern

Write: tests/integration/round2/netbox/report.md

---

## REPO 3: n8n — Workflow Automation with Webhook Ingress

SOURCE: https://github.com/n8n-io/n8n
WHAT: Low-code workflow automation (like Zapier). Node.js, PostgreSQL, Redis,
webhook ingress, encrypted credential storage. 50K+ stars.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| n8n (main) | web-app | 5678 | Web UI + API + webhook receiver |
| n8n (worker) | worker | — | Queue mode: separate worker processes, same image |
| PostgreSQL | platform CNPG | 5432 | Workflow storage |
| Redis | platform Redis | 6379 | Queue backend for worker mode |

### Key Challenges to Test

a) **Webhook ingress routing** — n8n receives webhooks at /webhook/* and /webhook-test/*.
   External services POST to these. The VirtualService needs wildcard path routing.
   If the chart's ingress only supports a single host, add path-based routing support.
   Fix the web-app VirtualService template if needed.

b) **Worker mode** — Same image, different command (n8n worker vs n8n start).
   Deploy main via web-app with --command, worker via worker chart with --command.
   Shared ENCRYPTION_KEY across both — use shared secret pattern from NetBox.

c) **Persistent storage** — n8n stores files at ~/.n8n/. Use --persist /home/node/.n8n:5Gi.
   The app runs as node (uid 1000) — default security context should work without --run-as-root.

d) **Long-running webhooks** — Some hold connections 30+ seconds. The Istio VirtualService
   may need timeout configuration. Add timeout field to web-app values if not present:
   ```yaml
   ingress:
     timeout: "60s"  # Default 60s, increase for webhook-heavy apps
   ```

e) **Dynamic webhook paths** — When users create workflows, new webhook paths appear.
   The VirtualService routes /webhook/* as wildcard — verify this works without
   VirtualService updates.

### Platform Improvements Expected

- VirtualService path prefix routing (not just host-based)
- Ingress timeout configuration
- Shared secrets across deployments verified at scale

Write: tests/integration/round2/n8n/report.md

---

## REPO 4: Gitea — Dual-Protocol Ingress (HTTP + SSH)

SOURCE: https://github.com/go-gitea/gitea
WHAT: Self-hosted Git service. Go binary, SQLite/PostgreSQL, HTTP + SSH,
webhooks, LFS storage. 46K+ stars. Used by governments and enterprises.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| gitea | web-app | 3000 (HTTP), 22 (SSH) | Dual-protocol — this is the hard part |
| PostgreSQL | platform CNPG | 5432 | Use platform service |

### Key Challenges to Test

a) **Dual-protocol ingress** — Gitea serves HTTP on 3000 AND SSH on 22. Istio handles
   HTTP fine, but SSH is TCP. Options:
   - Add a second Service (type: LoadBalancer or NodePort) for SSH
   - Add Istio TCP routing via Gateway + VirtualService
   If the web-app chart only creates one Service with one port, add:
   ```yaml
   extraPorts:
     - name: ssh
       port: 22
       targetPort: 22
       protocol: TCP
   ```
   And a second Service or update the existing one. FIX THE CHART.

b) **SSH on port 22** — Privileged port. Use --add-capability NET_BIND_SERVICE OR
   reconfigure Gitea to use 2222. Document both approaches.

c) **Persistent git repos** — /data/gitea/ needs large PVC. Use --persist /data:20Gi.

d) **ConfigMap for app.ini** — Gitea uses INI config file, not just env vars. Add:
   ```yaml
   configMaps:
     - name: gitea-config
       mountPath: /data/gitea/conf
       data:
         app.ini: |
           ...
   ```
   If the chart doesn't support ConfigMap mounts, add it.

e) **Dynamic egress for webhooks** — Gitea sends webhooks to arbitrary URLs users
   configure. Default NetworkPolicy blocks this. The chart has additionalEgress,
   but the deploy script doesn't expose it. Add:
   --allow-egress-all (adds 0.0.0.0/0 to egress — documented security exception)

### Platform Improvements Expected

- Multi-port / dual-protocol Service support in charts
- TCP ingress pattern documentation (SSH, gRPC, databases)
- ConfigMap mount support via deploy script
- Dynamic egress flag in deploy script
- Large PVC documentation (20Gi+)

Write: tests/integration/round2/gitea/report.md

---

## REPO 5: Redash — Data Visualization with Celery Workers

SOURCE: https://github.com/getredash/redash
WHAT: Data visualization and dashboarding. Python + PostgreSQL + Redis + Celery.
Connect to any database, write queries, build dashboards. 27K+ stars.

### Service Mapping

| Compose Service | SRE Chart | Port | Notes |
|----------------|-----------|------|-------|
| server | web-app | 5000 | Flask web app + API |
| scheduler | worker (singleton) | — | Celery Beat — MUST be exactly 1 replica |
| scheduled_worker | worker | — | Celery workers for scheduled queries |
| adhoc_worker | worker | — | Celery workers for ad-hoc queries |
| postgres | platform CNPG | 5432 | Metadata storage |
| redis | platform Redis | 6379 | Celery broker + cache |

### Key Challenges to Test

a) **Singleton scheduler** — Celery Beat MUST run exactly 1 instance. Use Fix 0G:
   ```bash
   ./scripts/sre-deploy-app.sh --name redash-scheduler --chart worker \
     --singleton --command "celery" --args "-A redash.worker beat" ...
   ```
   Verify HPA is disabled and replicas=1 is enforced.

b) **Multiple worker pools** — scheduled_worker and adhoc_worker are same image,
   different Celery queue arguments. Deploy each as separate worker:
   ```bash
   ./scripts/sre-deploy-app.sh --name redash-scheduled-worker --chart worker \
     --command "celery" --args "-A redash.worker worker --queues scheduled" ...
   ./scripts/sre-deploy-app.sh --name redash-adhoc-worker --chart worker \
     --command "celery" --args "-A redash.worker worker --queues queries" ...
   ```

c) **Shared credentials** — All 4 components (server, scheduler, 2 workers) share
   REDASH_COOKIE_SECRET, DATABASE_URL, REDIS_URL. Test the shared secret pattern.

d) **Different resource profiles** — Server needs medium (API serving). Workers need
   large (query execution, can use GBs of RAM for big queries). Scheduler needs small.
   Deploy each with appropriate --resources flag.

e) **External database connections** — Redash connects to arbitrary external databases
   for querying. NetworkPolicy must allow egress to those hosts. Use
   --allow-egress-all or --additional-egress for specific hosts.

f) **Same image, 4 deployments** — All use getredash/redash:latest (pin to specific tag).
   Only difference is the command. This is the ultimate test of Fix 0F.

### Platform Improvements Expected

- Singleton worker verified working
- 4 deployments from 1 image verified working
- Shared secret pattern verified at scale (4 consumers)
- Resource profile differentiation per component

Write: tests/integration/round2/redash/report.md

---

## PHASE 2: SYNTHESIS

After all 5 repos, create:

### tests/integration/round2/SUMMARY.md

Consolidated issue table:
| Issue | Repos Affected | Severity | Category | Fixed? | How |
|-------|---------------|----------|----------|--------|-----|

Categories for Round 2:
- **Multi-Service**: compose translation, startup ordering, shared config
- **Non-HTTP Protocols**: SSH, gRPC, TCP, message queues
- **Stateful Services**: databases, queues, persistent storage
- **Worker Patterns**: singletons, multiple pools, custom commands
- **Dynamic Networking**: webhook ingress, arbitrary egress, inter-service discovery
- **Credential Sharing**: same secret across multiple deployments
- **Security Overrides**: root users, writable FS, capabilities

### tests/integration/round2/IMPROVEMENTS.md

Every platform change made during Phase 0 + Phase 1:
| File | Change | Why | Fixed In (Phase/Repo) |
|------|--------|-----|----------------------|

### tests/integration/round2/PLATFORM-MATURITY.md

Score the platform:

| Pattern | Before Round 2 | After Round 2 | Target |
|---------|---------------|---------------|--------|
| Single stateless app (go-httpbin) | 1 command | ? | 1 command |
| Stateful Node.js app (uptime-kuma) | manual YAML | ? | 1 command + flags |
| Legacy PHP app (wordpress) | manual YAML | ? | 1 command + flags |
| App + PostgreSQL + Redis | 2 steps | ? | 1-2 steps |
| App + workers (same image) | undocumented | ? | 3 commands |
| Multi-service (3-5 services) | undocumented | ? | scripted pattern |
| Multi-service (10+ services) | impossible | ? | documented pattern |
| Non-HTTP ingress (SSH/gRPC) | unsupported | ? | documented pattern |
| Non-PostgreSQL database | unsupported | ? | standalone-db template |
| Message queue (RabbitMQ/Redis) | unsupported | ? | standalone template |
| Singleton worker | unsupported | ? | --singleton flag |
| Dynamic webhook ingress | unsupported | ? | VirtualService wildcard |
| Dynamic egress (arbitrary hosts) | blocked | ? | --allow-egress-all flag |

## PHASE 3: RE-TEST

Re-deploy NetBox (the most "enterprise standard" app) from SCRATCH using only
sre-deploy-app.sh with flags. No hand-written YAML. Create:
tests/integration/round2/RETEST-RESULTS.md

## PHASE 4: FINAL REPORT

Create tests/integration/round2/FINAL-REPORT.md:
1. Executive summary
2. Phase 0 results (Round 1 gap closure — how many gaps became automated?)
3. All 5 repos: issues, fixes, remaining gaps
4. Platform maturity scores (before vs after)
5. Round 1 vs Round 2 comparison
6. Top 10 recommended improvements (prioritized for real-world impact)
7. "Can a developer deploy this with ZERO manual YAML?" assessment per app pattern

Commit: git commit -m "test(integration): round 2 final report"
```

---

## Running Order

```
Phase 0: Fix Round 1 gaps (10 fixes + validation)
Phase 0 validation: Re-test go-httpbin, uptime-kuma, wordpress via deploy script
Repo 1: Sock Shop      — microservices mesh, the big one
Repo 2: NetBox          — enterprise Django, workers, multi-Redis
Repo 3: n8n             — webhooks, worker scaling, encrypted vault
Repo 4: Gitea           — dual-protocol (HTTP+SSH), persistent git repos
Repo 5: Redash          — Celery workers, singleton scheduler, data sources
Phase 2: Synthesis
Phase 3: Re-test NetBox from scratch
Phase 4: Final report
```

## Kick-Off Prompt (paste into Claude Code after Round 1 finishes)

```
Round 1 integration testing is done. Now run Round 2 with complex enterprise apps.
Read docs/integration-test-round2.md for the full plan, then execute the prompt
in "The Prompt" section. IMPORTANT: Start with Phase 0 — fix ALL Round 1 gaps
so they're automated (deploy script flags, not manual YAML). Do not proceed to
the 5 new repos until uptime-kuma and wordpress deploy via sre-deploy-app.sh
with flags only. Work continuously, do not stop or ask questions.
```
