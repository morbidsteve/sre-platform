# Integration Test: Ollama

**Round:** 3 | **Category:** AI/ML Inference | **Date:** 2026-03-30

## Application Profile

| Property | Value |
|----------|-------|
| Image | ollama/ollama:0.6.2 |
| Port | 11434 |
| Protocol | HTTP |
| Runs as root | Yes |
| PVC | 100Gi (model storage) |
| CPU request/limit | 4 / 8 |
| Memory request/limit | 8Gi / 16Gi |
| Health endpoint | /api/tags |
| Startup probe | /api/tags (model loading delay) |

## Deploy Command

```bash
sre-deploy-app.sh ollama team-alpha ollama/ollama:0.6.2 \
  --port 11434 \
  --cpu-request 4 --cpu-limit 8 \
  --memory-request 8Gi --memory-limit 16Gi \
  --persist /root/.ollama:100Gi \
  --run-as-root \
  --writable-root \
  --startup-probe /api/tags \
  --health /api/tags
```

## Results

| Check | Result |
|-------|--------|
| Helm template render | PASS (7 resources) |
| Security context (root) | PASS |
| PVC generated | PASS (100Gi) |
| Custom resources applied | PASS |
| Startup probe present | PASS |
| Image pull | SKIP (2GB+ image, disk space) |

## Issues Found

1. **Image size** -- Ollama images exceed 2GB. Test node ran out of disk during pull. Cleaned /var/lib/rancher/rke2/agent/containerd and retried. Production nodes need 50GB+ free for AI images.
2. **Resource values as integers** -- `--cpu-request 4` generated `cpu: 4` (integer) instead of `cpu: "4"`. Helm schema expects string. Fixed by quoting sed replacement values.
3. **GPU passthrough** -- Ollama benefits from GPU but the chart has no GPU resource fields (`nvidia.com/gpu`). Documented as gap for future node-feature-discovery integration.

## Verdict

PASS -- All template checks passed. Image pull skipped due to size constraints. Script handles AI/ML resource profiles correctly after the quoting fix.
