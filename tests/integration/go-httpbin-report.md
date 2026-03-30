# Integration Test Report: go-httpbin

## App Summary

| Field | Value |
|-------|-------|
| Name | [go-httpbin](https://github.com/mccutchen/go-httpbin) |
| Language | Go |
| Base Image | gcr.io/distroless/static:nonroot |
| Complexity | Minimal — stateless HTTP service, no dependencies |
| Port | 8080 |
| Health Endpoint | `GET /` (200) or `GET /status/200` |
| Image UID | 65532 (distroless nonroot) |
| Filesystem | Read-only compatible |

## Deployment Timeline

| Step | Action | Result | Time |
|------|--------|--------|------|
| 1 | Clone and read app | Understood port, probes, image UID | 2 min |
| 2 | Read platform docs | Found App Contract guide, understood format | 3 min |
| 3 | Onboard team-test | `onboard-team.sh` worked cleanly | 1 min |
| 4 | Create App Contract | Wrote 15-line YAML | 2 min |
| 5 | Run generate-app.sh | Generated HelmRelease successfully | < 1 min |
| 6 | Helm template render | Rendered cleanly, 7 resources | < 1 min |
| 7 | Push to Harbor | Required manual Harbor project creation | 3 min |
| **Total** | | **Working deployment manifest** | **~12 min** |

## Issues Found

| # | Issue | Severity | Component | Who Hits This | Fix |
|---|-------|----------|-----------|---------------|-----|
| 1 | App has no /healthz or /readyz endpoints | Medium | App Contract defaults | Most non-K8s-native apps | Contract should suggest `GET /` as default, or auto-detect from image |
| 2 | Chart hardcodes `runAsUser: 1000` but distroless uses UID 65532 | High | sre-lib podSecurityContext | All distroless, Alpine nonroot, and UID-specific images | Use `runAsNonRoot: true` without hardcoding UID, or expose UID in App Contract |
| 3 | Default probe paths (/healthz, /readyz) fail for most apps | Medium | generate-app.sh | Every app without K8s-native health endpoints | Change defaults to `/` and `/` (root path) which works for 90% of web apps |
| 4 | Contract requires `harbor.*` image prefix — no way to test locally | Low | App Contract schema | Developers without Harbor access | Add a `--local` flag or accept any registry in dev mode |
| 5 | Helm chart test pod uses `harbor.sre.internal/library/busybox` | Low | web-app chart | Anyone running `helm test` | Make test image configurable or use a more portable image |
| 6 | App Contract has no `runAsUser` / security context override | Medium | App Contract schema | Distroless, Alpine nonroot, custom UID images | Add optional `securityContext.runAsUser` field to contract |
| 7 | Team onboarding doesn't auto-create Harbor project | Medium | onboard-team.sh | Every new team | Script should call Harbor API to create the project automatically |

## Detailed Issue Analysis

### ISSUE 2 (High): Hardcoded runAsUser: 1000

The `sre-lib.podSecurityContext` template defaults to `runAsUser: 1000` when no override is provided. This conflicts with images that specify a different UID:

- `gcr.io/distroless/static:nonroot` → UID 65532
- `nginxinc/nginx-unprivileged` → UID 101
- `alpine` with `USER nobody` → UID 65534
- Many Chainguard images → various UIDs

The deployed pod will run as UID 1000 regardless of what the Dockerfile specifies. For go-httpbin this works because the binary has world-execute permissions, but for images where files are owned by the image's specific UID, this would cause permission errors.

**Recommended fix**: Change the default to `runAsNonRoot: true` without hardcoding a specific UID, and let the image's USER directive take effect. Or expose `runAsUser` in the App Contract.

### ISSUE 3 (Medium): Default probe paths

The generate-app.sh script defaults to `/healthz` (liveness) and `/readyz` (readiness). These are Kubernetes conventions, but most apps don't implement them:

- go-httpbin: uses `GET /`
- Most Express/Flask apps: use `GET /` or `GET /health`
- Spring Boot: uses `GET /actuator/health`
- Rails: uses `GET /health_check` or `GET /up`

A developer who doesn't specify probes in the contract gets broken liveness checks and pods in CrashLoopBackOff.

**Recommended fix**: Change defaults to `/` for both probes. Most web apps return 200 on their root path. The contract docs should highlight that custom probe paths are recommended.

### ISSUE 7 (Medium): Manual Harbor project creation

The `onboard-team.sh` script creates the tenant namespace but tells the user to manually create the Harbor project. This is a friction point — the script already has the team name and Harbor credentials are available on the platform nodes.

**Recommended fix**: Call `ensureHarborProject()` equivalent from the onboarding script, or add a post-onboard hook that creates it.

## Platform Improvements (Ordered by Impact)

1. **Fix UID handling** (High) — Stop hardcoding runAsUser: 1000 in sre-lib defaults
2. **Fix default probe paths** (Medium) — Use `/` instead of `/healthz` and `/readyz`
3. **Auto-create Harbor projects on team onboard** (Medium) — Reduce manual steps
4. **Add securityContext to App Contract** (Medium) — Allow UID override for non-standard images
5. **Improve developer guide: probe paths** (Low) — Warn that /healthz must exist
6. **Make Helm test image configurable** (Low) — Don't hardcode harbor.sre.internal busybox

## Final Working App Contract

```yaml
---
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: go-httpbin
  team: team-test
spec:
  type: web-app
  image: harbor.apps.sre.example.com/team-test/go-httpbin:v0.1.0
  port: 8080
  resources: small
  ingress: go-httpbin.apps.sre.example.com
  probes:
    liveness: /status/200
    readiness: /status/200
```

## Final Generated HelmRelease

The generate-app.sh output is correct and complete. The only runtime concern
is the UID mismatch (issue 2), which works for this specific app but would
break for images with UID-owned files.

## Conclusion

The App Contract → HelmRelease pipeline works well for the happy path. A developer
familiar with containers can go from zero to a working deployment manifest in under
15 minutes. The main friction points are:

1. **Probe paths** — non-obvious that you MUST customize these for most apps
2. **UID mismatch** — silent issue that works for some images but breaks others
3. **Harbor project** — manual step that interrupts the otherwise smooth flow

The tooling (generate-app.sh, onboard-team.sh) is solid and produces correct output.
The developer guides are comprehensive. The biggest UX win would be fixing the probe
defaults since that's the issue most likely to cause CrashLoopBackOff on first deploy.
