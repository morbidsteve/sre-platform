# sre-cronjob Helm Chart

Standard Helm chart for deploying scheduled jobs on the SRE platform.

## Resources Created

- CronJob with hardened security context (non-root, read-only rootfs, drop ALL)
- ServiceAccount (dedicated, no token auto-mount)
- NetworkPolicy (egress only: DNS, same namespace, HTTPS)
- Headless Service + ServiceMonitor for Prometheus metrics (optional)
- ExternalSecret for OpenBao secret sync (if configured)

## Quick Start

```yaml
# my-cronjob-values.yaml
app:
  name: db-cleanup
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/db-cleanup
    tag: "v1.0.0"
  command: ["/app/cleanup"]
  args: ["--older-than", "30d"]
  env:
    - name: DATABASE_URL
      secretRef: db-url

schedule:
  cron: "0 2 * * *"  # Daily at 2 AM
  timezone: "America/New_York"
```

```bash
helm install db-cleanup apps/templates/cronjob/ -f my-cronjob-values.yaml -n team-alpha
```

## Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.name` | Application name (required) | `""` |
| `app.team` | Owning team (required) | `""` |
| `app.image.repository` | Image from harbor.sre.internal (required) | `""` |
| `app.image.tag` | Pinned image tag (required, not "latest") | `""` |
| `app.resources.requests.cpu` | CPU request | `100m` |
| `app.resources.requests.memory` | Memory request | `128Mi` |
| `app.resources.limits.cpu` | CPU limit | `500m` |
| `app.resources.limits.memory` | Memory limit | `512Mi` |
| `app.command` | Container command | `[]` |
| `app.args` | Container command arguments | `[]` |
| `app.env` | Environment variables list | `[]` |
| `schedule.cron` | Cron expression (required) | `""` |
| `schedule.timezone` | IANA timezone | `""` |
| `schedule.concurrencyPolicy` | Allow, Forbid, or Replace | `"Forbid"` |
| `schedule.successfulJobsHistoryLimit` | Kept successful jobs | `3` |
| `schedule.failedJobsHistoryLimit` | Kept failed jobs | `3` |
| `schedule.startingDeadlineSeconds` | Missed schedule deadline | `300` |
| `schedule.activeDeadlineSeconds` | Job timeout | `3600` |
| `schedule.backoffLimit` | Retries before failure | `3` |
| `schedule.restartPolicy` | Never or OnFailure | `"Never"` |
| `serviceMonitor.enabled` | Enable Prometheus scraping | `false` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |

## Security Features

- Job pods run as non-root with read-only root filesystem
- All Linux capabilities dropped
- Privilege escalation disabled
- Seccomp profile set to RuntimeDefault
- ServiceAccount token not auto-mounted
- NetworkPolicy restricts all ingress, egress limited to DNS and HTTPS

## Operations

```bash
# Check CronJob status
kubectl get cronjob -l app.kubernetes.io/name=<app-name> -n <namespace>

# View job history
kubectl get jobs -l app.kubernetes.io/name=<app-name> -n <namespace>

# Trigger a manual run
kubectl create job --from=cronjob/<release>-<app-name> manual-run -n <namespace>

# View logs from latest job
kubectl logs -l app.kubernetes.io/name=<app-name> -n <namespace> --tail=100
```
