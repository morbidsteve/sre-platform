# Platform Experience Enhancement Plan

This plan covers 30 enhancements across every human touchpoint of the SRE platform: ISSM review, operator day-2, compliance/ATO, admin management, and cross-cutting UX. These are independent of the developer integration tasks in `docs/developer-readiness-plan.md`.

**Goal:** Make the platform intuitive for every persona — the ISSM reviewing at their desk, the operator paged at 3am, the assessor auditing for ATO, and the admin onboarding a new team.

---

## Phase 1: ISSM Review Experience

### Task 1.1: ISSM Notifications via Slack/Email

**Problem:** The ISSM has to manually check the Security tab to see pending reviews. There are no push notifications. A pipeline can sit in `review_pending` for hours before the ISSM notices.

**What exists:**
- Security tab has a review queue with auto-refresh every 10s
- Pipeline runs transition to `review_pending` via `POST /api/pipeline/runs/:id/submit-review`
- No notification hooks on status transitions

**Where:** `apps/dashboard/server.js` — the submit-review endpoint (around line 6573-6626)

**Steps:**
1. Add a notification dispatch function that fires when a pipeline run enters `review_pending`:
   ```javascript
   async function notifyISSM(run) {
     const payload = {
       text: `New ISSM Review Required`,
       blocks: [
         { type: "header", text: { type: "plain_text", text: "Pipeline Review Needed" } },
         { type: "section", fields: [
           { type: "mrkdwn", text: `*App:* ${run.app_name}` },
           { type: "mrkdwn", text: `*Team:* ${run.team}` },
           { type: "mrkdwn", text: `*Submitted by:* ${run.created_by}` },
           { type: "mrkdwn", text: `*Findings:* ${run.findings_critical} critical, ${run.findings_high} high` },
         ]},
         { type: "actions", elements: [
           { type: "button", text: { type: "plain_text", text: "Review Now" },
             url: `https://dashboard.apps.sre.example.com/#security?run=${run.id}` }
         ]}
       ]
     };
     // Send to Slack webhook (from OpenBao or env var)
     await fetch(process.env.ISSM_SLACK_WEBHOOK || await getSlackWebhook(), {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(payload)
     });
   }
   ```

2. Call `notifyISSM(run)` at the end of the submit-review handler after status transitions to `review_pending`.

3. Also notify the developer when the ISSM makes a decision (approved/rejected/returned):
   - Notification includes: decision, comment (if any), link to the run
   - Send to a team-specific Slack channel or the submitter's email

4. Store the webhook URL in OpenBao at `sre/platform/notifications/slack-webhook` and read via ESO or direct API call. Fall back to `ISSM_SLACK_WEBHOOK` env var.

5. Make notifications optional — if no webhook is configured, skip silently with a log message.

**Acceptance Criteria:**
- Slack message sent when pipeline enters `review_pending`
- Slack message sent when ISSM approves/rejects/returns
- Message includes app name, team, finding severity counts, and direct link
- Works without Slack configured (no crash, just skips)

---

### Task 1.2: Review SLA Timer with Escalation

**Problem:** No tracking of how long reviews sit in queue. An app can be stuck in `review_pending` for days without anyone noticing.

**Where:** `apps/dashboard/client/src/components/security/SecurityTab.tsx` — the ISSM review queue cards. `apps/dashboard/server.js` — pipeline stats and alerting.

**Steps:**
1. Add SLA thresholds as server config:
   ```javascript
   const REVIEW_SLA = {
     warning: 4 * 60 * 60 * 1000,   // 4 hours — yellow indicator
     critical: 8 * 60 * 60 * 1000,  // 8 hours — red indicator, escalation
   };
   ```

2. In the Security tab review queue, add a visual SLA indicator per card:
   - Green: < 4 hours in queue
   - Yellow: 4-8 hours (approaching SLA breach)
   - Red: > 8 hours (SLA breached)
   - Show elapsed time prominently: "Waiting 6h 23m"

3. Create a server-side check (run every 15 minutes via `setInterval`) that scans for `review_pending` runs exceeding the critical SLA:
   - Send escalation notification (Slack/email) to a secondary reviewer or security team lead
   - Add a Prometheus metric: `issm_review_wait_seconds{app, team}` (gauge, current wait time)
   - Add PrometheusRule alert:
     ```yaml
     - alert: ISSMReviewSLABreach
       expr: issm_review_wait_seconds > 28800
       for: 5m
       labels:
         severity: warning
       annotations:
         summary: "Pipeline review for {{ $labels.app }} has been waiting {{ $value | humanizeDuration }}"
     ```

4. Add SLA metrics to the Security tab posture cards: "Average Review Time: 2.3 hours" and "SLA Breach Count (30d): 0"

**Acceptance Criteria:**
- Review cards show color-coded wait time
- Escalation notification fires after 8 hours
- Prometheus metric exported for SLA tracking
- Average review time displayed in Security tab

---

### Task 1.3: Separation of Duties Enforcement

**Problem:** The pipeline creator can also be the ISSM reviewer. The code logs a warning but doesn't block (commented as "would be blocked in production").

**Where:** `apps/dashboard/server.js` — the review endpoint (around line 6648-6654)

**Steps:**
1. Add a config flag: `ENFORCE_SEPARATION_OF_DUTIES` (env var, default `false` for lab, `true` for production).
2. When enabled and the reviewer is the same user as the pipeline creator:
   - Return HTTP 403 with message: "Separation of duties violation: the pipeline submitter cannot also be the reviewer. A different ISSM must approve this run."
   - Log the attempt in the audit trail with action `separation_of_duties_blocked`
3. In the UI, if the current user is the creator, grey out the "Approve" button and show a tooltip: "You submitted this pipeline. A different ISSM must review it."
4. Allow "Reject" and "Return for Rework" regardless (returning your own work for rework is fine).
5. Document the flag in the operator guide.

**Acceptance Criteria:**
- When `ENFORCE_SEPARATION_OF_DUTIES=true`, creator cannot approve their own pipeline
- UI clearly explains why approval is blocked
- Reject and Return still work for the creator
- Audit trail records blocked attempts

---

### Task 1.4: ISSM Bulk Review

**Problem:** If 5 similar apps pass all gates with identical results, the ISSM must click into each one individually. No batch operations.

**Where:** `apps/dashboard/client/src/components/security/SecurityTab.tsx` — review queue section.

**Steps:**
1. Add checkboxes to each review queue card.
2. When 2+ cards are selected, show a "Bulk Review" action bar at the top of the queue:
   - "Approve Selected (N)" button
   - "Reject Selected (N)" button
   - Comment field (applied to all)
3. On bulk approve, call the review endpoint for each selected run sequentially.
4. Show progress: "Approving 3/5..." with per-run success/failure indicators.
5. Only allow bulk review when all selected runs have the same gate status (all passed or all warning). Mixed statuses require individual review.
6. After completion, refresh the queue.

**Acceptance Criteria:**
- Checkboxes on review cards
- Bulk approve/reject for runs with matching gate status
- Progress indicator during batch operation
- Comment applied to all runs in the batch

---

### Task 1.5: Finding-to-NIST Control Mapping in Pipeline Evidence

**Problem:** Pipeline gate findings (CVEs, SAST violations) aren't mapped to NIST controls. The ISSM sees "Trivy found CVE-2024-1234 in log4j" but not "this affects RA-5 (Vulnerability Scanning) and SI-2 (Flaw Remediation)."

**Where:** `apps/dashboard/server.js` — pipeline gate findings data. `apps/dashboard/client/src/components/security/GateEvidenceRow.tsx`.

**Steps:**
1. Create a mapping of pipeline gates to NIST controls:
   ```javascript
   const GATE_NIST_MAP = {
     'SAST':           ['SA-11', 'SI-10'],  // Developer Testing, Input Validation
     'Secrets':        ['IA-5', 'SC-28'],    // Authenticator Management, Protection at Rest
     'Build':          ['CM-2', 'SA-10'],    // Baseline Configuration, Dev Config Mgmt
     'SBOM':           ['CM-8', 'SA-11'],    // Component Inventory, Developer Testing
     'CVE':            ['RA-5', 'SI-2'],     // Vulnerability Scanning, Flaw Remediation
     'DAST':           ['SA-11', 'SC-7'],    // Developer Testing, Boundary Protection
     'ISSM_Review':    ['CA-2', 'CA-6'],     // Security Assessment, Authorization
     'Image_Signing':  ['SI-7', 'SA-10'],    // Software Integrity, Dev Config Mgmt
   };
   ```

2. In the gate evidence display, add a "Related Controls" badge row below each gate header showing the mapped NIST control IDs. Make each badge clickable — links to the Compliance tab filtered to that control.

3. In the findings detail rows, add a small "NIST" tag next to each finding's severity badge showing the most relevant control.

4. In the compliance package JSON export, include a `nistControls` field per gate.

**Acceptance Criteria:**
- Each pipeline gate shows its related NIST control IDs
- ISSM can click a control ID to see its implementation details in the Compliance tab
- Compliance package includes NIST mapping per gate

---

## Phase 2: Operator Day-2 Experience

### Task 2.1: Morning Health Check Script

**Problem:** Operators have no single command to verify "is everything healthy?" They must run 5+ kubectl/flux commands manually.

**Where:** Create `scripts/morning-health-check.sh`

**Steps:**
1. Create the script with these checks, each outputting a colored PASS/WARN/FAIL line:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   echo "=== SRE Platform Health Check — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
   echo ""

   # 1. Flux HelmReleases
   FAILED_HR=$(flux get helmreleases -A --no-header 2>/dev/null | grep -cv "True" || echo "0")
   TOTAL_HR=$(flux get helmreleases -A --no-header 2>/dev/null | wc -l)
   # Print PASS/FAIL with count

   # 2. Flux Kustomizations
   FAILED_KS=$(flux get kustomizations -A --no-header 2>/dev/null | grep -cv "True" || echo "0")

   # 3. Node health
   NOT_READY=$(kubectl get nodes --no-headers 2>/dev/null | grep -cv "Ready" || echo "0")

   # 4. CrashLooping pods (across all namespaces)
   CRASH_PODS=$(kubectl get pods -A --no-headers 2>/dev/null | grep -c "CrashLoopBackOff" || echo "0")

   # 5. Pending pods > 5 minutes old
   # 6. Certificate expiry (certs expiring in < 30 days)
   # 7. Last Velero backup status
   # 8. OpenBao seal status
   # 9. Active Prometheus alerts (critical + warning counts)
   # 10. Loki ingestion (are logs flowing?)
   # 11. ExternalSecret sync failures
   # 12. Disk usage on nodes > 80%

   echo ""
   echo "=== Summary: X PASS, Y WARN, Z FAIL ==="
   ```

