# Local Development Guide

This guide covers pre-push verification steps to ensure your application will pass the SRE platform's security policies and deployment checks before you commit.

## Pre-Push Checklist

Run through these checks locally before pushing. They mirror the platform's admission control and CI pipeline gates.

### 1. Verify non-root execution

The platform enforces `runAsNonRoot: true` on all pods. Test your image locally:

```bash
# Run as non-root with read-only filesystem (matches SRE security context)
docker run --rm \
  --user 1000:1000 \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/cache \
  --cap-drop ALL \
  -p 8080:8080 \
  your-image:tag
```

If it fails, your Dockerfile likely needs:

```dockerfile
# Create non-root user
RUN addgroup -g 1000 appgroup && adduser -u 1000 -G appgroup -D appuser

# Set writable directories before switching user
RUN mkdir -p /tmp /var/cache && chown -R appuser:appgroup /tmp /var/cache

USER appuser

# Use a non-privileged port
EXPOSE 8080
```

### 2. Verify health endpoints

The platform requires liveness and readiness probes. Confirm they return proper status codes:

```bash
# Start your app, then check endpoints
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/healthz
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/readyz
# Expected: 200 (or 503 if dependencies aren't available locally)
```

Minimal health endpoint implementations:

```javascript
// Node.js / Express
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/readyz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});
```

```python
# Python / Flask
@app.route('/healthz')
def healthz():
    return {'status': 'ok'}, 200

@app.route('/readyz')
def readyz():
    try:
        db.execute('SELECT 1')
        return {'status': 'ready'}, 200
    except Exception:
        return {'status': 'not ready'}, 503
```

```go
// Go
http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status":"ok"}`))
})
http.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
    if err := db.Ping(); err != nil {
        w.WriteHeader(http.StatusServiceUnavailable)
        w.Write([]byte(`{"status":"not ready"}`))
        return
    }
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status":"ready"}`))
})
```

### 3. Helm dry-run

Validate your HelmRelease values against the chart schema before pushing:

```bash
# Render templates locally (catches schema validation errors)
helm template my-app apps/templates/web-app/ \
  -f apps/tenants/team-alpha/apps/my-app-values.yaml \
  --debug

# Dry-run install (validates against Kubernetes API schemas)
helm install --dry-run --debug my-app apps/templates/web-app/ \
  -f apps/tenants/team-alpha/apps/my-app-values.yaml

# Lint the chart
helm lint apps/templates/web-app/ \
  -f apps/tenants/team-alpha/apps/my-app-values.yaml
```

Common errors caught by dry-run:
- Missing required values (`app.name`, `app.team`, `app.image.repository`)
- Invalid image tag (`:latest` is blocked by `values.schema.json`)
- Resource limit format issues (`500m` vs `0.5`)

### 4. Trivy vulnerability scan

Scan your image before pushing to Harbor. The CI pipeline will reject images with CRITICAL vulnerabilities.

```bash
# Install Trivy (if not already installed)
# brew install trivy  (macOS)
# sudo apt install trivy  (Debian/Ubuntu)

# Scan for vulnerabilities
trivy image --severity CRITICAL,HIGH your-image:tag

# Scan with the same thresholds as the CI pipeline
trivy image --exit-code 1 --severity CRITICAL your-image:tag

# Generate SBOM locally (same format as CI)
trivy image --format spdx-json --output sbom.json your-image:tag
```

Fix CRITICAL findings before pushing. HIGH findings generate warnings but do not block deployment.

### 5. Kyverno policy testing

Validate your Kubernetes manifests against SRE policies before pushing. This catches issues that would be rejected by the admission controller.

```bash
# Install kyverno CLI
# brew install kyverno  (macOS)
# go install github.com/kyverno/kyverno/cmd/cli/kubectl-kyverno@latest

# Render your Helm chart to plain YAML
helm template my-app apps/templates/web-app/ \
  -f apps/tenants/team-alpha/apps/my-app-values.yaml \
  > /tmp/rendered.yaml

# Test against SRE policies
kubectl-kyverno apply policies/baseline/ -r /tmp/rendered.yaml
kubectl-kyverno apply policies/restricted/ -r /tmp/rendered.yaml
kubectl-kyverno apply policies/custom/ -r /tmp/rendered.yaml
```

Common policy violations and fixes:

| Violation | Fix |
|-----------|-----|
| `require-run-as-nonroot` | Add `USER <non-root>` to Dockerfile |
| `disallow-latest-tag` | Use a specific version tag like `:v1.2.3` |
| `require-resource-limits` | Set `resources.limits.cpu` and `resources.limits.memory` |
| `restrict-image-registries` | Push image to `harbor.apps.sre.example.com` |
| `require-labels` | Ensure `app.name` and `app.team` values are set |

### 6. YAML lint

Validate all YAML files for syntax and formatting:

```bash
# From the repo root
task lint

# Or manually
yamllint apps/tenants/team-alpha/
```

### 7. Build check (platform apps only)

If you are modifying SRE platform applications:

```bash
# Dashboard (Node.js)
cd apps/dashboard && npm install && npx tsc --noEmit

# Portal (React/TypeScript)
cd apps/portal && npm install && npx tsc -b

# DSOP Wizard (React/TypeScript)
cd apps/dsop-wizard && npm install && npx tsc -b

# Demo app (Go)
cd apps/demo-app && go vet ./... && go build ./...
```

## Full Pre-Push Script

Run all checks in sequence:

```bash
#!/bin/bash
set -e

IMAGE="${1:?Usage: pre-push-check.sh <image:tag>}"
TEAM="${2:-team-alpha}"
APP="${3:-my-app}"

echo "=== 1. Non-root execution test ==="
docker run --rm --user 1000:1000 --read-only \
  --tmpfs /tmp --tmpfs /var/cache --cap-drop ALL \
  -d -p 8080:8080 --name pre-push-test "$IMAGE"
sleep 3

echo "=== 2. Health endpoint check ==="
curl -sf http://localhost:8080/healthz || { echo "FAIL: /healthz"; exit 1; }
curl -sf http://localhost:8080/readyz  || echo "WARN: /readyz unavailable (may need dependencies)"
docker stop pre-push-test

echo "=== 3. Trivy scan ==="
trivy image --exit-code 1 --severity CRITICAL "$IMAGE"

echo "=== 4. Helm dry-run ==="
helm template "$APP" apps/templates/web-app/ \
  -f "apps/tenants/$TEAM/apps/${APP}.yaml" --debug > /dev/null

echo "=== 5. Kyverno policy check ==="
helm template "$APP" apps/templates/web-app/ \
  -f "apps/tenants/$TEAM/apps/${APP}.yaml" > /tmp/rendered.yaml
kubectl-kyverno apply policies/baseline/ -r /tmp/rendered.yaml
kubectl-kyverno apply policies/restricted/ -r /tmp/rendered.yaml

echo "=== 6. YAML lint ==="
yamllint "apps/tenants/$TEAM/"

echo "=== All checks passed ==="
```

## Related Guides

- [Developer Guide](developer-guide.md) -- deployment workflow and configuration
- [Developer Guide: Container Image Requirements](developer-guide.md#container-image-requirements) -- image compatibility rules
- [Structured Logging Guide](logging-guide.md) -- structured logging setup
- [OpenTelemetry Tracing Guide](tracing-guide.md) -- distributed tracing instrumentation
