# Round 2: n8n — 2 Services (Main + Worker)

## Result: 2 services deployed via script, 0 helm template failures

## Service Mapping

| Service | Image | Chart | Port | Flags Used |
|---------|-------|-------|------|-----------|
| n8n | n8nio/n8n:1.70.2 | web-app | 5678 | --ingress, --persist /home/node/.n8n:10Gi, --env |
| n8n-worker | n8nio/n8n:1.70.2 | worker | — | --command "n8n worker", --persist /home/node/.n8n:5Gi, --env |

## Deployment Method

```bash
./scripts/sre-deploy-app.sh --name n8n --image n8nio/n8n:1.70.2 \
  --chart web-app --port 5678 --team team-n8n --ingress \
  --persist /home/node/.n8n:10Gi \
  --env EXECUTIONS_MODE=queue --env QUEUE_BULL_REDIS_HOST=redis --no-commit

./scripts/sre-deploy-app.sh --name n8n-worker --image n8nio/n8n:1.70.2 \
  --chart worker --team team-n8n \
  --command "n8n worker" --persist /home/node/.n8n:5Gi \
  --env EXECUTIONS_MODE=queue --env QUEUE_BULL_REDIS_HOST=redis --no-commit

git add apps/tenants/team-n8n/ && git commit && git push
```

## Issues Found

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | No multi-Redis instance support (queue vs cache) | Low | Workaround: single Redis serves both roles |
| 2 | Webhook timeout not configurable via deploy flags | Low | Gap: hardcoded in Istio VirtualService timeout |
| 3 | Webhook path /webhook/* needs VirtualService prefix match | Low | Works — ingress handles prefix routing |

## Platform Improvements Validated

- **Non-root by default**: n8n runs as node (UID 1000) — no --run-as-root needed
- **Worker pattern**: --command "n8n worker" cleanly separates execution worker from main
- **Webhook ingress**: VirtualService prefix routing at /webhook/* works without additional config
- **Persistence**: --persist /home/node/.n8n handles workflow storage for both main and worker

## Verdict

n8n is the cleanest deploy of Round 2. Two commands, no root override, no capability additions. The non-root image with a single port and simple worker pattern maps directly to the chart contract. Webhook routing works via standard VirtualService prefix matching.
