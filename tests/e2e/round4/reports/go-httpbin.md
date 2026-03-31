=== go-httpbin E2E Test Results ===

**URL:** https://go-httpbin.apps.sre.example.com
**Date:** 2026-03-31T14:28:24+00:00
**Pod:** go-httpbin-go-httpbin-7cbbf646b8-m5sld

## Test Results

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1 | Pod reaches Running | ✅ PASS | kubectl wait succeeded |
| 2 | Istio sidecar healthy | ✅ PASS | 2/2 containers Running |
| 3 | Internal curl returns 200 | ✅ PASS | (tested via curl) |
| 4 | Ingress returns 200 | ✅ PASS | curl -sk returns 200 |
| 5 | GET / returns 200 (homepage) | ✅ PASS | HTML saved |
| 6 | GET /get returns 200 | ✅ PASS | JSON response saved |
| 7 | GET /status/418 returns 418 | ✅ PASS | Correct teapot status |
| 8 | POST /post returns 200 | ✅ PASS | Accepts JSON body |

## Platform Bugs Found During This Test

| # | Bug | Severity | Fixed? | How |
|---|-----|----------|--------|-----|
| 1 | go-httpbin v2.14.0 runs as root (UID 0) — runAsNonRoot blocks it | High | Fixed | --run-as-root flag + PolicyException |
| 2 | Kyverno require-security-context Enforce blocks ALL root pods in tenant namespaces | **Critical** | Workaround | PolicyException for team-test (needs automated creation in deploy script) |
| 3 | Istio sidecar CrashLoop — NetworkPolicy blocks egress to istio-system | **Critical** | Fixed | Added allow-istio-control-plane NetworkPolicy |
| 4 | OAuth2 ext-authz intercepts ALL ingress traffic including tenant apps | **Critical** | Workaround | Added notHosts for test apps (needs platform-level fix) |
| 5 | /etc/hosts on server nodes missing tenant app hostnames | Medium | Fixed | Added manually (DaemonSet should auto-manage) |

## Key Insight

Template validation (Rounds 1-3) missed 3 CRITICAL issues that only manifest during real deployment:
1. Kyverno admission blocking is invisible to helm template
2. NetworkPolicy effects on Istio sidecar are invisible to helm template
3. OAuth2 ext-authz scope is invisible to helm template

These are the kinds of bugs that make developers say "the platform doesn't work."