2. Support `--json` flag for machine-readable output (CI/CD integration).
3. Support `--slack` flag that posts the summary to a Slack channel.
4. Add to `Taskfile.yml` as `task health-check`.
5. Document in `docs/operator-guide.md` as the recommended start-of-day procedure.

**Acceptance Criteria:**
- Single command shows full platform health
- Color-coded PASS/WARN/FAIL per check
- JSON output mode for automation
- Slack output mode for team visibility
- Documented in operator guide

---

### Task 2.2: Missing Runbooks

**Problem:** 11 runbooks exist but 5 common scenarios are missing that operators encounter frequently.

**Where:** Create new files in `docs/runbooks/`

**Steps:** Create the following runbooks, each following the existing format (Alert, Severity, Impact, Investigation Steps, Resolution, Prevention, Escalation):

1. **`docs/runbooks/pod-oomkilled.md`** — Pod OOMKilled
   - Investigation: `kubectl describe pod`, check memory limits vs actual usage, check for memory leaks
   - Resolution: Increase memory limits, fix the leak, add memory-based HPA
   - PromQL: `container_memory_working_set_bytes{namespace="X"} / container_spec_memory_limit_bytes`

2. **`docs/runbooks/image-pull-failure.md`** — ImagePullBackOff / ErrImagePull
   - Investigation: Check image name/tag, verify Harbor project exists, check robot credentials, check node DNS, check registry certificate
   - Resolution: Fix image reference, refresh Harbor credentials, restart containerd
   - Common cause: typo in image tag, expired robot token, Harbor down

3. **`docs/runbooks/dns-resolution-failure.md`** — CoreDNS failures
   - Investigation: `kubectl exec -it <pod> -- nslookup kubernetes.default`, check CoreDNS pods, check CoreDNS ConfigMap
   - Resolution: Restart CoreDNS, check node /etc/resolv.conf, verify NetworkPolicy allows DNS egress
   - Common cause: CoreDNS pods OOMKilled, NetworkPolicy blocks port 53

4. **`docs/runbooks/etcd-health.md`** — etcd degradation
   - Investigation: `etcdctl endpoint health`, check etcd pod logs, check disk I/O latency
   - Resolution: Defragment etcd, check disk space, check slow disk (RKE2 embeds etcd)
   - Warning: etcd is sensitive — do NOT restart without understanding the issue

