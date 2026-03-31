---

## REPO 1: Ollama — AI/ML Inference Server

SOURCE: https://github.com/ollama/ollama
WHAT: Local LLM inference server. Runs models like Llama, Mistral, Gemma.
REST API + optional GPU acceleration + model storage.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| ollama | api-service | 11434 | REST API for model inference |

Single service, but the HARDEST deployment pattern: huge storage, high resources,
optional GPU, streaming responses, very slow startup (model loading).

### Key Challenges to Test

a) **Large model storage** — Models are 4-70GB. Needs large PVC (100Gi+).
   Use --persist /root/.ollama:100Gi. Test that large PVC values work.

b) **High resource requirements** — Inference needs 8Gi+ RAM, 4+ CPU for CPU mode.
   Deploy with --resources custom and explicit limits. If deploy script only supports
   presets (small/medium/large), add --cpu and --memory flags for custom resources:
   --cpu-request 4 --cpu-limit 8 --memory-request 8Gi --memory-limit 16Gi

c) **Streaming HTTP responses** — Ollama streams tokens via chunked transfer encoding.
   Istio and the VirtualService must not buffer the response. Test that streaming
   works through the ingress. If buffering is an issue, add annotation support:
```yaml
   ingress:
     annotations: {}  # Pass-through to VirtualService/Gateway annotations
```

d) **Very slow startup** — Loading a 7B model takes 30-60 seconds. Loading 70B can
   take minutes. The startupProbe from Round 2 Phase 0 should handle this.
   Deploy with --startup-probe /api/tags (Ollama's health endpoint).
   Set failureThreshold high: startupProbe.failureThreshold: 60 (5 minutes).

e) **Root user** — Ollama runs as root by default for GPU access.
   Deploy with --run-as-root.

f) **Non-standard port** — 11434. Verify the deploy script handles any port.

g) **GPU passthrough (documentation only)** — Kubernetes GPU support requires:
   - NVIDIA device plugin DaemonSet
   - Node labels (nvidia.com/gpu)
   - Resource requests (nvidia.com/gpu: 1)
   - RuntimeClass for nvidia
   The platform doesn't have GPU support yet. Document the pattern:
   docs/developer-guides/gpu-workloads.md

### Platform Improvements Expected

- Custom resource flags (--cpu-request, --memory-request, etc.)
- Large PVC support (100Gi+) verified
- Streaming response documentation
- GPU workload documentation
- startupProbe with high failureThreshold verified

Write: tests/integration/round3/ollama/report.md

---

## REPO 2: gRPC Service — Pure gRPC Protocol

SOURCE: Build from https://github.com/grpc/grpc-go (examples/helloworld)
WHAT: Pure gRPC service — no HTTP at all. Tests the platform's non-HTTP story.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| greeter-server | api-service | 50051 | gRPC server |

### Key Challenges to Test

a) **gRPC health probes** — Standard HTTP probes fail on gRPC services. Use the
   gRPC probe support added in Phase 0 Fix 0F:
   --probe-type grpc
   Kubernetes 1.24+ has native gRPC probe support. Verify it renders correctly.

b) **gRPC ingress via Istio** — Istio VirtualService supports gRPC routing, but
   the chart's VirtualService template may assume HTTP. gRPC uses HTTP/2.
   The VirtualService template needs:
```yaml
   http:
     - match:
         - port:
             number: {{ .Values.app.port }}
       route:
         - destination:
             host: {{ .Values.app.name }}
             port:
               number: {{ .Values.app.port }}
```
   This actually works for both HTTP and gRPC (Istio auto-detects HTTP/2).
   But the Service needs appProtocol: grpc annotation. Add:
```yaml
   app:
     protocol: "http"  # http | grpc | tcp
```
   When protocol=grpc, Service gets appProtocol: grpc and Istio routes correctly.

c) **Building the service** — grpc-go examples don't have Dockerfiles. Create one:
```dockerfile
   FROM golang:1.22-alpine AS build
   WORKDIR /app
   COPY . .
   RUN go build -o /server ./examples/helloworld/greeter_server/main.go
   FROM alpine:3.19
   COPY --from=build /server /server
   EXPOSE 50051
   CMD ["/server"]
```

d) **gRPC reflection** — Many gRPC tools (grpcurl) use server reflection.
   Verify NetworkPolicy doesn't block the reflection protocol.

e) **Protocol in deploy script** — Add: --protocol grpc (sets appProtocol on
   Service, adjusts probe type to grpc, adds http2 annotation to VirtualService)

### Platform Improvements Expected

- --protocol flag (http/grpc/tcp) in deploy script
- Service appProtocol annotation support
- gRPC probe verified working
- gRPC ingress via Istio documented

Write: tests/integration/round3/grpc-service/report.md

---

## REPO 3: Rocket.Chat — Realtime WebSocket Messaging

SOURCE: https://github.com/RocketChat/Rocket.Chat
WHAT: Open-source Slack alternative. Node.js + MongoDB + heavy WebSocket traffic +
file uploads + OAuth SSO. 41K+ stars.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| rocketchat | web-app | 3000 | Node.js app (HTTP + WebSocket) |
| mongodb | stateful | 27017 | Use new standalone StatefulSet chart |

