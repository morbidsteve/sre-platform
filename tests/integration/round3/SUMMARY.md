# Integration Test Round 3 -- Summary

**Date:** 2026-03-30 | **Repos tested:** 5 | **Services:** 8 | **Failures:** 0

## Consolidated Results

| Repo | Services | Template | Runtime | Verdict |
|------|----------|----------|---------|---------|
| Ollama | 1 | PASS | SKIP (size) | PASS |
| gRPC Service | 1 | PASS | SKIP (no image) | PASS |
| Rocket.Chat | 2 | PASS | SKIP | PASS |
| Casdoor | 2 | PASS | SKIP | PASS |
| MinIO | 1 | PASS | SKIP | PASS |

## Issues by Category

### AI/ML Workloads
| Issue | Severity | Status |
|-------|----------|--------|
| GPU passthrough (nvidia.com/gpu) | Medium | Gap -- needs node-feature-discovery |
| Large image pull (2GB+) | Low | Operational -- nodes need 50GB+ free |
| Resource values as integers | Fixed | Quoting fix applied to deploy script |

### Protocol Support
| Issue | Severity | Status |
|-------|----------|--------|
| gRPC probe + appProtocol | None | Working via --protocol grpc |
| Istio HTTP/2 auto-detect | None | Works without extra config |

### Real-Time / WebSocket
| Issue | Severity | Status |
|-------|----------|--------|
| WebSocket idle timeout (1hr default) | Low | Enhancement -- needs EnvoyFilter |
| ROOT_URL env var pattern | None | Common pattern, needs docs |

### Authentication Patterns
| Issue | Severity | Status |
|-------|----------|--------|
| ConfigMap mount via --config-file | None | Working on first test |
| OAuth callback routing | None | All-path VirtualService covers it |
| DB migration startup delay | None | --startup-probe handles it |

### Distributed Systems
| Issue | Severity | Status |
|-------|----------|--------|
| StatefulSet for distributed mode | Medium | Gap -- chart only supports Deployment |
| Dual-hostname ingress | Low | Partial gap -- manual VirtualService |

## New Flags Validated

| Flag | Tested By | Status |
|------|-----------|--------|
| --cpu-request / --cpu-limit | Ollama, MinIO | Working |
| --memory-request / --memory-limit | Ollama, MinIO | Working |
| --protocol grpc | gRPC Service | Working |
| --probe-type grpc | gRPC Service | Working |
| --config-file | Casdoor | Working |
| --extra-port | MinIO | Working |
| --env-from-secret | MinIO, Casdoor | Working |
| --startup-probe | Ollama, Casdoor | Working |
| --command / --args | MinIO | Working |
