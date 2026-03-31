# E2E Integration Test Round 4 — Final Report

## Executive Summary

Deployed 3 real apps to the live SRE cluster and accessed them through the Istio ingress gateway. All 3 apps reached Running state and responded correctly through their ingress URLs. Found **5 critical platform bugs** that were invisible to template validation (Rounds 1-3), including Kyverno admission blocking, NetworkPolicy breaking Istio sidecars, and OAuth2 ext-authz intercepting tenant apps. Three were fixed during testing.

## Test Results

### go-httpbin (Stateless Baseline)

| Test | Status |
|------|--------|
| Pod reaches Running | ✅ PASS |
| Istio sidecar healthy | ✅ PASS (after NetworkPolicy fix) |
| Ingress returns 200 | ✅ PASS (after ext-authz fix) |
| GET /get returns 200 | ✅ PASS |
| GET /status/418 returns 418 | ✅ PASS |
| POST /post returns 200 | ✅ PASS |

### Uptime Kuma (Stateful + Root + WebSocket)

| Test | Status |
|------|--------|
| Pod reaches Running | ✅ PASS (after capability fix) |
| PVC created and bound | ✅ PASS |
| Ingress returns 302 (setup redirect) | ✅ PASS |
| Setup page loads | ✅ PASS |

### Gitea (Persistence + Startup Probe)

| Test | Status |
|------|--------|
| Pod reaches Running (rootless) | ✅ PASS |
| PVC created (10Gi) | ✅ PASS |
| Ingress returns 200 | ✅ PASS |
| Install page loads | ✅ PASS |

## Platform Bugs Found (Critical Discovery)

These bugs were **invisible** to Rounds 1-3 (template validation):

| # | Bug | Severity | Impact | Fixed? |
|---|-----|----------|--------|--------|
| 1 | Kyverno `require-security-context` Enforce blocks ALL root pods — even with explicit `runAsNonRoot: false` | **Critical** | No root containers can deploy to tenant namespaces | Workaround: PolicyException per namespace |
| 2 | NetworkPolicy default-deny blocks Istio sidecar → istiod communication | **Critical** | Istio sidecar CrashLoops in every tenant pod | Fixed: allow-istio-control-plane NetworkPolicy |
| 3 | OAuth2 ext-authz intercepts ALL ingress traffic including tenant apps | **Critical** | Tenant apps return 403 instead of their content | Fixed: added notHosts for tenant apps |
| 4 | go-httpbin v2.14.0 runs as root (changed from earlier version) | High | Apps that used to be nonroot can silently become root | Documented: always test with real images |
| 5 | Uptime Kuma needs SETGID/SETUID capabilities for setpriv | High | Capability drop ALL is too aggressive for many apps | Fixed: --add-capability SETGID SETUID |

## Key Insight

**Template validation is necessary but NOT sufficient.** Rounds 1-3 proved the YAML is syntactically correct. Round 4 proved 3 of the 5 bugs above — all of which would have blocked EVERY developer deployment:

1. **Kyverno admission** — evaluated at pod creation, not at template render time
2. **NetworkPolicy** — evaluated at runtime network flows, not at template render time
3. **ext-authz scope** — evaluated at Istio gateway level, not at chart level

A developer would have seen: "I followed all the steps, the YAML looks right, but my app returns 403" or "my pod keeps crashing." These are the bugs that make developers lose confidence in the platform.

## Recommendations

1. **Fix ext-authz properly** — change from "block everything, exclude known hosts" to "only SSO-gate platform services." Tenant apps should be excluded by default.
2. **Automate PolicyExceptions** — the `--run-as-root` deploy script flag should also create the required Kyverno PolicyException, not just set the security context.
3. **Include allow-istio-control-plane in _base tenant NetworkPolicies** — it's missing from the tenant base template, causing every new namespace to break Istio sidecars.
4. **Add E2E testing to CI** — every platform change should deploy a test app and verify it's reachable through ingress.
5. **Document the tenant app auth model** — clearly state that tenant apps are NOT behind platform SSO by default, and document how to opt-in.

## All 3 Apps Currently Running

```
$ kubectl get pods -n team-test
NAME                                    READY   STATUS    RESTARTS
go-httpbin-go-httpbin-xxx               2/2     Running   0
uptime-kuma-uptime-kuma-xxx             2/2     Running   0
gitea-gitea-xxx                         2/2     Running   0
```

All accessible at their ingress URLs.
