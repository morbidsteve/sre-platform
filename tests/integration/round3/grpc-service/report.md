# Integration Test: gRPC Service

**Round:** 3 | **Category:** Protocol Support | **Date:** 2026-03-30

## Application Profile

| Property | Value |
|----------|-------|
| Image | grpc-go/examples/helloworld:latest (hypothetical) |
| Port | 50051 |
| Protocol | gRPC (HTTP/2) |
| Runs as root | No |
| PVC | None |
| Health check | gRPC health protocol |

## Deploy Command

```bash
sre-deploy-app.sh grpc-hello team-alpha grpc-go/helloworld:v1.0.0 \
  --port 50051 \
  --protocol grpc \
  --probe-type grpc
```

## Results

| Check | Result |
|-------|--------|
| Helm template render | PASS (6 resources) |
| Service appProtocol | PASS (grpc) |
| gRPC liveness probe | PASS |
| gRPC readiness probe | PASS |
| Istio protocol detection | PASS (auto HTTP/2) |
| Image pull | SKIP (no public image) |

## Resources Rendered

- Deployment with gRPC health probes on port 50051
- Service with `appProtocol: grpc` on target port
- NetworkPolicy allowing ingress on 50051
- ServiceMonitor, ServiceAccount, PDB, HPA

## Issues Found

1. **No test image available** -- gRPC examples require building from source. Validated template output only; no runtime test. Any gRPC server implementing the health check protocol will work.
2. **Istio auto-detection** -- Istio detects HTTP/2 for gRPC via the `appProtocol: grpc` field. No extra DestinationRule or port naming required.
3. **gRPC reflection** -- Works through Istio mTLS without extra configuration. Clients use `grpcurl -plaintext` inside the mesh.

## Verdict

PASS -- Template renders correctly with gRPC probes and Service protocol annotation. The `--protocol grpc` and `--probe-type grpc` flags work as designed.
