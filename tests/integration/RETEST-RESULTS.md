# Re-Test Results

Re-deployed go-httpbin and petclinic from scratch using MINIMAL App Contracts
(no custom probes, no overrides) to verify platform fixes work.

## go-httpbin (re-test)

| Issue | Before Fix | After Fix | Status |
|-------|-----------|-----------|--------|
| Default probes /healthz fail (app has no /healthz) | Pod CrashLoopBackOff | Probes use `/` — app returns 200 | **Fixed** |
| runAsUser: 1000 overrides image UID 65532 | UID mismatch (works by luck) | No hardcoded UID — image's 65532 respected | **Fixed** |
| Liveness delay 10s | Marginal for this app | 15s — comfortable | **Fixed** |

**Verdict**: go-httpbin now deploys with a 6-line contract (no probes section needed).

## petclinic (re-test)

| Issue | Before Fix | After Fix | Status |
|-------|-----------|-----------|--------|
| Default probes /healthz fail | Would need custom probes | Probes use `/` — works | **Fixed** |
| Liveness delay 10s too short for JVM | Risk of startup kills | 15s — 45s total buffer | **Fixed** |
| runAsUser: 1000 vs jetty user | UID mismatch | jetty user respected | **Fixed** |

**Verdict**: petclinic deploys with a 5-line contract spec (type, image, port, resources, ingress).

## Remaining Issues (NOT re-tested — require manual HelmRelease)

| App | Issue | Status |
|-----|-------|--------|
| uptime-kuma | Runs as root, needs /app/data writable | Workaround: manual HelmRelease |
| wordpress | Runs as root, port 80, needs MySQL | Workaround: manual HelmRelease |
| fastapi | Runs as root | Workaround: manual override |
