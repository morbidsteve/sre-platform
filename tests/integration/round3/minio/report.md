# Integration Test: MinIO

**Round:** 3 | **Category:** Object Storage | **Date:** 2026-03-30

## Application Profile

| Property | Value |
|----------|-------|
| Image | minio/minio:RELEASE.2025-03-12T18-04-18Z |
| Ports | 9000 (S3 API), 9001 (Console) |
| Protocol | HTTP |
| PVC | 50Gi |
| CPU request/limit | 2 / 4 |
| Memory request/limit | 4Gi / 8Gi |
| Credentials | MINIO_ROOT_USER, MINIO_ROOT_PASSWORD |

## Deploy Command

```bash
sre-deploy-app.sh minio team-alpha \
  minio/minio:RELEASE.2025-03-12T18-04-18Z \
  --port 9000 \
  --extra-port console:9001:9001:TCP \
  --cpu-request 2 --cpu-limit 4 \
  --memory-request 4Gi --memory-limit 8Gi \
  --persist /data:50Gi \
  --run-as-root \
  --writable-root \
  --env-from-secret minio-credentials \
  --command minio \
  --args "server /data --console-address :9001" \
  --ingress s3.apps.sre.example.com
```

## Results

| Check | Result |
|-------|--------|
| Helm template render | PASS (7 resources) |
| Dual-port Service | PASS (9000 + 9001) |
| PVC generated | PASS (50Gi) |
| Custom resources | PASS |
| envFrom secret ref | PASS |
| Command/args override | PASS |
| Ingress (S3 API) | PASS |

## Issues Found

1. **Distributed mode** -- MinIO in production runs 4+ replicas with `minio server http://minio-{0...3}.minio-headless:9000/data`. This requires a StatefulSet with `volumeClaimTemplates` and a headless Service. The current chart only supports Deployment. Gap documented.
2. **Dual ingress** -- S3 API on `s3.apps.sre.example.com` works. Console UI ideally gets a separate hostname (`minio-console.apps.sre.example.com`) pointing at port 9001. A single VirtualService can only route to one port per host. Workaround: deploy two VirtualServices manually. Partial gap.
3. **Single-node mode** -- Single replica with `--persist` works correctly for dev/test. Suitable for non-production use (Loki backend, Tempo backend, Velero target).

## Verdict

PASS -- Single-node MinIO deploys cleanly via script. Dual-port Service via `--extra-port` works as designed. Distributed mode and dual-hostname ingress are documented gaps.