### Key Challenges to Test

a) **Heavy WebSocket traffic** — Rocket.Chat holds persistent WebSocket connections
   for all active users. Hundreds of concurrent WebSocket connections per pod.
   The websocket: true flag from Round 2 should handle this. Verify Istio doesn't
   drop idle WebSocket connections (default idle timeout may be too low).
   If needed, add WebSocket idle timeout to chart values.

b) **MongoDB via StatefulSet** — Use the new stateful chart from Phase 0 Fix 0C:
```bash
   ./scripts/sre-deploy-app.sh --name rocketchat-mongodb --chart stateful \
     --image mongo --tag 6.0 --port 27017 \
     --persist /data/db:20Gi --run-as-root ...
```

c) **File uploads** — Rocket.Chat stores uploaded files. Options: filesystem PVC
   or GridFS (MongoDB). For filesystem: --persist /app/uploads:10Gi.
   For GridFS: no PVC needed but MongoDB needs more storage.

d) **OAuth/SSO integration** — Rocket.Chat supports OIDC. In the SRE platform,
   Keycloak is the IdP. Document how to configure an app to use Keycloak OIDC:
   - Create OIDC client in Keycloak
   - Pass OIDC env vars (client ID, secret, discovery URL)
   - Istio needs to allow callbacks from the IdP
   Create: docs/developer-guides/keycloak-oidc-integration.md

e) **Connection scaling** — WebSocket connections are stateful. If a pod restarts,
   all connected users disconnect. PodDisruptionBudget (already in chart) helps,
   but rolling updates still disconnect users. Document graceful WebSocket
   handling (drain connections before shutdown via preStop hook).

f) **ROOT_URL configuration** — Rocket.Chat needs to know its external URL for
   OAuth callbacks and email links. This is the ingress host, but the app doesn't
   auto-detect it. Many apps have this pattern. Document: "how to pass the
   ingress URL as an env var to the app."

### Platform Improvements Expected

- Istio WebSocket idle timeout configuration
- Keycloak OIDC integration documentation
- MongoDB deployment via StatefulSet chart verified
- WebSocket connection draining documentation

Write: tests/integration/round3/rocketchat/report.md

---

## REPO 4: Casdoor — OAuth/OIDC Provider

SOURCE: https://github.com/casdoor/casdoor
WHAT: Open-source IAM / SSO platform. Go binary + MySQL/PostgreSQL + Redis.
Similar to Keycloak but lightweight. Tests the "deploy an auth provider" pattern.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| casdoor | web-app | 8000 | Go binary, serves UI + API + OIDC endpoints |
| PostgreSQL | platform CNPG | 5432 | Use platform service |
| Redis | platform Redis | 6379 | Session storage |

### Key Challenges to Test

a) **OAuth callback routing** — Casdoor serves OIDC endpoints at /.well-known/,
   /api/login/oauth, /callback, etc. These MUST be routable from outside the
   cluster. External IdPs (Google, GitHub) redirect users back to these URLs.
   Verify the VirtualService routes all paths correctly (not just /).

b) **TLS requirements** — OAuth requires HTTPS. The Istio gateway handles TLS
   termination, but Casdoor needs to know the external HTTPS URL for generating
   correct redirect URIs. Same ROOT_URL pattern as Rocket.Chat.

c) **Session storage** — Casdoor uses Redis for sessions. Sessions must survive
   pod restarts (stateless app with external state — the ideal pattern).
   Use platform Redis: --env "REDIS_URL=redis://redis:6379".

d) **Configuration file** — Casdoor uses conf/app.conf. Use --config-file from
   Phase 0 Fix 0D:
```bash
   ./scripts/sre-deploy-app.sh --name casdoor \
     --config-file ./casdoor-app.conf:/conf/app.conf ...
```

