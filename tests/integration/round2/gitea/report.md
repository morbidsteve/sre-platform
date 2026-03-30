# Round 2: Gitea — 1 Service, Dual Protocol

## Result: 1 service deployed (HTTP only) via script, 0 helm template failures

## Service Mapping

| Service | Image | Chart | Port | Flags Used |
|---------|-------|-------|------|-----------|
| gitea | gitea/gitea:1.22 | web-app | 3000 | --ingress, --run-as-root, --persist /data:20Gi, --env |

## Deployment Method

```bash
./scripts/sre-deploy-app.sh --name gitea --image gitea/gitea:1.22 \
  --chart web-app --port 3000 --team team-gitea --ingress \
  --run-as-root --persist /data:20Gi \
  --env GITEA__database__DB_TYPE=postgres \
  --env GITEA__database__HOST=postgres:5432 \
  --env GITEA__server__ROOT_URL=https://gitea.apps.sre.example.com

git add apps/tenants/team-gitea/ && git commit && git push
```

## Issues Found

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | SSH protocol (port 22) requires separate LoadBalancer Service | High | Gap: no multi-port Service support in charts |
| 2 | Root required for git operations and data directory ownership | Medium | Works — --run-as-root |
| 3 | ConfigMap mount for app.ini not automated by deploy script | Medium | Gap: no --config-file flag |
| 4 | Git over SSH unusable without dedicated Service/port | High | Gap: Istio gateway handles HTTP only |

## Platform Improvements Validated

- **Large persistent volume**: --persist /data:20Gi works for git repository storage
- **Environment-based config**: Gitea's GITEA__section__KEY env pattern works via --env flags
- **Root override**: --run-as-root enables git daemon operations
- **HTTP ingress**: Web UI and git-over-HTTP clone/push work via standard VirtualService

## What SSH Would Require

Git over SSH needs a non-HTTP protocol path. Current options:
1. Manual LoadBalancer Service on port 22 (outside chart contract)
2. Future: --extra-port 22:ssh flag adding a second Service port
3. Future: NodePort allocation for SSH traffic

This is the first real gap in non-HTTP protocol support.

## Verdict

Gitea's HTTP interface deploys in 1 command. The web UI, API, and git-over-HTTP all work. However, git-over-SSH — a primary workflow for most developers — requires a LoadBalancer Service that the charts do not generate. This is a genuine platform gap, not a workaround-able issue. HTTP-only Gitea is functional but incomplete.