5. **`docs/runbooks/external-secrets-sync-failure.md`** — ExternalSecret not syncing
   - Investigation: `kubectl get externalsecrets -A`, check ESO controller logs, verify OpenBao connectivity, check ClusterSecretStore status
   - Resolution: Restart ESO controller, refresh OpenBao token, fix KV path
   - Common cause: OpenBao sealed, Kubernetes auth token expired, wrong KV path

**Acceptance Criteria:**
- All 5 runbooks created with full Investigation/Resolution/Prevention/Escalation sections
- Each includes copy-paste diagnostic commands
- Each includes the relevant Prometheus alert name (if one exists)
- Added to `docs/runbooks/README.md` index

---

### Task 2.3: On-Call Playbook with Decision Tree

**Problem:** No "you just got paged, now what" guide. Operators must manually figure out which runbook to use.

**Where:** Create `docs/on-call-playbook.md`

**Steps:**
Create a structured document with:

1. **First Response Checklist** (do this within 5 minutes of being paged):
   ```
   1. Run: ./scripts/morning-health-check.sh
   2. Check active alerts: Grafana > Alerting or AlertManager UI
   3. Check Flux status: flux get helmreleases -A --status-selector ready=false
   4. Check node health: kubectl get nodes
   5. Check for CrashLooping pods: kubectl get pods -A | grep -E 'CrashLoop|Error|ImagePull'
   ```

2. **Decision Tree** (Mermaid diagram):
   ```mermaid
   graph TD
     A[Alert Fired] --> B{What type?}
     B -->|Pod issue| C{What status?}
     C -->|CrashLoopBackOff| D[runbooks/pod-security-violation.md<br/>or check logs]
     C -->|OOMKilled| E[runbooks/pod-oomkilled.md]
     C -->|ImagePullBackOff| F[runbooks/image-pull-failure.md]
     C -->|Pending| G{Check events}
     G -->|Quota exceeded| H[Increase quota or reduce replicas]
     G -->|No nodes available| I[runbooks/node-not-ready.md]
     B -->|Node issue| J[runbooks/node-not-ready.md]
     B -->|Certificate| K[runbooks/certificate-expiry.md]
     B -->|Flux/GitOps| L[runbooks/flux-reconciliation-failure.md]
     B -->|Secrets/Vault| M[runbooks/openbao-sealed.md]
     B -->|Network/mTLS| N[runbooks/istio-mtls-failure.md]
     B -->|Memory pressure| O[runbooks/high-memory-usage.md]
     B -->|Security event| P[runbooks/pod-security-violation.md]
   ```

3. **Severity Matrix**:

   | Alert | Severity | Action | Wake someone? |
   |-------|----------|--------|---------------|
   | NodeNotReady | P1 | Immediate investigation | Yes if >1 node |
   | OpenBaoSealed | P1 | Unseal immediately | Yes |
   | FluxReconciliationFailureCritical | P2 | Investigate within 1h | No, unless deployments blocked |
   | CertificateExpiryCritical | P2 | Renew within 24h | No |
   | HighMemoryPressure | P2 | Investigate, may need to evict pods | No |
   | KyvernoPolicyViolation | P3 | Review next business day | No |
   | HarborCriticalVulnerability | P3 | Assess and plan remediation | No |

4. **Safe vs. Dangerous Operations**:

   | Operation | Safety | Notes |
   |-----------|--------|-------|
   | Restart a Deployment | Safe | Pods roll gracefully |
   | Restart Kyverno | Safe | Policies persist, brief admission gap |
   | Restart Istio | Careful | Existing connections preserved, new connections may fail briefly |
   | Restart OpenBao | Dangerous | Requires unseal after restart |
   | Delete a PVC | Dangerous | Data loss, cannot be undone |
   | Force delete a pod | Careful | Use only if graceful delete is stuck |
   | `flux reconcile` | Safe | Forces immediate GitOps sync |
   | `helm rollback` | Careful | Must suspend Flux first or it will re-apply |

5. **Escalation Contacts** (template — fill in real names):
   ```
   Platform Lead: [name] — page for P1 infrastructure issues
   Security Lead: [name] — page for security events, NeuVector alerts
   ISSM: [name] — for policy violations requiring review
   ```

6. **Shift Handoff Template**:
   ```
   ## Handoff — [date] [shift]
   - Active issues: [none / list]
   - Ongoing maintenance: [none / list]
   - Alerts firing: [none / list]
   - Recent deployments: [list apps deployed in last 24h]
   - TODO for next shift: [list]
   ```

**Acceptance Criteria:**
- On-call playbook exists with decision tree, severity matrix, and safe operations table
- First-response checklist is copy-paste-able
- Escalation contacts have placeholder names
- Shift handoff template is included
- Referenced from runbook README and operator guide

---

### Task 2.4: Missing Alerting Rules

**Problem:** 25 alerts exist but several infrastructure-critical scenarios aren't monitored.

**Where:** `platform/core/monitoring/sre-alerting-rules.yaml`

**Steps:**
Add these PrometheusRule alert definitions:

```yaml
# etcd
- alert: EtcdLeaderChanges
  expr: increase(etcd_server_leader_changes_seen_total[1h]) > 3
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "etcd leader changed {{ $value }} times in the last hour"
    runbook_url: "docs/runbooks/etcd-health.md"

# API Server
- alert: KubernetesAPIServerHighLatency
  expr: histogram_quantile(0.99, rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[5m])) > 1
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "API server p99 latency is {{ $value }}s"

# CoreDNS
- alert: CoreDNSHighErrorRate
  expr: sum(rate(coredns_dns_responses_total{rcode="SERVFAIL"}[5m])) / sum(rate(coredns_dns_responses_total[5m])) > 0.01
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "CoreDNS error rate is {{ $value | humanizePercentage }}"
    runbook_url: "docs/runbooks/dns-resolution-failure.md"

# External Secrets
- alert: ExternalSecretSyncFailure
  expr: externalsecret_status_condition{condition="SecretSynced", status="False"} == 1
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "ExternalSecret {{ $labels.name }} in {{ $labels.namespace }} is not syncing"
    runbook_url: "docs/runbooks/external-secrets-sync-failure.md"

# Velero
- alert: VeleroBackupMissed
  expr: time() - velero_backup_last_successful_timestamp{schedule!=""} > 90000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Velero backup schedule {{ $labels.schedule }} last succeeded {{ $value | humanizeDuration }} ago"

# Istio sidecar injection
- alert: IstioSidecarInjectionFailure
  expr: increase(sidecar_injection_failure_total[1h]) > 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Istio sidecar injection failures detected"

# Harbor replication
- alert: HarborReplicationFailure
  expr: harbor_replication_status{status="Failed"} > 0
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Harbor replication job failed"

# Container runtime restarts
- alert: ContainerdRestart
  expr: increase(process_start_time_seconds{job="containerd"}[1h]) > 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "containerd restarted on {{ $labels.instance }}"
```

