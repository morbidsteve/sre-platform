# E2E Test Report: gitea

**URL:** https://gitea.apps.sre.example.com
**Pod:** Running (rootless image, no --run-as-root needed)

## Test Results

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1 | Pod reaches Running | ✅ PASS | kubectl wait succeeded |
| 2 | Ingress returns 200 | ✅ PASS | curl returns 200 |
| 3 | Install page loads | ✅ PASS | Title: "Installation - Gitea" |
| 4 | PVC created (10Gi) | ✅ PASS | PVC bound |
| 5 | startupProbe working | ✅ PASS | Pod started without liveness kills |

## Notes

- Used rootless image (gitea:1.22-rootless) — avoids --run-as-root
- --writable-root needed for Gitea's config/data writes
- API returns 404 until initial setup is complete (expected)
