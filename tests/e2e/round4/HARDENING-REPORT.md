# Round 4 Platform Hardening Report

## Fixes Applied

| # | Bug | Fix | Verified |
|---|-----|-----|----------|
| 1 | NetworkPolicy breaks Istio sidecar | Added ports 15017+443 to allow-istio-control-plane in tenant _base | Pods running 2/2 in team-test |
| 2 | ext-authz 403 on tenant apps | Flipped model: SSO gates only platform UIs (dashboard, grafana, etc.) | go-httpbin: 200, dashboard: 403 |
| 3 | Kyverno blocks root pods | Deploy script auto-generates PolicyException with --run-as-root | uptime-kuma-test2 started with auto PolicyException |
| 4 | Single --persist flag | Support multiple --persist flags with standalone PVC generation | Gitea pattern: /var/lib/gitea + /etc/gitea |
| 5 | DSOP wizard PolicyExceptions | Already implemented in dashboard backend (generatePolicyException) | Code review verified |

## Test Results

### Test A: Tenant app without SSO
```
go-httpbin: 200 (no SSO)
uptime-kuma: 302 (redirect to setup, no SSO)
```

### Test B: Platform UI with SSO
```
dashboard: 403 (SSO login page)
grafana: 403 (SSO login page)
```

### Test C: Auto PolicyException
```
Deploy with --run-as-root generates PolicyException
Pod starts without manual Kyverno exception
```

### Test D: Multiple PVCs
```
--persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi
Generates: HelmRelease + standalone PVC for /etc/gitea
```

## Architecture Change Summary

**Before**: Platform SSO intercepted ALL ingress traffic. Tenant apps got 403.
**After**: SSO only gates platform UIs. Tenant apps bypass SSO by default.

**Before**: Developers had to manually create PolicyExceptions for root containers.
**After**: `--run-as-root` flag generates PolicyException automatically.

**Before**: Single PVC mount. Config directories lost on restart.
**After**: Multiple `--persist` flags create independent PVCs.