**Acceptance Criteria:**
- 8 new alerts added to sre-alerting-rules.yaml
- Each alert has a `runbook_url` annotation pointing to the relevant runbook
- Alerts fire correctly when conditions are met
- No false positives on healthy cluster

---

### Task 2.5: Synthetic Monitoring

**Problem:** The platform monitors component health but not user-facing behavior. If the Istio gateway is misconfigured, no alert fires until a user reports "I can't reach my app."

**Where:** Create `platform/core/monitoring/synthetic-probes/`

**Steps:**
1. Deploy [Prometheus Blackbox Exporter](https://github.com/prometheus/blackbox_exporter) via HelmRelease in the monitoring namespace.

2. Create probe targets as a ConfigMap:
   ```yaml
   modules:
     http_2xx:
       prober: http
       timeout: 10s
       http:
         valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
         valid_status_codes: [200, 301, 302]
         follow_redirects: true
         tls_config:
           insecure_skip_verify: true
     tcp_connect:
       prober: tcp
       timeout: 5s
   ```

3. Create Prometheus scrape config (via ServiceMonitor or additionalScrapeConfigs) that probes:
   - `https://dashboard.apps.sre.example.com` — Is the dashboard reachable?
   - `https://grafana.apps.sre.example.com` — Is Grafana reachable?
   - `https://harbor.apps.sre.example.com` — Is Harbor reachable?
   - `https://keycloak.apps.sre.example.com` — Is Keycloak reachable?
   - `tcp://kubernetes.default.svc:443` — Is the API server reachable from in-cluster?

4. Add PrometheusRule alerts:
   ```yaml
   - alert: SyntheticProbeFailure
     expr: probe_success == 0
     for: 2m
     labels:
       severity: critical
     annotations:
       summary: "{{ $labels.instance }} is unreachable"
   ```

5. Create a Grafana dashboard `synthetic-probes.json` showing: probe success rate, latency, TLS certificate expiry (from probe), and uptime percentage per target.

**Acceptance Criteria:**
- Blackbox exporter deployed and scraping 5+ targets
- Alert fires within 2 minutes if any target is unreachable
- Grafana dashboard shows probe status and latency history
- Operators can see "is the platform working from a user's perspective?"

---

### Task 2.6: Automated Secret Rotation Script

**Problem:** Secrets are manually rotated with no schedule or automation. Platform credentials (Harbor robot, Keycloak admin, Cosign key) never get rotated unless someone remembers.

**Where:** Create `scripts/rotate-secrets.sh`

**Steps:**
1. Create the script with these rotation functions:

   ```bash
   #!/usr/bin/env bash
   # Rotate platform credentials and store new values in OpenBao
   # Usage: ./scripts/rotate-secrets.sh [--dry-run] [--component harbor|keycloak|cosign|all]

   rotate_harbor_robot() {
     # 1. Create new Harbor robot account via API
     # 2. Store new credentials in OpenBao at sre/platform/harbor-robot
     # 3. Delete old robot account
     # 4. Force ESO sync: kubectl annotate externalsecret ...
     # 5. Restart affected pods (Tekton, Flux image automation)
   }

   rotate_cosign_key() {
     # 1. Generate new key pair: cosign generate-key-pair
     # 2. Store private key in OpenBao at sre/platform/cosign
     # 3. Update Kyverno policy with new public key
     # 4. Sign all existing images with new key (or document migration period)
   }

   rotate_keycloak_admin() {
     # 1. Generate new password
     # 2. Update via Keycloak Admin API
     # 3. Store in OpenBao at sre/platform/keycloak-admin
     # 4. Update any references
   }
   ```

2. Support `--dry-run` mode that shows what would be rotated without making changes.
3. Log all rotations to stdout and to OpenBao audit log.
4. Document the recommended rotation schedule in `docs/operator-guide.md`:
   - Harbor robot credentials: every 90 days
   - Cosign signing key: every 365 days (or on compromise)
   - Keycloak admin password: every 90 days
   - OpenBao root token: every 90 days

**Acceptance Criteria:**
- Script rotates Harbor, Cosign, and Keycloak credentials
- Dry-run mode available
- New credentials stored in OpenBao
- Rotation schedule documented in operator guide

---

### Task 2.7: Scheduled DR Test

**Problem:** `scripts/dr-test.sh` exists but isn't run automatically. Backups may silently fail to restore for months.

**Where:** `ci/` or `platform/core/backup/`

**Steps:**
1. Create a Kubernetes CronJob that runs the namespace-level DR test monthly:
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: dr-test-monthly
     namespace: backup
   spec:
     schedule: "0 2 1 * *"  # 2am on the 1st of each month
     jobTemplate:
       spec:
         template:
           spec:
             containers:
               - name: dr-test
                 image: harbor.apps.sre.example.com/platform/sre-tools:v1.0.0
                 command: ["/scripts/dr-test.sh", "namespace", "--json"]
             restartPolicy: OnFailure
   ```

2. The CronJob output should be scraped by Alloy and sent to Loki (stdout logging).

3. Add a PrometheusRule alert:
   ```yaml
   - alert: DRTestNotRun
     expr: time() - kube_cronjob_status_last_successful_time{cronjob="dr-test-monthly"} > 3024000
     for: 1h
     labels:
       severity: warning
     annotations:
       summary: "DR test hasn't run successfully in 35 days"
   ```

4. Add DR test status to the morning health check script.

**Acceptance Criteria:**
- Monthly CronJob runs DR test automatically
- Alert fires if DR test hasn't succeeded in 35 days
- DR test results visible in Loki logs
- Morning health check shows last DR test status

---

### Task 2.8: Incident Response Template

**Problem:** No post-incident review format. After an outage, there's no structured way to capture what happened and prevent recurrence.

**Where:** Create `docs/incident-template.md`

**Steps:**
Create a template:

```markdown
# Incident Report: [TITLE]

**Date:** YYYY-MM-DD
**Duration:** HH:MM (from detection to resolution)
**Severity:** P1 / P2 / P3
**On-Call:** [name]
**Status:** Resolved / Monitoring

## Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired: [alert name] |
| HH:MM | On-call acknowledged |
| HH:MM | Root cause identified |
| HH:MM | Fix applied |
| HH:MM | Monitoring confirmed resolution |

## Impact
- **Users affected:** [number or description]
- **Services affected:** [list]
- **Data loss:** None / [description]

## Root Cause
[1-2 paragraphs describing what went wrong and why]

## Resolution
[What was done to fix the immediate issue]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Preventive measure] | [name] | YYYY-MM-DD | Open |

