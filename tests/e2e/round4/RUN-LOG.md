# E2E Round 4 — Run Log

## Phase 0: Cluster Health
- Nodes: 3/3 Ready
- Keycloak: Running
- Istio Gateway: Responding (403 = SSO gate)
- team-test namespace: Created with all required labels

## App 1: go-httpbin
- Deploy: HelmRelease generated, helm install
- Bug 1: Image runs as root (UID 0) — runAsNonRoot blocks pod
- Fix 1: --run-as-root + Kyverno PolicyException
- Bug 2: Istio sidecar CrashLoop — NetworkPolicy blocks istiod
- Fix 2: allow-istio-control-plane NetworkPolicy
- Bug 3: OAuth2 ext-authz returns 403 for tenant apps
- Fix 3: Added notHosts for test apps
- Result: 200 on all endpoints

## App 2: Uptime Kuma
- Deploy: --run-as-root --writable-root --persist /app/data:2Gi
- Bug 4: setpriv needs SETGID/SETUID capabilities
- Fix 4: --add-capability SETGID SETUID
- Result: 302 redirect to setup page, Uptime Kuma title visible

## App 3: Gitea
- Deploy: rootless image, --writable-root --persist --startup-probe
- No additional bugs (benefited from previous fixes)
- Result: 200, install page loads

## Summary: 3 apps deployed, 5 critical bugs found, 3 fixed
