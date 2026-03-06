# Runbook: Harbor Scan Failure

## Alert

- **Prometheus Alert:** `HarborTrivyScanFailure` / `HarborComponentDown`
- **Grafana Dashboard:** Harbor dashboard (metrics from harbor-exporter)
- **Firing condition:** Trivy scanner reports errors, or scan jobs are stuck/failing for more than 15 minutes

## Severity

**Warning** -- Scan failures mean images are being pushed to Harbor without vulnerability assessment. This degrades the supply chain security posture and violates NIST RA-5 (Vulnerability Scanning) controls.

## Impact

- New images pushed to Harbor are not scanned for vulnerabilities
- Kyverno image verification policies that depend on scan results may not function correctly
- Compliance reporting shows gaps in vulnerability scanning coverage
- Developers do not receive scan feedback, potentially deploying vulnerable images

## Investigation Steps

1. Check Harbor pod status:

```bash
kubectl get pods -n harbor
```

2. Check the Trivy scanner pod specifically:

```bash
kubectl logs -n harbor -l component=trivy --tail=100
```

3. Check Harbor core logs for scan-related errors:

```bash
kubectl logs -n harbor -l component=core --tail=100 | grep -i "scan\|trivy\|vulnerability"
```

4. Check Harbor jobservice logs (scan jobs are queued here):

```bash
kubectl logs -n harbor -l component=jobservice --tail=100
```

5. Check the Harbor HelmRelease status:

```bash
flux get helmrelease harbor -n harbor
```

6. Verify Trivy can reach its vulnerability database:

```bash
kubectl exec -n harbor $(kubectl get pod -n harbor -l component=trivy -o name | head -1) -- trivy --version
```

7. Check Harbor Redis (used for job queue):

```bash
kubectl logs -n harbor -l component=redis --tail=50
```

8. Check if the Harbor database is healthy:

```bash
kubectl logs -n harbor -l component=database --tail=50
```

9. Check resource usage of Trivy pods:

```bash
kubectl top pods -n harbor -l component=trivy
```

10. Verify scan is actually failing by checking via the Harbor API:

```bash
# Port-forward to Harbor core
kubectl port-forward -n harbor svc/harbor-core 8080:80 &
curl -u admin:Harbor12345 http://localhost:8080/api/v2.0/projects/library/repositories | jq '.[].artifact_count'
```

## Resolution

### Trivy database update failure

Trivy downloads its vulnerability database on startup. If the download fails (network issues, rate limiting), scans fail.

1. Restart the Trivy pod to force a fresh database download:

```bash
kubectl rollout restart deployment -n harbor -l component=trivy
```

2. If rate limited by GitHub (Trivy DB hosted on ghcr.io), configure a GitHub token in the Harbor HelmRelease:

```yaml
trivy:
  gitHubToken: "<your-github-token>"
```

3. For air-gapped environments, manually download and mount the Trivy DB

### Trivy pod OOMKilled

1. Check if the pod was killed due to memory:

```bash
kubectl describe pod -n harbor -l component=trivy | grep -A 3 "Last State"
```

2. Increase Trivy memory limits in the Harbor HelmRelease (currently set to 512Mi):

```yaml
trivy:
  resources:
    limits:
      memory: 1Gi
```

3. Push the change to Git and reconcile:

```bash
flux reconcile helmrelease harbor -n harbor --with-source
```

### Harbor jobservice queue stuck

1. Check for stuck jobs:

```bash
kubectl logs -n harbor -l component=jobservice --tail=200 | grep -i "error\|stuck\|timeout"
```

2. Restart the jobservice:

```bash
kubectl rollout restart deployment -n harbor -l component=jobservice
```

### Harbor Redis connection failure

1. Check Redis pod status:

```bash
kubectl get pods -n harbor -l component=redis
kubectl logs -n harbor -l component=redis --tail=50
```

2. If Redis is not running, restart it:

```bash
kubectl rollout restart statefulset -n harbor -l component=redis
```

### Manual scan trigger

1. After fixing the underlying issue, trigger a scan manually via the API:

```bash
kubectl port-forward -n harbor svc/harbor-core 8080:80 &
# Scan a specific artifact
curl -X POST -u admin:Harbor12345 \
  "http://localhost:8080/api/v2.0/projects/<project>/repositories/<repo>/artifacts/<tag>/scan"
```

2. Or scan all artifacts in a project:

```bash
curl -X POST -u admin:Harbor12345 \
  "http://localhost:8080/api/v2.0/projects/<project>/repositories/<repo>/artifacts/scan"
```

### Full Harbor restart

If multiple components are failing:

```bash
flux suspend helmrelease harbor -n harbor
kubectl delete pods -n harbor --all
flux resume helmrelease harbor -n harbor
```

## Prevention

- Monitor `harbor_project_total` and scan-related metrics via the Harbor exporter
- Set alerts on Trivy pod restart count and scan failure rate
- Configure a GitHub token for Trivy to avoid rate limiting on vulnerability DB downloads
- Ensure sufficient memory for Trivy (1Gi recommended for large images)
- Set up Harbor garbage collection to prevent storage bloat that can slow down scans
- Regularly test scan functionality after Harbor upgrades

## Escalation

- If Trivy consistently fails to download its vulnerability database: check network egress policies and DNS resolution
- If Harbor core or database components are down: this affects all Harbor operations (push, pull, scan) -- escalate as P1
- If scan failures are blocking the CI/CD pipeline: developers can push images but should not deploy until scans complete -- notify affected teams
