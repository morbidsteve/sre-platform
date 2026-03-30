# Platform Improvements Applied During Integration Testing

## Files Changed

| File | Change | Triggered By | Impact |
|------|--------|-------------|--------|
| `apps/templates/sre-lib/templates/_helpers.tpl` | Removed `runAsUser: 1000`, `runAsGroup: 1000`, `fsGroup: 1000` from podSecurityContext default | go-httpbin (distroless UID 65532) | All future deployments use image's own UID |
| `apps/templates/web-app/values.yaml` | Default probes `/healthz` → `/`, liveness delay 10→15s | go-httpbin, petclinic | All web-app deployments get working probes by default |
| `apps/templates/api-service/values.yaml` | Same probe defaults change | fastapi | All api-service deployments |
| `scripts/generate-app.sh` | Default probes `/healthz` → `/`, liveness delay 10→15s | go-httpbin, petclinic | All App Contract deployments |
| `apps/templates/web-app/templates/deployment.yaml` | Added `extraVolumeMounts` support | uptime-kuma | Stateful apps can mount extra writable paths |
| `apps/templates/web-app/values.yaml` | Added `extraVolumeMounts: []` default | uptime-kuma | Chart schema valid with new field |

## Change Details

### 1. UID Fix (sre-lib)

**Before:**
```yaml
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
```

**After:**
```yaml
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
```

**Why:** Images use diverse UIDs (65532, 101, 33, etc). Hardcoding 1000 overrides the image's intent and can cause permission errors. `runAsNonRoot: true` is sufficient — it rejects root without forcing a specific UID.

### 2. Probe Defaults

**Before:** `/healthz` and `/readyz` (Kubernetes conventions)
**After:** `/` and `/` (root path)

**Why:** Most web applications respond on their root path. K8s conventions require custom endpoints that most apps don't implement. Using `/` works for ~90% of apps out of the box.

### 3. Liveness Delay

**Before:** 10 seconds
**After:** 15 seconds

**Why:** JVM, .NET, Rails, and other framework apps take 15-60s to start. With `failureThreshold: 3` and `periodSeconds: 10`, the pod now has 45s (15 + 3*10) before first restart, which is sufficient for most apps.

### 4. extraVolumeMounts

**Before:** Only `/tmp` and `/var/cache` available as writable paths
**After:** Developers can add arbitrary writable mounts via `extraVolumeMounts`

**Why:** Stateful apps (uptime-kuma, wordpress, any SQLite or file-based app) need writable paths beyond /tmp.
