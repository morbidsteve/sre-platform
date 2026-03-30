# Integration Test Report: spring-petclinic

## App Summary

| Field | Value |
|-------|-------|
| Name | [spring-petclinic](https://github.com/spring-projects/spring-petclinic) |
| Language | Java (Jetty) |
| Base Image | jetty (runs as user "jetty") |
| Complexity | Medium — JVM, needs heap memory, slow startup |
| Port | 8080 |
| Health Endpoint | `GET /` (returns HTML, 200) |
| Image UID | jetty user (non-root) |
| Startup Time | 30-60 seconds |

## Issues Found

| # | Issue | Severity | Who Hits This | Fixed? |
|---|-------|----------|---------------|--------|
| 1 | Generator hardcoded liveness delay at 10s — JVM killed during startup | Medium | All JVM, .NET, Rails apps | Fixed: bumped to 15s in generate-app.sh |
| 2 | Medium resource preset just barely sufficient for JVM | Low | JVM apps | Document that medium is minimum for JVM |
| 3 | No startupProbe support in chart | Low | Very slow starters | Gap: would prevent false liveness kills |
| 4 | Default probes now use / (fixed in previous cycle) | N/A | | Already fixed |
| 5 | UID handling now correct (no hardcoded 1000) | N/A | | Already fixed |

## Platform Fixes Applied This Cycle

| Fix | File | Description |
|-----|------|-------------|
| Liveness delay | scripts/generate-app.sh | 10s → 15s default for liveness initialDelaySeconds |

## Verdict

**Petclinic deploys cleanly with the App Contract.** The medium resource preset provides enough memory for the JVM. The probe defaults (`/`) work. The previous UID fix means the jetty user is respected. This is the first app that "just works" with minimal contract configuration — a sign the platform fixes from repos 1-2 are paying off.
