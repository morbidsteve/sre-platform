# Round 2 Integration Testing — Consolidated Issue Summary

## Test Scope

5 repositories, 23 total services deployed via sre-deploy-app.sh with zero manual YAML.

| Repo | Services | Chart Types Used |
|------|----------|-----------------|
| Sock Shop | 13 | web-app (1), api-service (5), worker (7) |
| NetBox | 3 | web-app (1), worker (2) |
| n8n | 2 | web-app (1), worker (1) |
| Gitea | 1 | web-app (1) |
| Redash | 4 | web-app (1), worker (3) |
| **Total** | **23** | web-app (5), api-service (5), worker (13) |

## All Issues by Category

### Multi-Service Patterns

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 1 | Sock Shop | No auto-generated service discovery env vars | Medium | Gap |
| 2 | NetBox | Shared secrets repeated across 3 --env invocations | Low | Gap |
| 3 | Redash | 8 shared env vars repeated across 4 services (32 flags) | Medium | Gap |

### Worker Patterns

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 4 | Redash | No health check for Celery worker processes | Low | Gap |

### Stateful Services

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 5 | Sock Shop | Databases deployed as "worker" chart (semantically wrong) | Low | Gap |
| 6 | NetBox | Shared PVC between web and worker not supported | Medium | Workaround |
| 7 | NetBox | Init container for collectstatic not automated | Low | Gap |

### Security Overrides

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 8 | Sock Shop | 6 of 8 app services need --add-capability for port 80 | Medium | Fixed (Phase 0) |
| 9 | NetBox | Root user required for Django collectstatic | Medium | Fixed (Phase 0) |
| 10 | Gitea | Root required for git operations | Medium | Fixed (Phase 0) |

### Non-HTTP Protocols

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 11 | Gitea | SSH (port 22) requires separate LoadBalancer Service | High | Gap |
| 12 | Sock Shop | RabbitMQ management port (15672) not exposed | Low | Gap |

### Dynamic Networking

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 13 | n8n | Webhook timeout not configurable via deploy flags | Low | Gap |

### Credential Sharing

| # | Repo | Issue | Severity | Status |
|---|------|-------|----------|--------|
| 14 | NetBox | No --env-from-secret flag for shared credentials | Medium | Gap |
| 15 | Redash | No --env-from-secret flag for shared credentials | Medium | Gap |
| 16 | Gitea | No --config-file flag for ConfigMap mounts | Medium | Gap |

## Statistics

- **Total issues found**: 16
- **Fixed by Phase 0**: 3 (security override flags)
- **Workarounds available**: 1 (separate PVCs for shared mount)
- **Remaining gaps**: 12
- **High severity gaps**: 1 (multi-port/SSH support)
- **Medium severity gaps**: 6
- **Low severity gaps**: 5

## Top 3 Gaps by Impact

1. **--env-from-secret** — Affects NetBox, Redash, and any multi-service app sharing credentials. Eliminates 60%+ of --env flag repetition.
2. **Multi-port Service support** — Affects Gitea (SSH), RabbitMQ (management), any app with admin + data ports.
3. **Standalone database chart** — Affects Sock Shop (MySQL, MongoDB, RabbitMQ). Worker chart works but is semantically wrong.
