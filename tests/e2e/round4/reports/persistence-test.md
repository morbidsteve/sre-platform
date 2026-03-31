# Persistence Test Results

Pods deleted and recreated to test data survival via PVC.

| App | Test | Status | Detail |
|-----|------|--------|--------|
| Uptime Kuma | Data survives pod restart | ✅ PASS | No setup wizard on reload = SQLite DB persisted |
| Uptime Kuma | Monitor still exists | ✅ PASS | go-httpbin health monitor survived |
| Gitea | Data survives pod restart | ❌ FAIL | Install page appeared = config lost |
| Gitea | Repo still exists | ❌ FAIL | Config at /etc/gitea not on PVC |

## Root Cause: Gitea Persistence Failure

Gitea stores:
- Database: `/var/lib/gitea/data/gitea.db` → ON PVC (persists)
- Config: `/etc/gitea/app.ini` → NOT on PVC (lost on restart)
- Repos: `/var/lib/gitea/git/repositories/` → ON PVC (persists)

The deploy script only supports one `--persist` flag. Gitea needs TWO persistent mounts.

## Platform Fix Needed

Support multiple `--persist` flags:
```bash
--persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi
```
