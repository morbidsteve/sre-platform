# E2E Test Report: uptime-kuma

**URL:** https://uptime-kuma.apps.sre.example.com
**Pod:** Running (1/2 → 2/2 after Istio sidecar fix)

## Test Results

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1 | Pod reaches Running | ✅ PASS | kubectl wait succeeded |
| 2 | Ingress returns 302 (redirect to setup) | ✅ PASS | curl -sk returns 302 |
| 3 | Setup page loads (title: "Uptime Kuma") | ✅ PASS | HTML title verified |
| 4 | PVC created and mounted | ✅ PASS | PVC bound, /app/data writable |

## Platform Bugs Found

| # | Bug | Severity | Fixed? |
|---|-----|----------|--------|
| 1 | setpriv needs SETGID/SETUID capabilities | High | Fixed: --add-capability SETGID SETUID |
| 2 | Helm --wait fails if PVC doesn't pre-exist | Medium | Workaround: kubectl apply instead of helm install |
