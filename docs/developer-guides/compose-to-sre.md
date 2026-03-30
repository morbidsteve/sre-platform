# Mapping Docker Compose to SRE Platform

## Overview

Each `service` in your `docker-compose.yml` maps to an individual deployment on the
platform. The platform provides built-in PostgreSQL and Redis, so you only deploy your
application containers -- not the databases they depend on.

## Service Type Mapping

| Compose Service Type | SRE Chart | Notes |
|---|---|---|
| Web frontend (nginx, React, Vue) | `web-app` | Gets an external URL automatically |
| API backend (Express, Flask, Spring) | `api-service` | Internal or external, your choice |
| Background worker (Celery, Sidekiq) | `worker` | No inbound traffic, outbound only |
| Scheduled job (cron tasks) | `cronjob` | Runs on a schedule you define |
| PostgreSQL | Platform database | Set `database.enabled: true` -- no separate deploy needed |
| Redis | Platform Redis | Set `redis.enabled: true` -- no separate deploy needed |
| MySQL / MongoDB / other DB | Standalone deployment | See [Bring Your Own Database](bring-your-own-database.md) |
| Message queue (RabbitMQ, Kafka) | Standalone deployment | Deploy as a worker chart with persistence |

## Example: A Typical 4-Service Application

Suppose your `docker-compose.yml` looks like this:

```yaml
services:
  frontend:
    image: myapp/frontend:v2.1
    ports: ["3000:3000"]
    environment:
      API_URL: http://api:8080

  api:
    image: myapp/api:v2.1
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/myapp
      REDIS_URL: redis://cache:6379

  worker:
    image: myapp/worker:v2.1
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/myapp
      REDIS_URL: redis://cache:6379

  db:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]

  cache:
    image: redis:7
```

This maps to **three** SRE deployments plus two platform-managed services:

```bash
# 1. Deploy the API with platform database and Redis enabled
./scripts/sre-deploy-app.sh --name myapp-api --team team-alpha \
  --chart api-service --image myapp/api --tag v2.1 \
  --port 8080 --database --redis \
  --env "DATABASE_URL=secret:myapp-api-db-url" \
  --env "REDIS_URL=secret:myapp-api-redis-url"

# 2. Deploy the worker sharing the same database and Redis
./scripts/sre-deploy-app.sh --name myapp-worker --team team-alpha \
  --chart worker --image myapp/worker --tag v2.1 \
  --env "DATABASE_URL=secret:myapp-api-db-url" \
  --env "REDIS_URL=secret:myapp-api-redis-url"

# 3. Deploy the frontend
./scripts/sre-deploy-app.sh --name myapp-frontend --team team-alpha \
  --chart web-app --image myapp/frontend --tag v2.1 \
  --port 3000 \
  --env "API_URL=http://myapp-api.team-alpha.svc:8080"
```

Notice that `db` and `cache` from the Compose file are gone. The platform provisions
PostgreSQL and Redis when the API deployment requests them with `--database` and `--redis`.

## Shared Configuration

When multiple services need the same database or Redis, reference the same secret names
across deployments. Both `myapp-api` and `myapp-worker` above use `secret:myapp-api-db-url`
and `secret:myapp-api-redis-url`.

The platform creates these secrets when the first deployment enables `--database` or
`--redis`. Subsequent deployments in the same team namespace simply reference them.

- Secrets are scoped to a team namespace. Any deployment in `team-alpha` can reference
  secrets created by another `team-alpha` deployment.
- If you need separate databases, use different `--name` values with `--database`.
- Environment variables referencing `secret:<name>` are injected at container startup.

## Networking

All services deployed within the same team namespace can reach each other by service
name. No special networking configuration is required.

| Compose syntax | SRE equivalent |
|---|---|
| `http://api:8080` | `http://myapp-api.team-alpha.svc:8080` |
| `postgres://db:5432/myapp` | Provided via secret (platform-managed connection string) |
| `redis://cache:6379` | Provided via secret (platform-managed connection string) |

The pattern is `<deployment-name>.<team-namespace>.svc:<port>`. Within the same
namespace, you can shorten this to `<deployment-name>:<port>`.

External URLs (for services exposed to users) are assigned automatically based on the
deployment name: `https://<name>.apps.sre.example.com`.

## Startup Ordering

Docker Compose offers `depends_on` to control startup order. The SRE Platform does not
enforce startup ordering between deployments. All services start independently.

Your application must handle dependencies being temporarily unavailable:

- **Database connections**: Use a retry loop on startup. Most ORMs support automatic
  reconnection (e.g., `retries: 5` in Sequelize, `pool_pre_ping` in SQLAlchemy).
- **API dependencies**: Return 503 from your health endpoint until upstream services
  are reachable. The platform holds traffic until health checks pass.
- **Redis**: Most clients reconnect automatically. Ensure reconnection is enabled.

Hard startup dependencies create fragile systems that fail during rolling updates.

## Common Pitfalls

### Hardcoded `localhost` References

Each service runs in its own container. Replace `localhost` references with the
service DNS name or use platform-provided secrets for database connection strings.

### Docker-Only Networking Features

Docker networks, `links`, `network_mode: host`, and `extra_hosts` do not apply. All
services in the same namespace communicate by name. Cross-namespace communication
requires explicit configuration from a platform operator.

### Volume Sharing Between Containers

The platform does not support shared volumes between separate deployments. If two
services need the same files, use an object store (S3-compatible) or serve the files
via HTTP from one service to the other.

### Port Conflicts

Each deployment gets its own network identity. Two services can both listen on port
8080 without conflict. Use whatever port your application defaults to.
