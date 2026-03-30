# Integration Test Summary — All 5 Repos

## Consolidated Issue Table

| # | Issue | Severity | Repos Affected | Status |
|---|-------|----------|---------------|--------|
| 1 | Hardcoded `runAsUser: 1000` in sre-lib | High | go-httpbin, all images | **FIXED** — removed, uses `runAsNonRoot: true` only |
| 2 | Default probes /healthz /readyz fail most apps | Medium | go-httpbin, all apps | **FIXED** — defaults now `/` |
| 3 | Generator liveness delay 10s kills JVM apps | Medium | petclinic, all JVM | **FIXED** — now 15s |
| 4 | No `extraVolumeMounts` in chart | Medium | uptime-kuma, stateful apps | **FIXED** — added to web-app Deployment template |
| 5 | Contract requires `harbor.*` prefix | Low | all (local testing) | Not fixed — by design (security) |
| 6 | Helm test pod hardcodes busybox image | Low | all | Not fixed — low priority |
| 7 | Team onboarding doesn't create Harbor project | Medium | all new teams | Not fixed — needs Harbor API integration in script |
| 8 | App runs as root — contract can't express | High | uptime-kuma, fastapi, wordpress | **Not fixed** — needs contract schema extension |
| 9 | readOnlyRootFilesystem blocks stateful apps | High | uptime-kuma, wordpress | Workaround: containerSecurityContext override in HelmRelease |
| 10 | WebSocket needs explicit VirtualService config | Medium | uptime-kuma | Chart supports it — just needs `websocket.enabled: true` |
| 11 | SQLite requires replicas: 1 | Low | uptime-kuma | Manual override in HelmRelease |
| 12 | No PVC support (data lost on restart) | Medium | uptime-kuma, wordpress | Not fixed — emptyDir workaround |
| 13 | No startupProbe support | Low | petclinic, all JVM | Not fixed — failureThreshold * period provides buffer |
| 14 | Multi-container Compose mapping undocumented | Medium | fastapi | Not fixed — needs documentation |
| 15 | No MySQL service (only CNPG PostgreSQL) | High | wordpress | Not fixed — fundamental gap |
| 16 | Port 80 needs NET_BIND_SERVICE capability | High | wordpress | Workaround: capabilities.add in HelmRelease |
| 17 | App Contract unusable for legacy apps | High | wordpress | Not fixed — needs contract extensions |
| 18 | No "deploying legacy apps" documentation | Medium | wordpress, vendor software | Not fixed — needs guide |

## Statistics

| Metric | Value |
|--------|-------|
| Apps tested | 5 |
| Total issues found | 18 |
| Issues fixed during run | 4 |
| Issues with workarounds | 5 |
| Remaining gaps | 9 |
| Apps that "just work" with contract | 2 (go-httpbin, petclinic) |
| Apps needing manual HelmRelease | 2 (uptime-kuma, wordpress) |
| Apps partially working with contract | 1 (fastapi — root user gap) |

## App Compatibility Matrix

| App | Contract Works? | Chart Type | Security Overrides | Extra Volumes | Notes |
|-----|----------------|------------|-------------------|---------------|-------|
| go-httpbin | Yes | web-app | None needed | None | Ideal case: distroless, nonroot |
| petclinic | Yes | web-app | None (jetty user) | None | JVM needs medium resources |
| fastapi | Mostly | api-service | Root user (manual) | None | Multi-container gap |
| uptime-kuma | No (manual) | web-app | Root + writable FS | /app/data | SQLite, websocket |
| wordpress | No (manual) | web-app | Root + writable + capabilities | /var/www/html | MySQL, port 80, legacy |