## Lessons Learned
- What went well:
- What could be improved:
- What was lucky:
```

Reference this template from the on-call playbook (Task 2.3).

**Acceptance Criteria:**
- Template exists with all sections
- Referenced from on-call playbook
- Includes timeline, root cause, action items, and lessons learned

---

## Phase 3: Compliance & ATO Experience

### Task 3.1: Dynamic SSP Generation from Live Cluster

**Problem:** The OSCAL SSP (`compliance/oscal/ssp.json`) is a static file that drifts from reality. When components are upgraded or reconfigured, the SSP doesn't reflect the change.

**Where:** Create `scripts/generate-ssp.sh` or extend `scripts/compliance-report.sh`

**Steps:**
1. Create a script that queries the live cluster and generates an OSCAL-formatted SSP:
   - Query all HelmReleases for component names and versions
   - Query Kyverno ClusterPolicies for policy enforcement status
   - Query cert-manager Certificates for TLS configuration
   - Query Istio PeerAuthentication for mTLS mode
   - Query NetworkPolicies for network segmentation evidence
   - Map each finding to the existing NIST control mapping in `compliance/nist-800-53-mappings/control-mapping.json`

2. Output a complete OSCAL SSP JSON that includes:
   - System characteristics (from static template + live component versions)
   - Control implementations with **live evidence** (component version, health status, policy count)
   - Responsible roles (from static template)
   - Timestamp of generation

3. Diff capability: `./scripts/generate-ssp.sh --diff` compares live state against the committed `ssp.json` and highlights changes.

4. Add to `Taskfile.yml` as `task generate-ssp`.

**Acceptance Criteria:**
- Script generates OSCAL SSP from live cluster state
- Component versions are real (not hardcoded)
- Diff mode shows what changed since last generation
- Output is valid OSCAL 1.1.2 JSON

---

### Task 3.2: POA&M Tracker

**Problem:** No way to track open security findings with remediation timelines. Findings from Trivy scans, Kyverno violations, and NeuVector alerts are ephemeral — they appear and disappear but nobody tracks whether they were actually fixed.

**Where:** Create `compliance/poam/` directory and a dashboard UI section.

**Steps:**
1. Create a YAML-based POA&M format:
   ```yaml
   # compliance/poam/findings.yaml
   findings:
     - id: POAM-001
       source: trivy
       title: "CVE-2024-1234 in openssl 3.0.2"
       severity: high
       nist_controls: ["RA-5", "SI-2"]
       affected_resources: ["harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0"]
       discovered: "2026-03-15"
       due_date: "2026-04-15"
       responsible_team: team-alpha
       remediation_plan: "Upgrade base image to alpine:3.19 which includes openssl 3.2.1"
       status: open  # open, in_progress, mitigated, accepted_risk, closed
       milestones:
         - date: "2026-03-20"
           description: "Identified fix: upgrade base image"
         - date: "2026-03-25"
           description: "PR submitted with fix"
   ```

2. Create `scripts/poam-check.sh` that:
   - Reads `compliance/poam/findings.yaml`
   - Checks for overdue findings (past `due_date` and still `open` or `in_progress`)
   - Reports summary: X open, Y overdue, Z closed in last 30 days
   - Outputs as colored terminal report or JSON

3. Add a "Findings (POA&M)" section to the Compliance tab in the dashboard:
   - Table of all findings with: ID, severity, title, team, due date, status
   - Color-coded by status: red=overdue, yellow=approaching due date, green=closed
   - Filter by team, severity, status

4. Add to the morning health check: "POA&M: 3 open findings, 0 overdue"

**Acceptance Criteria:**
- POA&M YAML format exists with example findings
- Check script reports overdue findings
- Dashboard Compliance tab shows findings table
- Morning health check includes POA&M summary

---

### Task 3.3: Control Inheritance Matrix

**Problem:** Tenant developers don't know which security controls they inherit from the platform vs. which ones are their responsibility. An assessor asks "how does your app meet SC-8?" and the developer doesn't know the platform handles it.

**Where:** Create `docs/control-inheritance.md` and add a UI section.

**Steps:**
1. Create the inheritance document with three columns per control:

   ```markdown
   # Control Inheritance Matrix

   | NIST Control | Platform Provides (Inherited) | Tenant Responsibility (Shared/Owned) |
   |---|---|---|
   | AC-2 Account Mgmt | Keycloak SSO, group-based RBAC | Add users to team groups in Keycloak |
   | AC-3 Access Enforcement | K8s RBAC, Istio AuthzPolicy, NetworkPolicy | Use sre-api-service chart for fine-grained caller restrictions |
   | AC-4 Information Flow | Istio mTLS STRICT, default-deny NetworkPolicy | Define additionalEgress for external APIs |
   | AU-2 Audit Events | K8s audit logging, Istio access logs → Loki | Output structured JSON logs to stdout |
   | RA-5 Vulnerability Scanning | Harbor Trivy scanning, Kyverno image verification | Fix CVEs in your images, run CI pipeline |
   | SC-8 Transmission Confidentiality | Istio mTLS (all pod-to-pod encrypted) | Nothing — fully inherited |
   | SI-7 Software Integrity | Cosign image signatures, Kyverno verification | Sign images in CI pipeline |
   ```

2. For each control, categorize as:
   - **Inherited** — Platform handles it completely. Tenant does nothing.
   - **Shared** — Platform provides the mechanism, tenant must configure/use it.
   - **Tenant-Owned** — Tenant is fully responsible (e.g., input validation, session management).

3. Add a "What You Inherit" section to the Compliance tab (or as a standalone page) showing a visual matrix grouped by category.

4. Link from `docs/developer-guide.md` and `docs/onboarding-guide.md`.

**Acceptance Criteria:**
- All 48 NIST controls categorized as inherited/shared/tenant-owned
- Matrix is viewable in docs and dashboard
- Developers can answer "how does my app meet control X?"

---

### Task 3.4: Continuous Monitoring Evidence Collection (cATO)

**Problem:** For continuous ATO, assessors need periodic proof that controls are still working. Currently they have to manually check Grafana and run `compliance-report.sh`. There's no automated evidence trail over time.

**Where:** Create `platform/core/monitoring/compliance-evidence-cronjob.yaml` and a storage location.

**Steps:**
1. Create a CronJob that runs daily and captures a compliance snapshot:
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: compliance-evidence-collector
     namespace: monitoring
   spec:
     schedule: "0 6 * * *"  # 6am UTC daily
   ```

