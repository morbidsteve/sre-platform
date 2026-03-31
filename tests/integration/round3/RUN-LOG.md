# Integration Test Round 3 -- Run Log

**Date:** 2026-03-30

## Phase 0: Round 2 Gap Closure

- Status: Complete
- 11 new deploy script flags added
- gRPC probe support added to sre-web-app and sre-worker charts
- envFrom, extraPorts, appProtocol added to chart templates
- ConfigMap mount via --config-file generates volume + volumeMount
- Custom resource overrides via --cpu-request, --cpu-limit, --memory-request, --memory-limit
- Fix: resource values quoted as strings for Helm schema compliance

## Repo 1: Ollama (AI/ML Inference)

- Status: Complete -- 1 service, 0 failures
- Custom resources: 4/8 CPU, 8/16Gi memory, 100Gi PVC
- Startup probe for model loading delay
- Runs as root with writable filesystem
- Issue: resource integer quoting fixed in deploy script
- Gap: GPU passthrough not supported (needs node-feature-discovery)

## Repo 2: gRPC Service (Protocol Support)

- Status: Complete -- 1 service, 0 failures
- --protocol grpc sets Service appProtocol
- --probe-type grpc generates gRPC health probes
- Istio auto-detects HTTP/2 from appProtocol annotation
- No runtime test (no public gRPC test image)

## Repo 3: Rocket.Chat (WebSocket Messaging)

- Status: Complete -- 2 services, 0 failures
- Web app on port 3000 with WebSocket support
- MongoDB worker on port 27017 with 10Gi PVC
- ROOT_URL env var for OAuth callback configuration
- Enhancement: WebSocket idle timeout configurable via EnvoyFilter

## Repo 4: Casdoor (OAuth Provider)

- Status: Complete -- 2 services, 0 failures
- First successful --config-file test
- ConfigMap mount at /conf/app.conf with subPath
- Startup probe /api/health covers DB migration delay
- PostgreSQL backend via sre-worker chart

## Repo 5: MinIO (Object Storage)

- Status: Complete -- 1 service, 0 failures
- Dual-port via --extra-port console:9001:9001:TCP
- Custom resources: 2/4 CPU, 4/8Gi memory, 50Gi PVC
- --env-from-secret for MINIO_ROOT_USER/PASSWORD
- --command and --args override for server mode
- Gap: distributed mode needs StatefulSet chart
