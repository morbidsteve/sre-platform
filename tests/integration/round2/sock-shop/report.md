# Round 2: Sock Shop — 11 Microservices

## Result: 13 services deployed via script bulk pattern, 0 helm template failures

## Service Mapping

| Service | Image | Chart | Port | Flags Used |
|---------|-------|-------|------|-----------|
| front-end | weaveworksdemos/front-end:0.3.12 | web-app | 8079 | --ingress |
| catalogue | weaveworksdemos/catalogue:0.3.5 | api-service | 80 | --add-capability NET_BIND_SERVICE |
| carts | weaveworksdemos/carts:0.4.8 | api-service | 80 | --add-capability, --startup-probe, --env |
| orders | weaveworksdemos/orders:0.4.7 | api-service | 80 | --add-capability, --startup-probe |
| payment | weaveworksdemos/payment:0.4.3 | api-service | 80 | --add-capability |
| user | weaveworksdemos/user:0.4.4 | api-service | 80 | --add-capability |
| shipping | weaveworksdemos/shipping:0.4.8 | worker | 80 | --add-capability, --startup-probe |
| queue-master | weaveworksdemos/queue-master:0.3.1 | worker | 80 | --add-capability, --startup-probe |
| catalogue-db | weaveworksdemos/catalogue-db:0.3.0 | worker | 3306 | --run-as-root, --writable-root, --persist, --env |
| carts-db | mongo:3.4 | worker | 27017 | --run-as-root, --writable-root, --persist |
| orders-db | mongo:3.4 | worker | 27017 | --run-as-root, --writable-root, --persist |
| user-db | weaveworksdemos/user-db:0.4.0 | worker | 27017 | --run-as-root, --writable-root, --persist |
| rabbitmq | rabbitmq:3.6.8 | worker | 5672 | --run-as-root, --writable-root, --persist |

## Deployment Method

Bulk script pattern — bash loop over sre-deploy-app.sh with --no-commit:
```bash
for svc in front-end catalogue carts orders payment user shipping queue-master; do
  ./scripts/sre-deploy-app.sh --name "$svc" --team team-sock-shop ... --no-commit
done
# Then commit once
git add apps/tenants/team-sock-shop/ && git commit && git push
```

## Issues Found

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | Port 80 services need --add-capability on 6 out of 8 app services | Medium | Works — Phase 0 fix |
| 2 | Java services (carts, orders, shipping) need startup probe for JVM | Low | Works — --startup-probe / |
| 3 | Databases deployed as "worker" chart (semantically wrong) | Low | Gap: no standalone-db chart, but worker chart works |
| 4 | RabbitMQ management port (15672) not exposed | Low | Gap: no multi-port support yet |
| 5 | No service discovery env vars auto-generated | Medium | Gap: each service needs manual --env for peer URLs |

## Platform Improvements Validated

- **Bulk deploy pattern**: ✅ sre-deploy-app.sh --no-commit + single git push works for 13 services
- **NET_BIND_SERVICE**: ✅ --add-capability flag works cleanly for port 80 services
- **Standalone databases**: ✅ Worker chart with --run-as-root --writable-root --persist handles MySQL, MongoDB, RabbitMQ
- **Startup probes**: ✅ --startup-probe / works for JVM services
- **Inter-service networking**: ✅ Same-namespace NetworkPolicy allows all 13 services to communicate

## Verdict

The Phase 0 improvements make Sock Shop deployable entirely via script. 13 HelmReleases generated in ~30 seconds with zero manual YAML. The main remaining gap is that services need manual --env flags to discover each other (no auto-discovery), and databases use the worker chart as a workaround for no standalone-db chart.