2. The job runs `scripts/compliance-report.sh --json` and stores the output as:
   - A ConfigMap in the `compliance` namespace (last 7 days, rotated)
   - A file in S3/MinIO (long-term storage, if configured)
   - A log entry in Loki (tagged `job=compliance-evidence`)

3. Add a Grafana dashboard panel that plots compliance score over time:
   - X-axis: date, Y-axis: % controls passing
   - Shows trend: is compliance improving or degrading?
   - Alert if score drops below threshold

4. Add the compliance trend to the dashboard Compliance tab: "30-Day Compliance Score: 100% (stable)"

**Acceptance Criteria:**
- Daily CronJob collects compliance evidence
- Evidence stored for at least 90 days
- Compliance score trend visible in Grafana
- Assessors can pull any day's evidence without running scripts manually

---

### Task 3.5: Unified Findings Aggregation View

**Problem:** Security findings live in silos: DSOP pipeline has CVEs, Kyverno has policy violations, NeuVector has runtime events, Harbor has scan results. Nobody has a single view of "all the things that are wrong."

**Where:** `apps/dashboard/client/src/components/security/SecurityTab.tsx` and `apps/dashboard/server.js`

**Steps:**
1. Create server endpoint: `GET /api/security/findings?namespace=<team>` that aggregates:
   - Kyverno PolicyReport violations (`kubectl get policyreport -A -o json`)
   - Pipeline findings from the DSOP database (open findings not yet mitigated)
   - Harbor vulnerability data (proxy to Harbor API: `/api/v2.0/projects/<project>/repositories/<repo>/artifacts/<tag>/additions/vulnerabilities`)
   - Active Prometheus security alerts (`ALERTS{alertname=~"Kyverno.*|NeuVector.*|Unauthorized.*"}`)

2. Normalize all findings to a common schema:
   ```typescript
   interface UnifiedFinding {
     id: string;
     source: 'kyverno' | 'pipeline' | 'harbor' | 'neuvector' | 'prometheus';
     severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
     title: string;
     description: string;
     affectedResource: string;  // namespace/kind/name
     nistControls: string[];    // e.g., ["RA-5", "SI-2"]
     firstSeen: string;
     status: 'open' | 'mitigated' | 'accepted';
     sourceUrl?: string;        // Deep link to source tool
   }
   ```

3. Add a "Findings" section to the Security tab (or new tab):
   - Summary cards: Critical/High/Medium/Low counts by source
   - Unified table: sortable by severity, filterable by source/namespace/status
   - Click finding to expand details + link to source tool
   - Trend chart: findings over time (from cATO evidence data)

**Acceptance Criteria:**
- Single view aggregates findings from 4+ sources
- Common schema with severity, NIST mapping, and source
- Filterable by source, namespace, severity
- Deep-links to source tools for each finding

---

## Phase 4: Admin & Multi-Tenancy Management

### Task 4.1: Tenant Lifecycle Management UI

**Problem:** Creating a tenant requires running a script. Deleting a tenant has no process at all. Adjusting quotas requires editing YAML and pushing to Git. There's no admin UI for any of this.

**Where:** `apps/dashboard/client/src/components/admin/` and `apps/dashboard/server.js`

**Steps:**
1. Add a "Tenants" sub-tab to the Admin tab with:
   - **Tenant list table:** name, pod count, CPU/memory usage vs quota, app count, creation date, health status
   - **Create Tenant button:** Form with team name, resource tier (small/medium/large), contact email. Calls `POST /api/admin/tenants` which runs the onboard-tenant.sh logic via API.
   - **Adjust Quota:** Inline edit button per tenant. Opens modal with CPU/memory/pod sliders. Updates the ResourceQuota manifest in Git and pushes.
   - **Delete Tenant:** Button with multi-step confirmation ("Type the tenant name to confirm"). Removes the tenant directory from `apps/tenants/`, commits, and pushes. Flux prunes the namespace.

2. Create server endpoints:
   - `GET /api/admin/tenants` — List all tenants with resource usage
   - `POST /api/admin/tenants` — Create tenant (wraps onboard-tenant.sh)
   - `PATCH /api/admin/tenants/:name/quota` — Update ResourceQuota
   - `DELETE /api/admin/tenants/:name` — Delete tenant (with safety checks)

3. Resource tiers:
   | Tier | CPU Req | CPU Lim | Mem Req | Mem Lim | Pods |
   |------|---------|---------|---------|---------|------|
   | Small | 2 | 4 | 4Gi | 8Gi | 10 |
   | Medium | 4 | 8 | 8Gi | 16Gi | 20 |
   | Large | 8 | 16 | 16Gi | 32Gi | 50 |

4. RBAC: Only `sre-admins` group can create/delete/adjust tenants.

**Acceptance Criteria:**
- Tenants viewable with resource usage in Admin tab
- Create, adjust quota, and delete all work from the UI
- Delete requires typing tenant name to confirm
- All changes go through Git (Flux reconciles)

---

### Task 4.2: Admin Action Audit Trail

**Problem:** Admin actions (user create, password reset, tenant create, app delete) are not logged. If someone deletes a user, there's no record of who did it.

**Where:** `apps/dashboard/server.js` — all admin API routes.

**Steps:**
1. Create an `auditLog()` function in the server:
   ```javascript
   async function auditLog(action, actor, target, details = {}) {
     const entry = {
       timestamp: new Date().toISOString(),
       action,    // 'user.created', 'user.deleted', 'tenant.created', 'app.deleted', etc.
       actor,     // Username from X-Auth-Request-User header
       target,    // What was acted on: 'user:jane', 'tenant:team-gamma', 'app:team-alpha/my-app'
       details,   // Additional context
       ip: req.headers['x-forwarded-for'] || req.ip,
     };
     // Store in pipeline DB (new audit_log table) and emit to Loki via stdout
     logger.info({ type: 'admin_audit', ...entry });
     await db.query('INSERT INTO audit_log (timestamp, action, actor, target, details) VALUES ($1, $2, $3, $4, $5)',
       [entry.timestamp, entry.action, entry.actor, entry.target, JSON.stringify(entry.details)]);
   }
   ```

2. Add `auditLog()` calls to all admin endpoints:
   - User CRUD (create, update, delete, password reset, group change)
   - Tenant CRUD (create, delete, quota change)
   - App operations (delete, restart, scale, rollback)
   - Pipeline operations (override gate, delete run)

3. Create `GET /api/admin/audit-log` endpoint with pagination and filters (action, actor, target, date range).

4. Add an "Audit Log" sub-tab to the Admin tab showing the log with search and filters.

**Acceptance Criteria:**
- Every admin action is logged with timestamp, actor, action, target
- Logs stored in database and emitted to Loki
- Audit log viewable in Admin tab with search/filter
- Cannot be modified or deleted (append-only)

