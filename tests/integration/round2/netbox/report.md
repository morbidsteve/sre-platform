# Round 2: NetBox — 3 Services from 1 Image

## Result: 3 services deployed via script, 0 helm template failures

## Service Mapping

| Service | Image | Chart | Port | Flags Used |
|---------|-------|-------|------|-----------|
| netbox-web | netboxcommunity/netbox:v4.1 | web-app | 8080 | --ingress, --run-as-root, --persist /opt/netbox/netbox/media:10Gi, --startup-probe /api/, --env |
| netbox-worker | netboxcommunity/netbox:v4.1 | worker | — | --command "python manage.py rqworker", --persist /opt/netbox/netbox/media:10Gi, --env |
| netbox-housekeeping | netboxcommunity/netbox:v4.1 | worker | — | --command "python manage.py housekeeping", --singleton, --env |

## Deployment Method

Three separate sre-deploy-app.sh invocations with --no-commit, then single git push:
```bash
./scripts/sre-deploy-app.sh --name netbox-web --image netboxcommunity/netbox:v4.1 \
  --chart web-app --port 8080 --team team-netbox --ingress \
  --run-as-root --persist /opt/netbox/netbox/media:10Gi \
  --startup-probe /api/ --env SECRET_KEY=changeme --env DB_HOST=... --no-commit

./scripts/sre-deploy-app.sh --name netbox-worker --image netboxcommunity/netbox:v4.1 \
  --chart worker --team team-netbox \
  --command "python manage.py rqworker" \
  --persist /opt/netbox/netbox/media:10Gi --env SECRET_KEY=changeme --no-commit

./scripts/sre-deploy-app.sh --name netbox-housekeeping --image netboxcommunity/netbox:v4.1 \
  --chart worker --team team-netbox \
  --command "python manage.py housekeeping" --singleton --env SECRET_KEY=changeme --no-commit

git add apps/tenants/team-netbox/ && git commit && git push
```

## Issues Found

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | Root user required (Django collectstatic, media writes) | Medium | Works — --run-as-root |
| 2 | Shared secrets (SECRET_KEY, DB creds) repeated across 3 --env flags | Low | Gap: no --env-from-secret flag |
| 3 | Init container for collectstatic not automated | Low | Gap: no --init-container support in charts |
| 4 | Shared PVC between web and worker not supported | Medium | Workaround: separate PVCs, same mount path |

## Platform Improvements Validated

- **Multi-service same-image pattern**: 3 commands with --command override differentiates services cleanly
- **Singleton housekeeping**: --singleton flag ensures only 1 replica for periodic tasks
- **Startup probe on web**: --startup-probe /api/ handles Django's slow cold start
- **Persistence**: --persist flag works for media volume on web and worker

## Verdict

NetBox deploys cleanly via 3 script invocations. The main pain point is repeating environment variables (especially secrets) across all 3 services. An --env-from-secret flag would reduce the 3-service deploy from ~15 --env flags to 3 --env-from-secret refs plus service-specific overrides.
