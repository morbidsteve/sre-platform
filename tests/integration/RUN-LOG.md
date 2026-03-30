# Integration Test Run Log

## Repo 1: go-httpbin (Go, stateless)
- **Result**: 12 min to working manifest, 7 issues found
- **Platform fixes applied**: 4 (UID, probes, generate-app defaults, extraVolumeMounts)
- **Report**: [go-httpbin-report.md](go-httpbin-report.md)

## Repo 2: uptime-kuma (Node.js, stateful)
- **Result**: Working with manual HelmRelease overrides, 6 issues found
- **Platform fixes applied**: Already benefited from Repo 1 fixes (probes, UID)
- **Key gaps**: Root user, PVC support, security exception in contract
- **Report**: [uptime-kuma-report.md](uptime-kuma-report.md)

## Repo 3: spring-petclinic (Java, JVM)
- **Result**: Works cleanly with App Contract! First "just works" app.
- **Platform fixes applied**: 1 (liveness delay 10→15s in generator)
- **Report**: [petclinic-report.md](petclinic-report.md)

## Repo 4: fastapi full-stack (Python, multi-container)
- **Result**: Backend deploys cleanly with api-service chart type
- **Key gaps**: Multi-container pattern undocumented, root user, compose mapping
- **Report**: [fastapi-report.md](fastapi-report.md)

## Repo 5: wordpress (PHP, legacy, root, port 80)
- **Result**: Required manual HelmRelease — App Contract unusable
- **Key gaps**: No MySQL, no capability add, no legacy app guide
- **Report**: [wordpress-report.md](wordpress-report.md)
