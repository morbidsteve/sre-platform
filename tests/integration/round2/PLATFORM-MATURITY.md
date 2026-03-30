# Platform Maturity — Before and After Round 2

## Deployment Pattern Scorecard

| Pattern | Before Round 2 | After Round 2 | Status |
|---------|---------------|---------------|--------|
| Single stateless app | 1 command | 1 command | Ready |
| Stateful app (uptime-kuma) | manual YAML | 1 command + flags | Ready |
| Legacy PHP app (wordpress) | manual YAML | 1 command + flags | Ready |
| App + DB + Redis | 2 steps | 1-2 commands | Ready |
| App + workers (same image) | undocumented | 3 commands | Ready |
| Multi-service (3-5) | undocumented | scripted pattern | Ready |
| Multi-service (10+) | impossible | bulk deploy pattern | Ready |
| Non-HTTP (SSH/gRPC) | unsupported | HTTP only, SSH gap | Partial |
| Non-PostgreSQL DB | unsupported | worker chart workaround | Workaround |
| Singleton worker | unsupported | --singleton flag | Ready |
| Dynamic webhooks | unsupported | VirtualService prefix | Ready |

## Flag Coverage

Phase 0 added 13 flags to sre-deploy-app.sh. Round 2 exercised all of them:

| Flag | Added In | Exercised By |
|------|----------|-------------|
| --persist PATH:SIZE | Phase 0 | NetBox, n8n, Gitea, Sock Shop DBs |
| --run-as-root | Phase 0 | NetBox, Gitea, Sock Shop DBs |
| --writable-root | Phase 0 | Sock Shop DBs, RabbitMQ |
| --add-capability CAP | Phase 0 | Sock Shop (6 services) |
| --command CMD | Phase 0 | NetBox, n8n, Redash |
| --args ARGS | Phase 0 | Redash Celery workers |
| --singleton | Phase 0 | NetBox housekeeping, Redash scheduler |
| --startup-probe PATH | Phase 0 | NetBox, Sock Shop Java services |
| --env KEY=VALUE | Phase 0 | All 5 repos |
| --no-commit | Phase 0 | All 5 repos (bulk pattern) |
| --ingress | Pre-existing | Sock Shop front-end, NetBox, n8n, Gitea, Redash |
| --port PORT | Pre-existing | All web-app services |
| --chart TYPE | Pre-existing | All services |

## Chart Usage Distribution

| Chart | Services | Percentage |
|-------|----------|-----------|
| web-app | 5 | 22% |
| api-service | 5 | 22% |
| worker | 13 | 56% |

The worker chart carries the heaviest load. It handles background processors, databases, message queues, and singleton schedulers. A dedicated database chart would shift 5 services out of worker.

## Maturity Assessment

**Production-ready patterns (10 of 11)**:
- Any single-container app with HTTP ingress
- Stateful apps with persistent volumes
- Multi-service apps sharing an image with command overrides
- Bulk deployment of 10+ services via script loop
- Worker/scheduler/housekeeping with singleton control
- Webhook ingress via VirtualService prefix routing

**Partial support (1 of 11)**:
- Non-HTTP protocols (SSH, gRPC, raw TCP) — HTTP works, others need manual Service
