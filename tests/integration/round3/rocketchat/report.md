# Integration Test: Rocket.Chat

**Round:** 3 | **Category:** WebSocket Messaging | **Date:** 2026-03-30

## Application Profile

| Service | Image | Port | Type |
|---------|-------|------|------|
| rocketchat | rocket.chat:7.5.1 | 3000 | Web app (HTTP + WebSocket) |
| mongodb | mongo:7.0.16 | 27017 | Worker (database) |

## Deploy Commands

```bash
# MongoDB backend
sre-deploy-app.sh rocketchat-db team-alpha mongo:7.0.16 \
  --port 27017 \
  --chart sre-worker \
  --persist /data/db:10Gi \
  --run-as-root \
  --writable-root

# Rocket.Chat web app
sre-deploy-app.sh rocketchat team-alpha rocket.chat:7.5.1 \
  --port 3000 \
  --persist /app/uploads:10Gi \
  --env ROOT_URL=https://chat.apps.sre.example.com \
  --env MONGO_URL=mongodb://rocketchat-db:27017/rocketchat \
  --ingress chat.apps.sre.example.com
```

## Results

| Check | Result |
|-------|--------|
| Helm template (web) | PASS (7 resources) |
| Helm template (db) | PASS (6 resources) |
| WebSocket support | PASS (chart websocket.enabled) |
| PVC (uploads) | PASS (10Gi) |
| PVC (mongodb) | PASS (10Gi) |
| Env vars rendered | PASS |
| Ingress VirtualService | PASS |

## Issues Found

1. **WebSocket idle timeout** -- Istio default idle timeout is 1 hour. Persistent chat connections may drop after 60 minutes of silence. Not configurable in the app chart today. Workaround: custom EnvoyFilter to increase `idle_timeout` on the route. Documented as enhancement.
2. **ROOT_URL pattern** -- OAuth/OIDC callbacks require the external URL as an env var. This is a common pattern (Gitea, Casdoor, Nextcloud). Should be documented in onboarding guide.
3. **MongoDB auth** -- Test used unauthenticated MongoDB. Production should use `--env-from-secret` for MONGO_URL with credentials from OpenBao.

## Verdict

PASS -- Both services render cleanly. WebSocket support works via existing chart values. The ROOT_URL env var pattern is straightforward.