---

### Task 4.3: Tenant Health Overview Dashboard

**Problem:** Admins have no single view of "how are all my tenants doing?" They must click into each namespace individually.

**Where:** `apps/dashboard/client/src/components/admin/` and `apps/dashboard/server.js`

**Steps:**
1. Create server endpoint: `GET /api/admin/tenants/overview` that returns per-tenant:
   - Pod count (running / total)
   - CPU/memory usage vs quota (percentage)
   - App count (HelmReleases)
   - Policy violation count (from Kyverno PolicyReports)
   - Last deployment timestamp
   - Health score (calculated: all pods running + no violations + within quota = healthy)

2. Add a "Tenant Overview" section to the Admin tab with:
   - Summary cards: Total tenants, total apps, total pods, overall health percentage
   - Tenant health grid: one card per tenant, color-coded by health score
   - Sort by: most resource usage, most violations, most recent deployment
   - Click a tenant card to drill into their namespace details

3. Add a "Resource Heatmap" visualization: grid where each cell is a tenant, color intensity shows resource utilization (green=low, yellow=medium, red=high).

**Acceptance Criteria:**
- Single view shows all tenants with health indicators
- Resource usage vs quota visible per tenant
- Policy violations surfaced per tenant
- Color-coded health score for quick scanning

---

## Phase 5: Cross-Cutting UX

### Task 5.1: Component Dependency Map

**Problem:** Operators don't know the blast radius of a component failure. If Istio goes down, what else breaks? If OpenBao is sealed, which apps lose secrets?

**Where:** `apps/dashboard/client/src/components/operations/` — new visualization. Or `docs/component-dependencies.md`.

**Steps:**
1. Create a dependency data structure:
   ```javascript
   const DEPENDENCIES = {
     'istio': { dependents: ['all-apps', 'keycloak', 'grafana', 'harbor', 'neuvector', 'openbao-ui'], impact: 'All mTLS, ingress, and service-to-service communication stops' },
     'cert-manager': { dependents: ['istio-gateway-certs', 'all-tls'], impact: 'Certificates stop renewing, TLS will eventually expire' },
     'kyverno': { dependents: ['admission-control'], impact: 'Policy enforcement disabled, any pod can be created' },
     'monitoring': { dependents: ['alerting', 'dashboards'], impact: 'No metrics, no alerts, blind to issues' },
     'logging': { dependents: ['audit-trail'], impact: 'No log collection, compliance gap in AU family' },
     'openbao': { dependents: ['external-secrets', 'all-app-secrets'], impact: 'Secrets stop syncing, new pods cant get credentials' },
     'external-secrets': { dependents: ['all-app-secrets'], impact: 'Kubernetes Secrets not updated from OpenBao' },
     'harbor': { dependents: ['image-pull', 'ci-cd-push'], impact: 'Cannot pull new images or push from CI' },
     'keycloak': { dependents: ['sso', 'rbac'], impact: 'SSO login fails for all UIs, new tokens cant be issued' },
     'flux': { dependents: ['gitops', 'all-deployments'], impact: 'GitOps stops, cluster drifts from Git state' },
   };
   ```

2. Render as an interactive graph in the Operations tab (use React Flow or D3):
   - Nodes are components, colored by current health (green/yellow/red)
   - Edges show dependencies
   - Click a node to see: impact description, dependent components, restart safety level, relevant runbook link

3. Also create a static Mermaid diagram in `docs/component-dependencies.md` for offline reference.

**Acceptance Criteria:**
- Interactive dependency graph in Operations tab
- Click any component to see blast radius and impact
- Graph reflects real-time health from HelmRelease status
- Static version available in docs

---

### Task 5.2: Troubleshooting Decision Tree in Dashboard

**Problem:** Operators must mentally map symptoms to runbooks. There's no guided troubleshooting flow.

**Where:** `apps/dashboard/client/src/` — new page or Operations sub-tab.

**Steps:**
1. Create an interactive decision tree component (wizard-style, step-by-step):
   ```
   Step 1: What's the symptom?
   ○ Pod not starting
   ○ App unreachable from outside
   ○ Service-to-service communication broken
   ○ Deployment not updating
   ○ High resource usage
   ○ Security alert
   ○ Something else

   [If "Pod not starting"]
   Step 2: What's the pod status?
   ○ CrashLoopBackOff → [Link to runbook + quick commands]
   ○ ImagePullBackOff → [Link to runbook + quick commands]
   ○ Pending → Step 3: Check events...
   ○ OOMKilled → [Link to runbook + quick commands]
   ○ ContainerCreating (stuck) → [Check init containers, Istio sidecar]
   ```

2. Each terminal node shows:
   - Relevant runbook link
   - 3-5 copy-paste diagnostic commands
   - "Did this fix it?" → Yes (done) / No (escalate)

3. Track usage analytics (which paths are most followed) to identify where new runbooks are needed.

**Acceptance Criteria:**
- Interactive troubleshooting wizard accessible from Operations tab
- Covers top 10 symptom categories
- Each path ends at a runbook or diagnostic commands
- Works on mobile (for on-call use)

---

### Task 5.3: Notification Hub Configuration

**Problem:** Notifications are scattered: AlertManager has a placeholder webhook, Flux has a placeholder notification provider, pipeline reviews have no notifications. There's no unified notification setup.

**Where:** Create `scripts/setup-notifications.sh` and update platform configs.

**Steps:**
1. Create a setup script that configures all notification channels with a single Slack webhook:
   ```bash
   #!/usr/bin/env bash
   # Usage: ./scripts/setup-notifications.sh --slack-webhook https://hooks.slack.com/services/...

   WEBHOOK_URL=$1

   # 1. Store webhook in OpenBao
   kubectl exec -n openbao openbao-0 -- vault kv put sre/platform/notifications/slack \
     webhook_url="${WEBHOOK_URL}"

   # 2. Configure AlertManager receiver
   # Update platform/core/monitoring/alertmanager-routing-configmap.yaml

   # 3. Configure Flux notification provider
   # Update platform/core/config/flux-notifications.yaml

   # 4. Set dashboard env var for pipeline notifications
   # Update apps/dashboard/k8s/deployment.yaml with ISSM_SLACK_WEBHOOK

   # 5. Commit and push (Flux reconciles)
   ```

2. After running the script, a single Slack channel receives:
   - Prometheus alerts (critical + warning)
   - Flux reconciliation failures
   - Pipeline reviews pending and decisions
   - Certificate expiry warnings
   - DR test results

3. Each message type has a distinct format (icon, color, structure) so the channel is scannable.