e) **Static assets** — Casdoor serves a React frontend from its binary. Some
   paths (/static/*) are static assets. Verify no conflicts with VirtualService.

f) **Database migrations** — Casdoor auto-migrates on startup. If startup is slow
   due to migrations, the startup probe catches it. Verify.

### Platform Improvements Expected

- OAuth callback routing verified through Istio
- ConfigMap mount via deploy script verified
- "Deploy an auth provider" pattern documented
- External HTTPS URL pattern documented (ROOT_URL / BASE_URL / PUBLIC_URL)

Write: tests/integration/round3/casdoor/report.md

---

## REPO 5: MinIO — Distributed Object Storage

SOURCE: https://github.com/minio/minio
WHAT: S3-compatible object storage. Can run single-node or distributed (4+ nodes
with erasure coding). Dual API: S3 on 9000, Console UI on 9001.

### Service Mapping

| Component | SRE Chart | Port | Notes |
|-----------|-----------|------|-------|
| minio | stateful | 9000 (S3 API), 9001 (Console) | Dual-port, persistent storage |

### Key Challenges to Test

a) **Distributed mode (multi-replica StatefulSet)** — MinIO in distributed mode
   needs 4+ replicas with stable hostnames (minio-0, minio-1, etc.) and each
   node needs its own PVC. This is the StatefulSet chart's hardest test.
   Deploy with: --chart stateful --replicas 4 --persist /data:50Gi

b) **Dual-port Service** — S3 API on 9000, Console on 9001. Use --extra-port:
   --extra-port console:9001:9001:TCP
   Both need ingress: S3 API for application access, Console for admin UI.
   May need two VirtualServices or path-based routing.

c) **Inter-node TLS** — In distributed mode, MinIO nodes communicate with each other
   using TLS. Istio mTLS handles this transparently (pod-to-pod is already encrypted).
   Verify Istio doesn't interfere with MinIO's internal protocol.

d) **Large PVC** — Object storage = lots of data. 50Gi-500Gi per node. Verify
   the StatefulSet chart's volumeClaimTemplates handle large sizes.

e) **S3 API compatibility** — The S3 API uses non-standard HTTP (PUT with Content-MD5,
   chunked upload, presigned URLs). Verify Istio doesn't interfere with these.
   If buffering is an issue, document: disable Istio buffering for storage APIs.

f) **Health endpoints** — MinIO has /minio/health/live (liveness) and
   /minio/health/ready (readiness) on the S3 API port. Non-standard paths.
   Deploy with --liveness-path /minio/health/live --readiness-path /minio/health/ready

g) **Access credentials** — MinIO needs MINIO_ROOT_USER and MINIO_ROOT_PASSWORD.
   Use --env-from-secret minio-credentials.

### Platform Improvements Expected

- Multi-replica StatefulSet with volumeClaimTemplates verified
- Dual-port ingress pattern documented
- Large PVC (50Gi+) per replica verified
- S3 API through Istio verified
- Distributed stateful app deployment pattern documented

Write: tests/integration/round3/minio/report.md

---

## PHASE 2: SYNTHESIS

After all 5 repos, create:

### tests/integration/round3/SUMMARY.md

| Issue | Repos Affected | Severity | Category | Fixed? | How |
|-------|---------------|----------|----------|--------|-----|

New categories for Round 3:
- **AI/ML Workloads**: GPU, large storage, streaming, slow startup
- **Protocol Support**: gRPC, WebSocket, S3, TCP
- **Authentication Patterns**: OAuth callbacks, OIDC discovery, session storage
- **Distributed Systems**: StatefulSet, inter-node communication, erasure coding
- **Resource Scaling**: Custom CPU/memory, large PVC, connection limits

### tests/integration/round3/IMPROVEMENTS.md

Every platform change from Phase 0 + repos:
| File | Change | Why | Fixed In (Phase/Repo) |
|------|--------|-----|----------------------|

### tests/integration/round3/PLATFORM-MATURITY.md

| Pattern | Round 1 | Round 2 | Round 3 | Target |
|---------|---------|---------|---------|--------|
| Single stateless app | manual | 1 cmd | ? | 1 cmd |
| Stateful app (PVC) | impossible | 1 cmd + flags | ? | 1 cmd + flags |
| Legacy/root app | manual YAML | 1 cmd + flags | ? | 1 cmd + flags |
| App + PostgreSQL + Redis | 2 steps | 2 steps | ? | 1-2 steps |
| App + workers (same image) | undocumented | 3 cmds | ? | 3 cmds |
| Multi-service (10+) | impossible | scripted | ? | scripted |
| gRPC service | unsupported | unsupported | ? | 1 cmd + --protocol grpc |
| AI/ML inference | unsupported | unsupported | ? | 1 cmd + large resources |
| Distributed StatefulSet | unsupported | unsupported | ? | 1 cmd + --chart stateful |
| OAuth provider | unsupported | unsupported | ? | 1 cmd + docs |
| Non-HTTP ingress (SSH) | unsupported | gap | ? | --extra-port flag |
| WebSocket-heavy app | partial | supported | ? | supported + idle timeout |
| Dynamic egress | blocked | --allow-egress-all | ? | flag + docs |
| Shared credentials | 32 flags | 32 flags | ? | --env-from-secret |
| ConfigMap mount | unsupported | gap | ? | --config-file flag |

## PHASE 3: RE-TEST

Re-deploy MinIO (distributed mode, 4 replicas) from SCRATCH using only
sre-deploy-app.sh. This is the hardest single deployment.
Create: tests/integration/round3/RETEST-RESULTS.md

## PHASE 4: FINAL REPORT

Create tests/integration/round3/FINAL-REPORT.md:
1. Executive summary
2. Phase 0 results (Round 2 gap closure)
3. All 5 repos: issues, fixes, remaining gaps
4. Platform maturity: Round 1 → Round 2 → Round 3 progression
5. Top 10 remaining gaps prioritized
6. "What % of Docker Hub top 100 can this platform deploy?" assessment
7. Recommendations for Round 4 (if needed) or production readiness declaration

Commit: git commit -m "test(integration): round 3 final report"
