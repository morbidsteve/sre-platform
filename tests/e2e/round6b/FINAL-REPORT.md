# Round 6B: Sock Shop Deployment Report

## Status: 7/10 Services Running

| Service | Type | Status | Issue |
|---------|------|--------|-------|
| carts | Java API | ✅ 2/2 Running | |
| front-end | Node.js UI | ✅ 2/2 Running | |
| orders | Java API | ✅ 2/2 Running | |
| queue-master | Java worker | ✅ 2/2 Running | |
| shipping | Java API | ✅ 2/2 Running | |
| rabbitmq | Message broker | ✅ 2/2 Running | Needed CHOWN+SETUID+SETGID caps |
| user-db | MongoDB | ✅ 2/2 Running | Needed relaxed security context |
| payment | Go API | ❌ CrashLoop | Starts then terminates (probe timeout?) |
| user | Go API | ❌ CrashLoop | exec permission denied |
| orders-db | MongoDB | ❌ CrashLoop | chown permission denied (residual cap drop) |

## Platform Bugs Found

| # | Bug | Severity | Fixed? |
|---|-----|----------|--------|
| 1 | api-service + worker charts missing imagePullSecrets template | HIGH | Fixed (PR #49) |
| 2 | Legacy images need capabilities not just runAsNonRoot override | HIGH | Partial — some services need specific caps |
| 3 | Non-numeric USER (USER node/myuser) blocked by runAsNonRoot | MEDIUM | Known — use --run-as-root |
| 4 | Sock Shop Go binaries fail with drop ALL capabilities | MEDIUM | Need to not drop ALL for legacy apps |
| 5 | Flux chart rebuild lag after Git push | LOW | Expected — takes 1-2 reconciliation cycles |

## Key Learning

Legacy microservice architectures like Sock Shop were built assuming Docker's
default security context (many capabilities, root user, writable FS). The SRE
platform's hardened defaults (drop ALL, readOnlyRootFilesystem, runAsNonRoot)
are incompatible with these legacy patterns.

**Recommendation**: Add a `--legacy-mode` flag to the deploy script that sets:
- runAsNonRoot: false
- readOnlyRootFilesystem: false  
- allowPrivilegeEscalation: false (keep this)
- capabilities: drop only NET_RAW (not ALL)

This gives legacy apps Docker-equivalent security while still blocking the most
dangerous capabilities.

## Evidence

- 7/10 pods running in team-sock-shop namespace
- 12 images in Harbor (team-sock-shop project)
- PolicyException with audit trail
- NetworkPolicies allowing intra-namespace communication