4. Document in `docs/operator-guide.md` under a new "Notifications" section.

**Acceptance Criteria:**
- Single script configures all notification channels
- All 5 notification sources send to one Slack channel
- Each message type is visually distinct
- Documented in operator guide

---

### Task 5.4: Mobile-Optimized On-Call View

**Problem:** The dashboard is desktop-first. An operator paged at 3am on their phone sees a cluttered UI that's hard to navigate.

**Where:** `apps/dashboard/client/src/` — new route or responsive layout.

**Steps:**
1. Create a `/on-call` route in the dashboard that renders a mobile-optimized view:
   - **Top section:** 3 large numbers — Nodes Ready, Pods Healthy, Alerts Active
   - **Alert list:** Active alerts sorted by severity (critical first), each showing: alert name, severity badge, namespace, duration, one-line description. Tap to expand with runbook link.
   - **Quick actions:** Large buttons for common operations:
     - "Force Flux Reconcile" → `flux reconcile kustomization sre-core`
     - "Check Health" → runs health check and shows results
     - "View Logs" → opens Grafana Explore in mobile mode
   - **Recent events:** Last 10 Kubernetes events (warnings only)

2. CSS: Use responsive breakpoints. At < 768px, switch to single-column layout with large touch targets (44px minimum).

3. No authentication change — uses the same OAuth2 Proxy session cookie.

4. Add a link to the on-call view from the main dashboard header (phone icon).

**Acceptance Criteria:**
- `/on-call` route renders a mobile-optimized view
- Alert list is readable on a phone screen
- Quick action buttons are large enough for touch
- Page loads in under 3 seconds on mobile

---

### Task 5.5: Guided First-Run Setup Wizard

**Problem:** After deploying the platform for the first time, there's no guided setup. The operator must read docs to figure out what to configure first (change default passwords, create tenants, set up notifications).

**Where:** `apps/dashboard/client/src/` — new component shown on first login.

**Steps:**
1. Detect first-run state: check if any tenants exist (`GET /api/admin/tenants` returns empty) AND if the admin password is still default.

2. Show a full-screen setup wizard with steps:

   **Step 1: Security Setup**
   - Change default Keycloak admin password
   - Change default Grafana admin password
   - Change default Harbor admin password
   - Generate Cosign signing key pair
   - Each shows current status (default/changed) with "Change Now" button

   **Step 2: Notification Setup**
   - Enter Slack webhook URL (or skip)
   - Test notification button
   - Shows which systems will be connected

   **Step 3: First Tenant**
   - Create first team namespace
   - Team name, resource tier
   - Creates namespace, RBAC, Harbor project, Keycloak groups

   **Step 4: First User**
   - Create first developer user in Keycloak
   - Assign to the team created in Step 3
   - Show login instructions to share with the developer

   **Step 5: Verification**
   - Run health check
   - Show platform status
   - Link to docs for next steps

3. Store completion state in a ConfigMap (`sre-setup-complete: "true"` in the `sre-dashboard` namespace). Don't show the wizard again after completion.

4. Allow skipping (but warn that defaults are insecure).

**Acceptance Criteria:**
- Setup wizard shown on first admin login
- Guides through password changes, notifications, first tenant, first user
- Each step shows completion status
- Not shown again after completion (stored in ConfigMap)
- Can be skipped with warning

---

## Execution Order Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| **Phase 1** | 1.1-1.5 | Medium (server + React + notifications) | HIGH — ISSM workflow |
| **Phase 2** | 2.1-2.8 | Medium (scripts + YAML + docs) | HIGH — operator day-2 |
| **Phase 3** | 3.1-3.5 | Large (scripts + dashboard + compliance artifacts) | HIGH — ATO readiness |
| **Phase 4** | 4.1-4.3 | Medium (React + API endpoints) | MEDIUM — admin self-service |
| **Phase 5** | 5.1-5.5 | Large (React + scripts + docs) | MEDIUM — cross-cutting UX |

**Recommended parallel execution:**
- Phase 1 (ISSM) + Phase 2.1-2.4 (operator scripts + alerts): independent, high impact
- Phase 2.5-2.8 (synthetic monitoring, rotation, DR, incident template): independent batch
- Phase 3.1-3.2 (dynamic SSP + POA&M): compliance-focused, can run together
- Phase 3.3-3.5 (inheritance matrix, cATO, findings aggregation): compliance UI, can run together
- Phase 4 (admin): independent of all others
- Phase 5 (cross-cutting): depends on Phases 2+3 for some data sources

---

## Verification Checklist

After all phases are complete, verify:

**ISSM Experience:**
- [ ] Slack notification fires when pipeline enters `review_pending`
- [ ] Slack notification fires when ISSM approves/rejects
- [ ] Review queue cards show color-coded SLA timer
- [ ] Alert fires after 8-hour SLA breach
- [ ] Creator cannot approve their own pipeline when enforcement is enabled
- [ ] Bulk review works for 2+ runs with matching gate status
- [ ] Pipeline gate evidence shows related NIST control IDs

**Operator Experience:**
- [ ] `./scripts/morning-health-check.sh` runs and reports full platform status
- [ ] All 5 new runbooks exist with copy-paste diagnostic commands
- [ ] On-call playbook exists with decision tree, severity matrix, and safe operations table
- [ ] 8 new alerting rules deployed and active in Prometheus
- [ ] Blackbox exporter probes 5+ endpoints with alerts on failure
- [ ] `./scripts/rotate-secrets.sh --dry-run` shows what would be rotated
- [ ] Monthly DR test CronJob is scheduled and runs successfully
- [ ] Incident response template exists and is referenced from on-call playbook

**Compliance/ATO Experience:**
- [ ] `./scripts/generate-ssp.sh` produces OSCAL SSP from live cluster state
- [ ] POA&M tracker exists with example findings and check script
- [ ] Control inheritance matrix categorizes all 48 controls
- [ ] Daily compliance evidence CronJob runs and stores snapshots
- [ ] Unified findings view aggregates Kyverno + Pipeline + Harbor + Prometheus sources

**Admin Experience:**
- [ ] Tenant create/delete/adjust-quota all work from Admin tab
- [ ] Admin actions (user CRUD, tenant CRUD, app delete) are audit-logged
- [ ] Tenant health overview shows all tenants with resource usage and health score

**Cross-Cutting UX:**
- [ ] Component dependency graph renders with real-time health
- [ ] Troubleshooting decision tree covers top 10 symptom categories
- [ ] `./scripts/setup-notifications.sh` configures all 5 notification sources with one webhook
- [ ] `/on-call` route is usable on a phone screen
- [ ] First-run setup wizard guides through initial configuration
