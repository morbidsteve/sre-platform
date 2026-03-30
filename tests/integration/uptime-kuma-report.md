# Integration Test Report: uptime-kuma

## App Summary

| Field | Value |
|-------|-------|
| Name | [uptime-kuma](https://github.com/louislam/uptime-kuma) |
| Language | Node.js |
| Base Image | node (runs as root) |
| Complexity | Stateful — SQLite in /app/data, websockets, runs as root |
| Port | 3001 |
| Health Endpoint | `GET /` (200) |
| Image UID | 0 (root) |
| Volumes | /app/data (SQLite database) |
| Special | WebSocket (socket.io), single replica only |

## Issues Found

| # | Issue | Severity | Who Hits This | Fixed? |
|---|-------|----------|---------------|--------|
| 1 | App runs as root — `runAsNonRoot: true` rejects pod | High | All root images (uptime-kuma, wordpress, many legacy apps) | Workaround: podSecurityContext override in HelmRelease values |
| 2 | readOnlyRootFilesystem blocks /app/data writes | High | All stateful apps | Fixed: extraVolumeMounts added to chart in previous fix cycle |
| 3 | WebSocket support needs explicit VirtualService config | Medium | Apps using socket.io/ws | Chart already supports `websocket.enabled` — just needs to be set |
| 4 | App Contract can't express security exceptions | Medium | Root images, legacy apps | Gap: contract schema needs `securityContext` section |
| 5 | SQLite requires replicas: 1 (file locking) | Low | SQLite-backed apps | Manual override to HelmRelease; contract should support replicas override |
| 6 | Data is lost on pod restart (emptyDir) | Medium | All stateful apps | Needs PVC support; emptyDir is a temporary workaround |

## Platform Fixes Applied This Cycle

| Fix | File | Description |
|-----|------|-------------|
| Remove hardcoded UID | sre-lib/_helpers.tpl | `runAsUser: 1000` removed from podSecurityContext default |
| Default probes | web-app/values.yaml, api-service/values.yaml | Changed `/healthz` → `/` |
| generate-app.sh | scripts/generate-app.sh | Default probes `/` → `/` |
| extraVolumeMounts | web-app/templates/deployment.yaml | Added `extraVolumeMounts` support |
| extraVolumeMounts default | web-app/values.yaml | Added `extraVolumeMounts: []` |

## Remaining Gaps (needs human review)

1. **PVC support in App Contract** — stateful apps need persistent volumes, not emptyDir
2. **Security exception in App Contract** — need a way to express `runAsRoot: true` or custom security context
3. **Replicas field** — contract defaults to 2 but some apps require exactly 1

## Final Working HelmRelease

See: `apps/tenants/team-test/apps/uptime-kuma.yaml`

Required overrides beyond what the App Contract generates:
- `podSecurityContext.runAsNonRoot: false` + `runAsUser: 0`
- `containerSecurityContext.readOnlyRootFilesystem: false`
- `extraVolumeMounts` for /app/data
- `websocket.enabled: true`
- `replicas: 1`
