# Round 2: Redash — 4 Services from 1 Image

## Result: 4 services deployed via script, 0 helm template failures

## Service Mapping

| Service | Image | Chart | Port | Flags Used |
|---------|-------|-------|------|-----------|
| redash-server | redash/redash:10.1.0 | web-app | 5000 | --ingress, --startup-probe /ping, --env (x8) |
| redash-scheduler | redash/redash:10.1.0 | worker | — | --command "celery" --args "beat -A redash.worker --pidfile /tmp/celery-beat.pid", --singleton, --env (x8) |
| redash-worker-queries | redash/redash:10.1.0 | worker | — | --command "celery" --args "worker -A redash.worker -Q queries,celery --concurrency 2", --env (x8) |
| redash-worker-scheduled | redash/redash:10.1.0 | worker | — | --command "celery" --args "worker -A redash.worker -Q scheduled_queries --concurrency 2", --env (x8) |

## Deployment Method

```bash
COMMON_ENV="--env REDASH_DATABASE_URL=postgresql://... --env REDASH_REDIS_URL=redis://... \
  --env REDASH_SECRET_KEY=changeme --env REDASH_COOKIE_SECRET=changeme \
  --env PYTHONUNBUFFERED=0 --env REDASH_LOG_LEVEL=INFO \
  --env REDASH_MAIL_SERVER=smtp --env REDASH_HOST=https://redash.apps.sre.example.com"

./scripts/sre-deploy-app.sh --name redash-server --image redash/redash:10.1.0 \
  --chart web-app --port 5000 --team team-redash --ingress \
  --startup-probe /ping $COMMON_ENV --no-commit

./scripts/sre-deploy-app.sh --name redash-scheduler --image redash/redash:10.1.0 \
  --chart worker --team team-redash --singleton \
  --command "celery" --args "beat -A redash.worker --pidfile /tmp/celery-beat.pid" \
  $COMMON_ENV --no-commit

./scripts/sre-deploy-app.sh --name redash-worker-queries --image redash/redash:10.1.0 \
  --chart worker --team team-redash \
  --command "celery" --args "worker -A redash.worker -Q queries,celery --concurrency 2" \
  $COMMON_ENV --no-commit

./scripts/sre-deploy-app.sh --name redash-worker-scheduled --image redash/redash:10.1.0 \
  --chart worker --team team-redash \
  --command "celery" --args "worker -A redash.worker -Q scheduled_queries --concurrency 2" \
  $COMMON_ENV --no-commit

git add apps/tenants/team-redash/ && git commit && git push
```

## Issues Found

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | 8 shared env vars repeated across 4 services (32 total --env flags) | Medium | Gap: no --env-from-secret flag |
| 2 | No per-service resource differentiation in bulk pattern | Low | Works: each sre-deploy-app.sh call can set --resources |
| 3 | Celery beat pidfile needs writable /tmp | Low | Works: /tmp is writable by default in containers |
| 4 | No health check for worker processes | Low | Gap: workers have no readiness endpoint |

## Platform Improvements Validated

- **4-service same-image pattern**: --command + --args differentiates all 4 Celery roles
- **Singleton scheduler**: --singleton ensures exactly 1 beat scheduler instance
- **Queue differentiation**: --args passes queue names to Celery workers correctly
- **Bulk env via shell variable**: COMMON_ENV bash variable reduces repetition at script level

## Verdict

Redash is the most complex single-image deployment tested: 4 services differentiated only by command and arguments. The deploy script handles it, but the 32 repeated --env flags make the strongest case yet for --env-from-secret. The bash COMMON_ENV workaround is functional but fragile. Each service rendered cleanly with correct command overrides.
