# ATO & Compliance Intelligence Plan

This plan makes the entire Authority to Operate lifecycle — from initial RAISE 2.0 certification through continuous monitoring and quarterly reviews — intuitive and automated. It bridges the gap between the SRE platform (runtime) and the RPOC ATO Portal (documentation), turning manual compliance processes into smart, connected workflows.

**Goal:** An ISSM can maintain continuous ATO compliance by looking at a single dashboard, an assessor can pull evidence for any control in one click, and quarterly reviews generate themselves.

**Context:**
- **SRE Platform** (`sre-platform/`): Runtime engine with Kyverno policies, Istio mTLS, Trivy scanning, NeuVector runtime security, OpenBao secrets, and CI/CD pipeline with 8 RAISE 2.0 security gates
- **RPOC ATO Portal** (`rpoc-ato-portal/`): Static compliance documentation site with 12 HTML pages, 30 ATO package documents, NIST 800-53 tracker (~325 controls), RAISE 2.0 tracker (51 requirements), eMASS guide, SSP/SAR/POA&M editors
- **Current gap:** The portal shows static template data. The platform generates real compliance data. They don't talk to each other.

---

## Phase 1: Connect the Platform to the Portal (Live Data Bridge)

### Task 1.1: Create a Compliance API on the SRE Dashboard

**Problem:** The RPOC ATO Portal is a static site with template/demo data. The SRE platform has real compliance data (scan results, policy reports, component health, certificate status) but no API to expose it in a portal-consumable format.

**Where:** `apps/dashboard/server.js` — new `/api/compliance/*` endpoint group

**Steps:**
1. Create a set of compliance data API endpoints that aggregate data from the running cluster:

   ```
   GET /api/compliance/controls           — All NIST 800-53 controls with live health status
   GET /api/compliance/controls/:id       — Single control with full evidence chain
   GET /api/compliance/stig/summary       — STIG compliance summary (pass/fail/na counts)
   GET /api/compliance/pipeline/summary   — RAISE gate pass rates, total runs, finding counts
   GET /api/compliance/findings           — Aggregated findings from all sources
   GET /api/compliance/evidence/:controlId — Evidence artifacts for a specific control
   GET /api/compliance/score              — Overall compliance posture score (0-100)
   GET /api/compliance/score/history      — Score over time (daily snapshots)
   GET /api/compliance/components         — Platform component inventory with versions + health
   GET /api/compliance/certificates       — All certificates with expiry status
   GET /api/compliance/poam              — Open POA&M items with status
   ```

2. The `/controls` endpoint should merge:
   - Static control definitions from `compliance/nist-800-53-mappings/control-mapping.json`
   - Live health status from HelmRelease readiness
   - Kyverno PolicyReport violation counts per control
   - Recent evidence timestamps (last time control was verified)

3. The `/score` endpoint should calculate a weighted compliance score:
   - Each control gets a health score (1.0 = implemented + verified, 0.5 = partial, 0.0 = failed/missing)
   - Weight by priority (P1 controls worth more than P3)
   - Output: `{ score: 94.2, trend: "stable", controls: { total: 48, passing: 46, partial: 2, failing: 0 } }`

4. All endpoints return JSON, CORS-enabled for the RPOC portal to consume.

**Acceptance Criteria:**
- 11 compliance API endpoints operational
- Live health data from cluster, not hardcoded
- CORS allows RPOC portal to call these endpoints
- Score calculation is weighted by control priority

---

### Task 1.2: Wire RPOC Portal to Consume Live Data

**Problem:** The RPOC ATO Portal pages (`ato-controls-tracker.html`, `pipeline-dashboard.html`, `raise-tracker.html`, `poam.html`) display static demo data. They should pull real data from the SRE dashboard compliance API.

**Where:** `rpoc-ato-portal/` — JavaScript in each HTML page

**Steps:**
1. Add a configuration section at the top of each portal page (or a shared `js/config.js`):
   ```javascript
   const SRE_API = localStorage.getItem('sre_api_url') || 'https://dashboard.apps.sre.example.com';
   ```

2. On each portal page, replace hardcoded data with API fetches:

   **ato-controls-tracker.html:**
   - On load: `fetch('${SRE_API}/api/compliance/controls')` → populate control table with live status
   - Per-control health dots: green (passing), yellow (partial), red (failing)
   - Real finding counts from Kyverno PolicyReports
   - Last verified timestamp per control

   **pipeline-dashboard.html:**
   - On load: `fetch('${SRE_API}/api/compliance/pipeline/summary')` → populate gate pass rates
   - Show real SAST/CVE/SBOM/DAST findings from last 30 days
   - Pipeline run history chart

   **raise-tracker.html:**
   - RPOC requirements that map to platform capabilities: auto-check based on component health
   - Gate requirements: auto-check based on pipeline pass rates
   - APPO requirements: mark as manual (assessor checks these)

   **poam.html:**
   - On load: `fetch('${SRE_API}/api/compliance/poam')` → populate findings table
   - Live status with remediation timelines

3. Add a "Data Source" indicator in the portal footer: "Live from SRE Platform" (green) or "Offline / Demo Data" (yellow). Fall back to static demo data if the API is unreachable.

4. Add a settings page (or modal) where the user can configure the SRE API URL.

**Acceptance Criteria:**
- Portal shows live data when SRE API is reachable
- Falls back to demo data when offline (air-gap friendly)
- Data source indicator shows whether data is live or static
- API URL is configurable

---

### Task 1.3: Compliance Score Widget for SRE Dashboard

**Problem:** The SRE dashboard's Compliance tab has a list of controls, but no single number showing "how compliant are we right now?" Operators and ISSMs need an at-a-glance compliance posture.

**Where:** `apps/dashboard/client/src/components/compliance/ComplianceTab.tsx` and `apps/dashboard/client/src/components/overview/OverviewTab.tsx`

**Steps:**
1. Add a compliance score card to the **Overview tab** (next to existing health/alerts cards):
   - Large number: "Compliance Score: 94%" with color coding (green >90%, yellow 70-90%, red <70%)
   - Trend arrow: up/down/stable vs. 7 days ago
   - Subtitle: "46/48 controls passing"
   - Click navigates to Compliance tab

2. Add a score header to the **Compliance tab**:
   - Score gauge (circular progress indicator)
   - Breakdown bar: X implemented, Y partial, Z failing
   - Trend sparkline (last 30 days)
   - "Last assessed: 2 hours ago" timestamp

3. The score comes from `GET /api/compliance/score` (Task 1.1).

**Acceptance Criteria:**
- Compliance score visible on Overview tab
- Score gauge on Compliance tab with trend
- Color coding and trend arrows are intuitive
- Updates automatically on polling interval

---

## Phase 2: Smart ATO Package Assembly

### Task 2.1: One-Click ATO Evidence Package Generator

**Problem:** Assembling an ATO package requires manually collecting evidence from Grafana, kubectl, Harbor, and running multiple scripts. An assessor needs a ZIP with everything organized by NIST control family.

**Where:** Create `scripts/generate-ato-package.sh` and add a dashboard button.

**Steps:**
1. Create the script that generates a complete evidence package:

   ```bash
   #!/usr/bin/env bash
   # Usage: ./scripts/generate-ato-package.sh --output /tmp/ato-package-$(date +%Y%m%d)

   OUTPUT_DIR="${1:-/tmp/ato-package-$(date +%Y%m%d)}"
   mkdir -p "${OUTPUT_DIR}"

   echo "=== Generating ATO Evidence Package ==="

   # 1. System Security Plan (live-generated OSCAL)
   ./scripts/generate-ssp.sh > "${OUTPUT_DIR}/01-ssp.json"

   # 2. Compliance Report (live cluster assessment)
   ./scripts/compliance-report.sh --json > "${OUTPUT_DIR}/02-compliance-report.json"

   # 3. STIG Scan Results
   ./scripts/quarterly-stig-scan.sh --json > "${OUTPUT_DIR}/03-stig-scan.json"

   # 4. RBAC Audit
   ./scripts/rbac-audit.sh --json > "${OUTPUT_DIR}/04-rbac-audit.json"

   # 5. Kyverno Policy Reports
   kubectl get policyreport -A -o json > "${OUTPUT_DIR}/05-kyverno-policy-reports.json"
   kubectl get clusterpolicyreport -o json > "${OUTPUT_DIR}/05-kyverno-cluster-reports.json"

   # 6. Component Inventory (all HelmReleases with versions)
   flux get helmreleases -A -o json > "${OUTPUT_DIR}/06-component-inventory.json"

   # 7. Certificate Status
   kubectl get certificates -A -o json > "${OUTPUT_DIR}/07-certificate-status.json"

   # 8. Network Policies (evidence of network segmentation)
   kubectl get networkpolicies -A -o json > "${OUTPUT_DIR}/08-network-policies.json"

   # 9. Istio mTLS Status (evidence of encryption in transit)
   kubectl get peerauthentication -A -o json > "${OUTPUT_DIR}/09-istio-mtls.json"

   # 10. Harbor Vulnerability Summary (top images with CVE counts)
   # Query Harbor API for vulnerability summaries
   curl -s "https://harbor.apps.sre.example.com/api/v2.0/projects" \
     -u "admin:Harbor12345" | jq '.' > "${OUTPUT_DIR}/10-harbor-projects.json"

   # 11. Active PolicyExceptions (approved waivers)
   kubectl get policyexceptions -A -o json > "${OUTPUT_DIR}/11-policy-exceptions.json"

   # 12. OpenBao Seal Status (evidence of secrets management)
   kubectl exec -n openbao openbao-0 -- vault status -format=json 2>/dev/null \
     > "${OUTPUT_DIR}/12-openbao-status.json" || echo '{"error":"unable to query"}' > "${OUTPUT_DIR}/12-openbao-status.json"

   # 13. Velero Backup Status (evidence of backup/DR)
   velero backup get -o json 2>/dev/null > "${OUTPUT_DIR}/13-velero-backups.json" || true

   # 14. POA&M (if exists)
   cp compliance/poam/findings.yaml "${OUTPUT_DIR}/14-poam.yaml" 2>/dev/null || true

   # 15. NIST Control Mapping
   cp compliance/nist-800-53-mappings/control-mapping.json "${OUTPUT_DIR}/15-control-mapping.json"

   # 16. Package Metadata
   cat > "${OUTPUT_DIR}/00-package-metadata.json" <<METADATA
   {
     "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
     "generated_by": "$(whoami)",
     "platform_version": "$(git describe --tags --always 2>/dev/null || echo 'unknown')",
     "cluster": "$(kubectl config current-context 2>/dev/null || echo 'unknown')",
     "sha256": "will be computed after packaging"
   }
   METADATA

   # Create ZIP
   cd "${OUTPUT_DIR}/.."
   ZIPNAME="ato-evidence-$(date +%Y%m%d-%H%M).zip"
   zip -r "${ZIPNAME}" "$(basename ${OUTPUT_DIR})"
   sha256sum "${ZIPNAME}" >> "${OUTPUT_DIR}/00-package-metadata.json"

   echo "=== Package generated: ${ZIPNAME} ==="
   echo "=== Contains $(ls ${OUTPUT_DIR}/ | wc -l) evidence artifacts ==="
   ```

2. Add a button to the SRE dashboard Compliance tab: "Generate ATO Package" that:
   - Calls `POST /api/compliance/generate-package`
   - Shows progress as each artifact is collected
   - Returns a downloadable ZIP

3. Add to `Taskfile.yml` as `task ato-package`.

**Acceptance Criteria:**
- Script generates 16+ evidence artifacts in a single ZIP
- Package includes timestamp and integrity hash
- Dashboard has a button to trigger generation and download
- All artifacts are machine-readable JSON (not screenshots)

---

### Task 2.2: Per-Control Evidence Viewer

**Problem:** An assessor reviewing control AC-2 needs to see the Keycloak user list, group memberships, and login audit trail. Currently they must manually navigate to Keycloak, Grafana, and kubectl. There's no "show me all evidence for this control" view.

**Where:** `apps/dashboard/client/src/components/compliance/ComplianceTab.tsx` and `apps/dashboard/server.js`

**Steps:**
1. When an assessor clicks on a control in the Compliance tab, open an evidence panel showing:

   **For AC-2 (Account Management):**
   - Keycloak user count + list of users (from Keycloak Admin API)
   - Group memberships summary
   - Last 20 login events (from Keycloak event log)
   - Deep link to Keycloak admin console

   **For AU-2 (Audit Events):**
   - Sample of last 50 audit log entries (from Loki)
   - Audit log volume chart (last 7 days)
   - Deep link to Grafana audit log dashboard

   **For RA-5 (Vulnerability Scanning):**
   - Total images scanned in Harbor
   - CVE summary by severity (Critical/High/Medium/Low)
   - Top 5 most vulnerable images
   - Deep link to Harbor vulnerability page

   **For SC-8 (Transmission Confidentiality):**
   - Istio mTLS mode (STRICT/PERMISSIVE) per namespace
   - Percentage of traffic encrypted (from Istio metrics)
   - Deep link to Istio mesh dashboard

2. Create server endpoint: `GET /api/compliance/evidence/:controlId` that collects the relevant evidence based on a control-to-evidence mapping.

3. The evidence mapping should be data-driven (JSON config), not hardcoded per control. Map controls to evidence sources:
   ```json
   {
     "AC-2": {
       "sources": [
         { "type": "keycloak_users", "label": "User Accounts" },
         { "type": "keycloak_groups", "label": "Group Memberships" },
         { "type": "keycloak_events", "label": "Login Events", "filter": "LOGIN" }
       ]
     },
     "RA-5": {
       "sources": [
         { "type": "harbor_scan_summary", "label": "Vulnerability Scans" },
         { "type": "kyverno_reports", "label": "Policy Compliance", "filter": "image" }
       ]
     }
   }
   ```

**Acceptance Criteria:**
- Click any control to see its live evidence in a side panel
- Evidence is fetched from the actual source (Keycloak, Harbor, Loki, Prometheus)
- Assessors can review evidence without leaving the dashboard
- Deep links to source tools for deeper investigation

---

### Task 2.3: SSP Narrative Auto-Generation

**Problem:** `compliance/oscal/ssp.json` contains structured control implementations, but assessors want narrative text — "How does the system implement AC-2?" — not JSON. Writing these narratives is tedious and error-prone.

**Where:** Create `scripts/generate-ssp-narrative.sh` or add to the RPOC portal.

**Steps:**
1. For each NIST control, generate a prose narrative from the structured data:

   Input (from control-mapping.json):
   ```json
   {
     "id": "AC-2",
     "title": "Account Management",
     "components": ["keycloak", "kubernetes-rbac"],
     "implementation": "Centralized via Keycloak SSO with OIDC. Group-based RBAC..."
   }
   ```

   Output (SSP narrative):
   ```
   AC-2 — Account Management

   The SRE Platform implements account management through Keycloak, a centralized
   identity provider deployed at https://keycloak.apps.sre.example.com. All user
   accounts are managed in the SRE realm with OIDC integration to the Kubernetes
   API server. Group-based role mappings enforce least-privilege access:
   - sre-admins: Full platform access
   - <team>-developers: Namespace-scoped create/update/delete
   - <team>-viewers: Namespace-scoped read-only

   Evidence:
   - User management: Keycloak Admin Console → SRE Realm → Users
   - Group configuration: Keycloak Admin Console → SRE Realm → Groups
   - RBAC bindings: apps/tenants/_base/rbac.yaml
   - Audit trail: Grafana → Loki → {job="keycloak"} | json | eventType="LOGIN"

   Last verified: [timestamp from compliance-report.sh]
   Status: Implemented
   ```

2. Generate narratives for all 48 controls and output as:
   - Markdown file (`compliance/ssp-narratives.md`) for human review
   - JSON file for eMASS import
   - Section in the RPOC portal SSP page

3. Auto-fill the RPOC portal's SSP editor (`ssp.html`) with these narratives.

**Acceptance Criteria:**
- Prose narrative generated for all 48 controls
- Includes evidence paths and verification timestamps
- Formatted for eMASS import
- Available in the RPOC portal SSP page

---

### Task 2.4: OSCAL-to-eMASS Export Formatter

**Problem:** eMASS expects specific field formats for control import. The OSCAL SSP uses OSCAL schema. There's no converter between them.

**Where:** Create `scripts/oscal-to-emass.sh` or a Node.js script in the RPOC portal server.

**Steps:**
1. Parse the OSCAL SSP JSON (`compliance/oscal/ssp.json` or live-generated).
2. For each control implementation, output eMASS-compatible format:
   ```csv
   Control Number,Control Title,Implementation Status,Responsible Entities,Implementation Description,Assessment Procedures
   AC-2,"Account Management","Implemented","Platform Team","Keycloak SSO with OIDC...","Verify user list in Keycloak Admin Console"
   ```

3. Support two output formats:
   - CSV (for eMASS bulk import)
   - JSON (for eMASS API, if available)

4. Add a "Download eMASS Import File" button to the RPOC portal's eMASS guide page.

**Acceptance Criteria:**
- Script converts OSCAL SSP to eMASS-importable CSV
- All 48 controls included with implementation descriptions
- Downloadable from the RPOC portal
- Format validated against eMASS import requirements

---

## Phase 3: Continuous Monitoring Intelligence (cATO)

### Task 3.1: Compliance Drift Detection

**Problem:** GitOps ensures cluster state matches Git, but someone could `kubectl apply` a change that bypasses GitOps. There's no detection of compliance-relevant drift — a NetworkPolicy deleted, an mTLS policy changed to PERMISSIVE, a Kyverno policy switched to Audit.

**Where:** Create `platform/core/monitoring/compliance-drift-cronjob.yaml` and alerting rules.

**Steps:**
1. Create a CronJob that runs every hour and checks for drift in compliance-critical resources:
   ```bash
   # Check mTLS is still STRICT
   MTLS_MODE=$(kubectl get peerauthentication -n istio-system default -o jsonpath='{.spec.mtls.mode}')
   [ "$MTLS_MODE" != "STRICT" ] && echo "DRIFT: mTLS is $MTLS_MODE, expected STRICT"

   # Check all Kyverno policies are still Enforce (for the ones that should be)
   kubectl get clusterpolicies -o json | jq -r '.items[] | select(.spec.validationFailureAction != "Enforce") | .metadata.name' | while read p; do
     echo "DRIFT: Policy $p is not in Enforce mode"
   done

   # Check no default-deny NetworkPolicies were deleted
   for NS in $(kubectl get ns -l sre.io/team -o jsonpath='{.items[*].metadata.name}'); do
     NP_COUNT=$(kubectl get networkpolicies -n $NS --no-headers 2>/dev/null | wc -l)
     [ "$NP_COUNT" -lt 1 ] && echo "DRIFT: Namespace $NS has no NetworkPolicies"
   done

   # Check no unauthorized ClusterRoleBindings to cluster-admin
   kubectl get clusterrolebindings -o json | jq -r '.items[] | select(.roleRef.name == "cluster-admin") | select(.metadata.annotations["sre.io/approved"] != "true") | .metadata.name' | while read crb; do
     echo "DRIFT: Unapproved cluster-admin binding: $crb"
   done
   ```

2. Output drift findings as structured JSON to stdout (collected by Alloy → Loki).

3. Create Prometheus metrics from drift check results:
   ```
   sre_compliance_drift_total{type="mtls|policy|networkpolicy|rbac"} = count of drifts
   ```

4. Add PrometheusRule alert:
   ```yaml
   - alert: ComplianceDriftDetected
     expr: sre_compliance_drift_total > 0
     for: 5m
     labels:
       severity: critical
     annotations:
       summary: "Compliance drift detected: {{ $labels.type }}"
   ```

**Acceptance Criteria:**
- Hourly drift detection for mTLS, Kyverno enforcement, NetworkPolicies, RBAC
- Drift findings logged to Loki
- Prometheus alert fires on any drift
- False positive rate is zero on a healthy cluster

---

### Task 3.2: Automated STIG Scanning on Schedule

**Problem:** `scripts/quarterly-stig-scan.sh` exists but isn't scheduled. STIG compliance is only verified when someone manually runs it.

**Where:** `platform/core/monitoring/` — new CronJob

**Steps:**
1. Create a CronJob that runs the quarterly STIG scan weekly (more frequent than required, to catch regressions early):
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: stig-scan-weekly
     namespace: monitoring
   spec:
     schedule: "0 3 * * 0"  # 3am every Sunday
   ```

2. Store results in a PersistentVolumeClaim at `/data/stig-scans/YYYY-MM-DD.json`.

3. Create server endpoint: `GET /api/compliance/stig/results?date=latest` that reads the stored scan results.

4. Add a "STIG Compliance" section to the Compliance tab:
   - Last scan date and overall pass rate
   - Breakdown by category (Kubernetes, OS, Istio, Images)
   - Trend chart: pass rate over last 12 weeks
   - Click any finding to see details

5. Create PrometheusRule alert:
   ```yaml
   - alert: STIGComplianceRegression
     expr: sre_stig_pass_rate < 0.95
     for: 1h
     labels:
       severity: warning
     annotations:
       summary: "STIG compliance dropped to {{ $value | humanizePercentage }}"
   ```

**Acceptance Criteria:**
- Weekly STIG scans run automatically
- Results stored for historical comparison
- Dashboard shows STIG compliance trend
- Alert fires if compliance drops below 95%

---

### Task 3.3: SBOM Lifecycle Management

**Problem:** SBOMs are generated during CI (Syft, SPDX + CycloneDX) and stored in Harbor as OCI artifacts. But there's no UI to query them — "which apps use log4j?" requires manually checking each image's SBOM. No CVE-to-SBOM correlation.

**Where:** `apps/dashboard/server.js` + new UI section.

**Steps:**
1. Create server endpoints:
   ```
   GET /api/compliance/sboms              — List all images with SBOM status
   GET /api/compliance/sboms/:image/packages — Packages in a specific image's SBOM
   GET /api/compliance/sboms/search?package=log4j — Find all images containing a package
   GET /api/compliance/sboms/cve/:cveId   — Find all images affected by a specific CVE
   ```

2. The `/sboms` endpoint queries Harbor API for images with SBOM attestations.

3. The `/search` endpoint searches SBOM contents across all images (may need to cache SBOMs locally or use Harbor's built-in SBOM query if supported).

4. The `/cve/:cveId` endpoint correlates Trivy CVE data with SBOM package lists to answer "which deployed apps are affected by CVE-2024-XXXX?"

5. Add a "Supply Chain" section to the Security tab:
   - "SBOM Coverage: 85% of deployed images have SBOMs"
   - Search bar: "Search packages across all images" (e.g., "log4j", "openssl")
   - CVE impact search: "Enter CVE ID to find affected apps"
   - Results table: image, package name, version, affected CVEs

**Acceptance Criteria:**
- Can search all deployed SBOMs by package name
- Can find all images affected by a specific CVE
- SBOM coverage percentage shown
- Supports SPDX and CycloneDX formats

---

### Task 3.4: Compliance Trend Dashboard in Grafana

**Problem:** No historical view of compliance health. If the score was 98% last month and dropped to 90% this month, nobody sees the trend. The compliance report script runs but doesn't persist results over time.

**Where:** `platform/core/monitoring/dashboards/` — new Grafana dashboard. Plus a metrics exporter.

**Steps:**
1. Create a lightweight compliance metrics exporter (CronJob or sidecar) that runs `compliance-report.sh --json` every hour and exports Prometheus metrics:
   ```
   sre_compliance_control_status{control="AC-2", family="AC", status="pass"} 1
   sre_compliance_control_status{control="SC-8", family="SC", status="pass"} 1
   sre_compliance_score_percent 94.2
   sre_compliance_controls_total 48
   sre_compliance_controls_passing 46
   sre_compliance_controls_partial 2
   sre_compliance_controls_failing 0
   ```

2. Create Grafana dashboard `compliance-trend.json`:
   - UID: `sre-compliance-trend`
   - Panels:
     - Overall score gauge (current)
     - Score over time (line chart, last 90 days)
     - Controls by status over time (stacked area: passing, partial, failing)
     - Per-family compliance (bar chart: AC, AU, CA, CM, etc.)
     - Worst-performing controls (table, sorted by most time in non-passing state)
     - Drift events timeline (from Task 3.1 data)

3. Provision via ConfigMap with `grafana_dashboard: "1"` label.

**Acceptance Criteria:**
- Prometheus metrics for compliance score and per-control status
- Grafana dashboard shows 90-day compliance trend
- Per-family breakdown visible
- Dashboard provisioned via ConfigMap (GitOps managed)

---

### Task 3.5: Finding Lifecycle Tracker with SLA

**Problem:** When a CVE is found, there's no SLA on remediation. A critical CVE could sit unfixed indefinitely. There's no tracking of time-to-remediate or aging analysis.

**Where:** `apps/dashboard/server.js` + Compliance tab enhancement.

**Steps:**
1. Define remediation SLAs by severity:
   | Severity | SLA (days) |
   |----------|-----------|
   | Critical | 7 |
   | High | 30 |
   | Medium | 90 |
   | Low | 180 |

2. Track finding lifecycle in the pipeline database:
   ```sql
   CREATE TABLE finding_lifecycle (
     id TEXT PRIMARY KEY,
     source TEXT,           -- 'trivy', 'kyverno', 'neuvector', 'semgrep'
     severity TEXT,
     title TEXT,
     affected_resource TEXT,
     nist_controls TEXT[],
     discovered_at TIMESTAMP,
     sla_deadline TIMESTAMP,  -- discovered_at + SLA by severity
     status TEXT,             -- 'open', 'in_progress', 'mitigated', 'accepted_risk', 'false_positive'
     mitigated_at TIMESTAMP,
     mitigated_by TEXT,
     notes TEXT
   );
   ```

3. Ingest findings from:
   - DSOP pipeline gate results (on pipeline completion)
   - Kyverno PolicyReports (periodic scan)
   - Harbor Trivy scans (on new image push)
   - Weekly STIG scan results

4. Add a "Finding Aging" dashboard panel:
   - Histogram: findings by age bucket (0-7d, 7-30d, 30-90d, >90d)
   - Table: overdue findings (past SLA deadline)
   - Metrics: mean time to remediate (MTTR) by severity

5. Alert when findings breach SLA:
   ```yaml
   - alert: FindingSLABreach
     expr: sre_finding_sla_breach_total > 0
     labels:
       severity: warning
     annotations:
       summary: "{{ $value }} security findings have breached their remediation SLA"
   ```

**Acceptance Criteria:**
- Findings tracked with discovery date, SLA deadline, and status
- Aging analysis visible in dashboard
- Alert fires when SLA is breached
- MTTR metric calculated and trended

---

## Phase 4: RAISE 2.0 Automation

### Task 4.1: Auto-Update RAISE Tracker from Live Platform State

**Problem:** The RAISE 2.0 tracker (`rpoc-ato-portal/raise-tracker.html`) has 51 requirements tracked manually. Many of these can be automatically verified from the running platform.

**Where:** `rpoc-ato-portal/raise-tracker.html` + SRE compliance API.

**Steps:**
1. Map RAISE requirements to verifiable platform checks:

   **RPOC Requirements (auto-verifiable):**
   - RPOC-1 (Hardened OS): Check RKE2 nodes running Rocky Linux 9 with FIPS mode
   - RPOC-2 (CIS Benchmark): Check kube-bench results from STIG scan
   - RPOC-3 (mTLS): Check Istio PeerAuthentication STRICT mode
   - RPOC-4 (Runtime Security): Check NeuVector deployment health
   - RPOC-5 (Image Scanning): Check Harbor Trivy scanning enabled
   - RPOC-6 (Policy Enforcement): Check Kyverno policies in Enforce mode
   - RPOC-7 (Secrets Management): Check OpenBao health
   - RPOC-8 (Audit Logging): Check Loki ingestion rate > 0

   **Gate Requirements (auto-verifiable):**
   - GATE-1 through GATE-8: Check pipeline pass rates from DSOP statistics

2. Create server endpoint: `GET /api/compliance/raise/status` that returns per-requirement verification.

3. Update the RAISE tracker page to show:
   - Green checkmark (auto-verified from live data)
   - Yellow clock (manual verification needed)
   - Red X (check failed)
   - "Last verified: 2 minutes ago" timestamp

**Acceptance Criteria:**
- 15+ RAISE requirements auto-verified from live cluster
- Tracker shows real-time status (not manual checkmarks)
- Manual requirements clearly distinguished from automated
- Falls back to manual mode if API unreachable

---

### Task 4.2: Quarterly Review Auto-Generation (QREV)

**Problem:** RAISE 2.0 requires quarterly reviews (QREV 1-7). Templates exist in `rpoc-ato-portal/compliance/raise/quarterly-review/` but they must be filled in manually each quarter.

**Where:** Create `scripts/generate-qrev.sh` and/or enhance the RPOC portal.

**Steps:**
1. Create a script that auto-generates the 7 QREV documents from live data:

   **QREV-1 (Security Plan):** Pull from live SSP + control status
   **QREV-2 (Security Assessment Plan):** Pull from STIG scan schedule + policy status
   **QREV-3 (Privacy Impact Assessment):** Template (mostly static, but auto-fill system name/date)
   **QREV-4 (POA&M):** Pull from finding lifecycle tracker
   **QREV-5 (Application Report):** Pull from deployed apps list + pipeline statistics
   **QREV-6 (Vulnerability Report):** Pull from Harbor Trivy + STIG scan + NeuVector
   **QREV-7 (Deployment Artifacts):** Pull from Flux HelmRelease versions + Git history

2. Output as Markdown (for review/edit) and PDF (for submission).

3. Add a "Generate Quarterly Review" button to the RPOC portal with date range selector.

4. Store generated QREVs in `compliance/raise/quarterly-review/history/YYYY-QN/`.

**Acceptance Criteria:**
- Script generates all 7 QREV documents from live data
- Auto-fills dates, app counts, vulnerability stats, control status
- Output as Markdown + PDF
- Historical QREVs preserved for audit trail

---

### Task 4.3: RAISE Gate Auto-Certification

**Problem:** The CI/CD tools certification (`cicd-certification.html`) is a static form. It should auto-populate from actual pipeline statistics — gate pass rates, tool versions, scan coverage.

**Where:** `rpoc-ato-portal/cicd-certification.html`

**Steps:**
1. Pull real pipeline data from `GET /api/compliance/pipeline/summary`:
   - Total pipeline runs in last 90 days
   - Per-gate pass rate
   - Tool versions (Semgrep, Gitleaks, Trivy, Syft, ZAP, Cosign)
   - Average pipeline duration
   - Failure reasons breakdown

2. Auto-fill the certification form fields:
   - "SAST Tool: Semgrep (pass rate: 97.3%)"
   - "Container Scanning: Trivy (pass rate: 94.1%, 0 unmitigated criticals)"
   - "Image Signing: Cosign (100% of deployed images signed)"
   - "Total deployments processed: 142"

3. Add a "Generate Certification Memo" button that creates a PDF with the Technical Authority submission format, pre-filled with statistics and ready for signature.

**Acceptance Criteria:**
- Certification form auto-populated from real pipeline stats
- Gate pass rates and tool versions are current
- PDF memo ready for TA signature
- Statistics cover the last 90 days

---

## Phase 5: ISSM/ISSO Daily Workflow

### Task 5.1: ISSM Daily Digest

**Problem:** The ISSM has to manually check multiple dashboards (Security tab, Compliance tab, pipeline queue) to understand their daily workload. No single "here's what needs your attention today" view.

**Where:** `apps/dashboard/server.js` + new endpoint + email/Slack.

**Steps:**
1. Create a daily digest that runs at 7am and summarizes:
   ```
   === ISSM Daily Digest — March 25, 2026 ===

   PENDING REVIEWS: 2 apps awaiting your review
     - team-alpha/payment-api (3 high findings, waiting 6h)
     - team-beta/frontend (clean, waiting 2h)

   COMPLIANCE SCORE: 94% (stable, no change from yesterday)

   OPEN FINDINGS: 12 total (0 critical, 3 high, 5 medium, 4 low)
     - 1 finding approaching SLA deadline (CVE-2024-1234, due in 3 days)

   POLICY EXCEPTIONS: 2 active, 0 expiring this week

   STIG STATUS: Last scan Mar 22 — 96% pass rate

   CERTIFICATES: All healthy (next expiry: Apr 15, 21 days away)

   RECENT DEPLOYMENTS (24h): 4 apps deployed, all passing security gates
   ```

2. Deliver via:
   - Slack message (if webhook configured)
   - Email (if SMTP configured)
   - Dashboard landing page for ISSM role (instead of Overview tab, show the digest)

3. Create server endpoint: `GET /api/issm/digest` for the dashboard.

**Acceptance Criteria:**
- Daily digest covers reviews, compliance, findings, exceptions, STIGs, certs, deployments
- Delivered via Slack/email at configurable time
- Also viewable in dashboard for ISSM users
- Actionable items have direct links

---

### Task 5.2: Risk Acceptance Workflow

**Problem:** When a finding can't be fixed (vendor limitation, operational requirement), the ISSM needs to formally accept the risk. Currently this is ad-hoc — no structured workflow, no expiry, no periodic re-evaluation.

**Where:** `apps/dashboard/server.js` + Security tab enhancement.

**Steps:**
1. Add a "Risk Acceptance" workflow to the finding lifecycle (Task 3.5):
   - ISSM clicks "Accept Risk" on a finding
   - Form collects: justification, compensating controls, expiry date (max 1 year), approver
   - Creates a formal risk acceptance record linked to the finding

2. Risk acceptance record:
   ```json
   {
     "finding_id": "CVE-2024-1234",
     "accepted_by": "issm-jane",
     "accepted_at": "2026-03-25T10:00:00Z",
     "justification": "Vendor patch not available until Q3. Mitigated by...",
     "compensating_controls": ["NeuVector runtime monitoring", "NetworkPolicy restricts egress"],
     "expiry": "2026-09-25",
     "review_frequency": "quarterly"
   }
   ```

3. Track risk acceptances in the POA&M and compliance reports.

4. Alert 30 days before risk acceptance expiry.

5. Add risk acceptance count to the compliance score calculation (accepted risks reduce the score slightly but don't count as failures).

**Acceptance Criteria:**
- Structured risk acceptance workflow with justification and expiry
- Risk acceptances tracked in finding lifecycle
- Alert before expiry
- Included in compliance reports and ATO package

---

### Task 5.3: Waiver and Exception Dashboard

**Problem:** Kyverno PolicyExceptions, risk acceptances, and STIG deviations are tracked in different places. There's no unified view of "all the things we've explicitly allowed to be non-compliant."

**Where:** `apps/dashboard/client/src/` — new section in Compliance tab.

**Steps:**
1. Create server endpoint: `GET /api/compliance/waivers` that aggregates:
   - Kyverno PolicyExceptions (from cluster)
   - Risk acceptances (from finding lifecycle DB)
   - STIG deviations (from STIG checklist "not_applicable" items with justifications)
   - CMMC partial implementations (from self-assessment)

2. Show a unified "Waivers & Exceptions" panel in the Compliance tab:
   - Total active waivers: N
   - By type: PolicyException (3), Risk Acceptance (2), STIG Deviation (4)
   - Table: type, scope, justification, expiry date, approved by, status
   - Expiring within 30 days highlighted in yellow
   - Expired highlighted in red

3. Include waiver count in the compliance score header.

**Acceptance Criteria:**
- Unified view of all exceptions/waivers across all frameworks
- Expiry tracking with color coding
- Included in compliance score and ATO package
- Assessors can see all approved deviations in one place

---

## Phase 6: Assessor Self-Service

### Task 6.1: Assessor Read-Only Dashboard Mode

**Problem:** External assessors (SCA, C3PAO) need access to compliance evidence but shouldn't have admin capabilities. There's no assessor role — they either get full admin or nothing.

**Where:** Keycloak group configuration + dashboard RBAC.

**Steps:**
1. Create a `compliance-assessors` group in Keycloak.
2. In the dashboard server, add RBAC for the assessor role:
   - CAN: View Compliance tab, Security tab, all evidence endpoints, download ATO package, view STIG results, view findings, view waivers
   - CANNOT: Deploy apps, manage users, delete anything, access Admin tab, modify findings/waivers

3. Create a dedicated assessor landing page showing:
   - Compliance score with trend
   - Quick links: SSP, POA&M, STIG results, Evidence package download, Control-by-control viewer
   - "Assessment in progress" banner (configurable by ISSM)

4. Add an "Invite Assessor" button in the Admin tab that:
   - Creates a Keycloak account in the `compliance-assessors` group
   - Generates a temporary password
   - Sends an email with login instructions

**Acceptance Criteria:**
- Assessor role can view all compliance data but not modify anything
- Dedicated landing page with quick links to evidence
- ISSM can invite assessors from the Admin tab
- Assessor session is time-limited (configurable, default 30 days)

---

### Task 6.2: Assessment Worksheet Integration

**Problem:** Assessors use worksheets (often Excel) to track their evaluation of each control. There's no way to import/export assessment progress between the portal and their worksheets.

**Where:** RPOC portal + dashboard API.

**Steps:**
1. Add an "Assessment Worksheet" export to the Compliance tab:
   - Export all controls as CSV/Excel with columns: Control ID, Title, Implementation Status, Platform Evidence, Assessor Notes (blank), Assessment Result (blank)
   - Pre-fills with platform data, leaves assessor columns blank for their input

2. Add an "Import Assessment Results" feature:
   - Upload the filled-in worksheet
   - Parse assessor notes and results
   - Display assessor findings alongside platform evidence
   - Highlight disagreements (platform says "implemented" but assessor says "partial")

3. Store assessment results for historical tracking.

**Acceptance Criteria:**
- Export assessment worksheet with pre-filled platform evidence
- Import assessor-completed worksheet
- Disagreements between platform and assessor are highlighted
- Assessment results stored for audit trail

---

### Task 6.3: SAR Auto-Population from Scan Results

**Problem:** The Security Assessment Report (SAR) is marked as "DRAFT — SCA produces this" in the portal. But the platform can pre-populate many SAR sections with real data, reducing assessor workload.

**Where:** `rpoc-ato-portal/sar.html` + SRE compliance API.

**Steps:**
1. Auto-populate SAR sections from live data:
   - **Executive Summary:** Pull compliance score, total controls, pass/fail counts, finding summary
   - **System Description:** Pull from SSP (Task 2.3 narratives)
   - **Assessment Scope:** Auto-list all platform components with versions
   - **Vulnerability Assessment:** Pull from Harbor Trivy + STIG scan + pipeline findings
   - **Compliance Assessment:** Pull per-control status from compliance API
   - **Findings:** Pull from finding lifecycle tracker with severity, status, remediation plan

2. Leave assessor-specific sections blank (clearly marked):
   - Assessor methodology
   - Independent testing results
   - Risk determination
   - Recommendation to AO

3. Add "Pre-fill from SRE Platform" button in the SAR page.

**Acceptance Criteria:**
- SAR sections auto-populated with real scan data and control status
- Assessor-specific sections clearly marked as "Assessor fills this"
- Vulnerability data comes from actual scans (not templates)
- Pre-filled SAR reduces assessor effort by 60%+

---

## Phase 7: Operational Compliance Automation

These tasks close the remaining gaps between "we have documentation" and "the system proves itself compliant automatically."

---

### Task 7.1: Automated Control Testing (Prove Controls Work, Don't Just Assert They Exist)

**Problem:** The compliance report checks that components are *deployed* (Kyverno is running, Istio is running), but doesn't test that controls actually *work*. An assessor will ask "prove that a privileged container gets blocked" — and right now that requires a live demo.

**Where:** Create `scripts/control-validation-tests.sh`

**Steps:**
1. Create a test script that actually exercises each control by attempting violations and verifying they're blocked:

   ```bash
   # AC-6: Least Privilege — try to create a privileged pod, verify Kyverno blocks it
   test_ac6() {
     RESULT=$(kubectl run test-priv --image=busybox --restart=Never \
       --overrides='{"spec":{"containers":[{"name":"test","image":"busybox","securityContext":{"privileged":true}}]}}' \
       -n default 2>&1)
     echo "$RESULT" | grep -q "blocked" && PASS "AC-6" "Privileged pod blocked by Kyverno" || FAIL "AC-6" "Privileged pod was NOT blocked"
   }

   # SC-8: Encryption in Transit — verify mTLS is STRICT
   test_sc8() {
     MODE=$(kubectl get peerauthentication -n istio-system default -o jsonpath='{.spec.mtls.mode}' 2>/dev/null)
     [ "$MODE" = "STRICT" ] && PASS "SC-8" "mTLS mode is STRICT" || FAIL "SC-8" "mTLS mode is $MODE"
   }

   # CM-11: User-Installed Software — try to deploy from Docker Hub, verify Kyverno blocks it
   test_cm11() {
     RESULT=$(kubectl run test-dockerhub --image=nginx:latest -n default 2>&1)
     echo "$RESULT" | grep -q "blocked\|denied" && PASS "CM-11" "Docker Hub image blocked" || FAIL "CM-11" "Docker Hub image was NOT blocked"
   }

   # SI-7: Software Integrity — try to deploy unsigned image, verify Kyverno blocks it
   test_si7() {
     RESULT=$(kubectl run test-unsigned --image=harbor.apps.sre.example.com/test/unsigned:v1 -n default 2>&1)
     echo "$RESULT" | grep -q "blocked\|signature" && PASS "SI-7" "Unsigned image blocked" || FAIL "SI-7" "Unsigned image was NOT blocked"
   }

   # AU-2: Audit Events — verify audit logs are flowing to Loki
   test_au2() {
     # Create an event, then check Loki for it
     kubectl create namespace test-audit-$$  2>/dev/null
     sleep 5
     LOG_COUNT=$(curl -s "http://loki.logging.svc:3100/loki/api/v1/query?query={job=\"audit\"}" | jq '.data.result | length')
     kubectl delete namespace test-audit-$$ 2>/dev/null
     [ "$LOG_COUNT" -gt 0 ] && PASS "AU-2" "Audit logs flowing to Loki ($LOG_COUNT streams)" || FAIL "AU-2" "No audit logs in Loki"
   }
   ```

2. Test 15+ controls with actual violation attempts (all tests clean up after themselves).

3. Output as JSON for the evidence package, with test name, control ID, result, evidence, and timestamp.

4. Add to `Taskfile.yml` as `task control-tests`. Include in the ATO evidence package (Task 2.1).

5. Schedule as a weekly CronJob alongside the STIG scan.

**Acceptance Criteria:**
- 15+ controls tested by actually attempting violations
- Each test cleans up after itself (no residue)
- JSON output suitable for evidence packages
- All tests pass on a healthy, properly-configured cluster
- Scheduled weekly alongside STIG scans

---

### Task 7.2: Data Flow Diagram Auto-Generation from Istio Traffic

**Problem:** The authorization boundary doc (`rpoc-ato-portal/compliance/raise/authorization-boundary.md`) has a manually-created data flow diagram. Assessors want current, accurate data flows — not a diagram drawn months ago. Istio has all the traffic data to generate this automatically.

**Where:** Create `scripts/generate-data-flow.sh` or add an API endpoint.

**Steps:**
1. Query Prometheus for Istio traffic metrics to build a real data flow graph:
   ```promql
   sum(rate(istio_requests_total[24h])) by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace, destination_service)
   ```

2. Generate a Mermaid diagram from the results:
   ```mermaid
   graph LR
     subgraph istio-system
       gateway[Istio Gateway]
     end
     subgraph team-alpha
       frontend[frontend<br/>142 req/s]
       api[api-service<br/>89 req/s]
     end
     subgraph monitoring
       prometheus[Prometheus]
     end
     gateway -->|HTTPS| frontend
     frontend -->|mTLS| api
     prometheus -.->|scrape| frontend
     prometheus -.->|scrape| api
   ```

3. Also generate a machine-readable JSON format for OSCAL integration:
   ```json
   {
     "generated_at": "2026-03-25T10:00:00Z",
     "flows": [
       { "source": "istio-system/gateway", "destination": "team-alpha/frontend", "protocol": "HTTPS", "rate_rps": 142 },
       { "source": "team-alpha/frontend", "destination": "team-alpha/api", "protocol": "mTLS", "rate_rps": 89 }
     ]
   }
   ```

4. Add to the ATO evidence package as `data-flow-diagram.md` (Mermaid) and `data-flow.json`.

5. Add a "Data Flows" visualization to the dashboard (reuses the service graph from developer-readiness-plan Task 10.9, but formatted for compliance with protocol labels and traffic classifications).

**Acceptance Criteria:**
- Data flow diagram generated from actual Istio traffic (last 24h)
- Mermaid + JSON output formats
- Included in ATO evidence package
- Shows protocol (mTLS/HTTPS/TCP) and traffic rates
- Updates automatically (not a static drawing)

---

### Task 7.3: License Compliance Tracking from SBOMs

**Problem:** SBOMs list all packages in deployed images, but nobody tracks the software licenses. Government contracts and open-source policies may prohibit certain licenses (GPL in proprietary code, AGPL in SaaS, etc.). There's no license inventory.

**Where:** `apps/dashboard/server.js` + Security tab or Compliance tab.

**Steps:**
1. Create server endpoint: `GET /api/compliance/licenses` that:
   - Fetches SBOMs from Harbor for all deployed images
   - Extracts license information from SPDX packages
   - Aggregates by license type: `{ "MIT": 1423, "Apache-2.0": 892, "GPL-3.0": 12, "Unknown": 45 }`

2. Create a "License Compliance" section showing:
   - License distribution pie chart (top 10 licenses)
   - Flagged licenses table: any GPL/AGPL/proprietary/unknown licenses with the images and packages that contain them
   - Total packages vs. packages with known licenses (coverage percentage)

3. Define a license allowlist (configurable):
   ```json
   {
     "allowed": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0"],
     "review_required": ["GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0"],
     "prohibited": ["AGPL-3.0", "SSPL-1.0"]
   }
   ```

4. Alert when a prohibited license is detected in a deployed image.

**Acceptance Criteria:**
- License inventory generated from deployed SBOMs
- Flagged licenses (GPL, AGPL, unknown) highlighted
- Configurable allowlist/blocklist
- Included in ATO evidence package

---

### Task 7.4: Pentest Scheduling and Result Tracking

**Problem:** `scripts/security-pentest.sh` exists and runs 40+ checks, but there's no scheduling, no result persistence, and no tracking of remediation. Pentest results vanish after the terminal session ends.

**Where:** `platform/core/monitoring/` + `apps/dashboard/` + RPOC portal `pentest-report.html`.

**Steps:**
1. Create a CronJob that runs the pentest script monthly:
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: pentest-monthly
     namespace: monitoring
   spec:
     schedule: "0 4 15 * *"  # 4am on the 15th of each month
   ```

2. Store results in a PVC at `/data/pentest-results/YYYY-MM-DD.json`.

3. Create server endpoint: `GET /api/compliance/pentest/results?date=latest` that reads stored results.

4. Wire the RPOC portal's `pentest-report.html` to consume live data from this API (same pattern as Task 1.2):
   - Auto-populate severity breakdown (Critical/High/Medium/Low)
   - Show finding details with remediation status
   - Trend chart: findings over time (last 12 months)

5. Feed pentest findings into the finding lifecycle tracker (Task 3.5) with source=`pentest`.

**Acceptance Criteria:**
- Monthly automated pentest runs
- Results stored for historical comparison
- RPOC portal pentest page shows live data
- Findings tracked in the lifecycle tracker with SLA

---

### Task 7.5: CCB (Change Control Board) Workflow

**Problem:** The configuration management plan (`rpoc-ato-portal/compliance/raise/configuration-management-plan.md`) defines a CCB framework but has placeholder fields for meeting schedule, approval authority, and escalation. There's no actual workflow to track change requests and approvals.

**Where:** `apps/dashboard/server.js` + Admin tab or new "Changes" section.

**Steps:**
1. Create a lightweight change tracking system in the dashboard:
   - When Flux detects a new HelmRelease version change (from Git), auto-create a "change record":
     ```json
     {
       "id": "CHG-001",
       "type": "platform_upgrade",
       "component": "kyverno",
       "from_version": "3.3.6",
       "to_version": "3.3.7",
       "requested_by": "git-commit-author",
       "requested_at": "2026-03-25T10:00:00Z",
       "status": "applied",  // or "pending_review" for production
       "approved_by": null,
       "applied_at": "2026-03-25T10:15:00Z",
       "rollback_available": true
     }
     ```

2. For production changes, require CCB approval before Flux applies:
   - Add a Flux notification that pauses reconciliation and sends a Slack notification: "Change CHG-042 pending CCB approval: Kyverno 3.3.6 → 3.3.7"
   - Admin approves from dashboard, which resumes Flux reconciliation

3. Create server endpoints:
   ```
   GET  /api/compliance/changes              — List all changes with status
   GET  /api/compliance/changes/:id          — Single change detail
   POST /api/compliance/changes/:id/approve  — CCB approval
   POST /api/compliance/changes/:id/reject   — CCB rejection with reason
   ```

4. Show in the Compliance tab under a "Change Management" section:
   - Recent changes table with approval status
   - Changes pending approval (for CCB members)
   - Change velocity chart (changes per week, trend)

5. Include change log in the ATO evidence package for CM-3 (Configuration Change Control).

**Acceptance Criteria:**
- Platform changes auto-logged from Flux reconciliation events
- Production changes require CCB approval before applying
- Change history viewable in dashboard
- Change log included in ATO evidence package

---

### Task 7.6: Interconnection Security Agreement Tracker

**Problem:** The authorization boundary documents external interfaces (GitHub API, container pulls, NTP, DNS) but there are no formal Interconnection Security Agreements (ISAs) tracking these connections. Assessors ask "do you have ISAs for all external connections?"

**Where:** Create `rpoc-ato-portal/compliance/raise/interconnection-agreements/` and a dashboard section.

**Steps:**
1. Create an ISA template:
   ```markdown
   # Interconnection Security Agreement: [System Name] ↔ [External System]

   **Agreement ID:** ISA-001
   **Status:** Active / Pending / Expired
   **Effective Date:** YYYY-MM-DD
   **Expiry Date:** YYYY-MM-DD (annual renewal)

   ## Connected Systems
   | Field | SRE Platform | External System |
   |-------|-------------|-----------------|
   | System Name | SRE Platform | GitHub.com |
   | Owner | Platform Team | GitHub Inc. |
   | Security Level | Moderate (CUI) | Commercial |

   ## Connection Details
   - **Protocol:** HTTPS (TLS 1.2+)
   - **Direction:** Outbound only
   - **Ports:** 443
   - **Purpose:** GitOps source code synchronization, CI/CD webhook triggers
   - **Data transmitted:** Git repository content (no CUI), webhook payloads
   - **Authentication:** GitHub PAT (stored in OpenBao, rotated quarterly)

   ## Security Controls
   - Egress NetworkPolicy restricts to github.com IPs only
   - All traffic encrypted via TLS 1.2+
   - Credentials stored in OpenBao with rotation policy
   - Audit logging of all API calls via Flux event logs

   ## Risk Assessment
   - **Risk:** Supply chain compromise if GitHub account is compromised
   - **Mitigation:** Branch protection, signed commits, Cosign image verification
   ```

2. Create ISAs for all external connections identified in the authorization boundary:
   - ISA-001: GitHub.com (GitOps, CI/CD)
   - ISA-002: Docker Hub / ghcr.io / quay.io (image mirroring, if not air-gapped)
   - ISA-003: Let's Encrypt (certificate issuance, if used)
   - ISA-004: NTP servers (time synchronization)
   - ISA-005: DNS resolvers (name resolution)

3. Add an "Interconnections" section to the Compliance tab showing:
   - List of all ISAs with status (active/pending/expired)
   - Expiry warnings (30 days before renewal)
   - Link to each ISA document

4. Include ISAs in the ATO evidence package.

**Acceptance Criteria:**
- ISA template exists with all required fields
- 5 ISAs created for known external connections
- ISA status tracked with expiry warnings
- Included in ATO evidence package

---

### Task 7.7: Tabletop Exercise Tracker and After-Action Reports

**Problem:** The contingency plan defines quarterly tabletop exercises (4 rotating scenarios) and a monthly restore test, but there's no tracking of whether they actually happened, what was learned, or what action items resulted.

**Where:** Create `compliance/exercises/` in the RPOC portal and a dashboard section.

**Steps:**
1. Create a tracking format for completed exercises:
   ```yaml
   # compliance/raise/exercises/2026-Q1-tabletop.yaml
   exercise:
     id: TTX-2026-Q1
     type: tabletop
     scenario: "Full cluster loss and recovery"
     date: "2026-03-15"
     duration_hours: 2
     participants:
       - name: "Platform Lead"
         role: "Incident Commander"
       - name: "ISSM"
         role: "Observer/Evaluator"
     findings:
       - id: TTX-F001
         description: "DR runbook missing step for OpenBao unseal after restore"
         severity: medium
         action: "Update backup-restore.md runbook with OpenBao unseal steps"
         owner: "Platform Team"
         due_date: "2026-04-01"
         status: closed
         closed_date: "2026-03-20"
     lessons_learned:
       - "Velero restore takes 45 minutes, not the 20 assumed in contingency plan"
       - "Need to update RTO from 1h to 2h for Tier 1 services"
     rto_met: false
     rpo_met: true
     next_exercise: "2026-Q2 — GitOps repo compromise scenario"
   ```

2. Create a `scripts/exercise-report.sh` that:
   - Lists all completed exercises with dates
   - Shows overdue exercises (e.g., quarterly tabletop not done this quarter)
   - Counts open action items from exercises
   - Outputs summary for compliance reports

3. Add an "Exercises" section to the Compliance tab:
   - Exercise calendar (next scheduled, last completed)
   - Action items from exercises (open/closed)
   - RTO/RPO validation results over time

4. Include exercise history in the ATO evidence package for CP-4 (Contingency Plan Testing).

**Acceptance Criteria:**
- Exercise tracking YAML format with findings and action items
- Overdue exercise detection
- Dashboard section shows exercise history and open actions
- Included in ATO evidence package

---

### Task 7.8: Personnel Security and Training Tracker

**Problem:** NIST 800-53 AT (Awareness and Training) and PS (Personnel Security) controls require tracking who has platform access, when they completed security training, and when their access was last reviewed. None of this is tracked.

**Where:** `apps/dashboard/server.js` + Admin tab enhancement.

**Steps:**
1. Extend the user management system to track per-user:
   ```json
   {
     "username": "jane.doe",
     "groups": ["team-alpha-developers"],
     "access_granted": "2026-01-15",
     "last_access_review": "2026-03-01",
     "next_access_review_due": "2026-06-01",
     "security_training_completed": "2026-02-10",
     "security_training_due": "2027-02-10",
     "rules_of_behavior_signed": "2026-01-15",
     "clearance_level": "none",
     "status": "active"
   }
   ```

2. Store this metadata in Keycloak user attributes (Keycloak supports arbitrary attributes per user).

3. Add a "Personnel" section to the Admin tab:
   - User list with training and access review status
   - Color-coded: green (current), yellow (due within 30 days), red (overdue)
   - "Send Training Reminder" button
   - "Mark Training Complete" button (with date)
   - "Mark Access Reviewed" button (with date)
   - Bulk actions for quarterly access reviews

4. Create server endpoints:
   ```
   GET  /api/admin/users/:id/compliance    — User compliance metadata
   PATCH /api/admin/users/:id/compliance   — Update training/review dates
   GET  /api/compliance/personnel/summary  — Aggregate: X trained, Y overdue, Z unreviewed
   ```

5. Add alerts:
   - Training overdue: user hasn't completed annual training
   - Access review overdue: user access not reviewed in 90 days
   - Dormant account: user hasn't logged in for 60 days

6. Include personnel compliance summary in ATO evidence package for AT-2 (Security Awareness Training) and PS-4 (Personnel Termination).

**Acceptance Criteria:**
- Per-user training and access review dates tracked
- Overdue training/reviews highlighted in Admin tab
- Dormant account detection (60 days no login)
- Personnel summary included in ATO evidence package

---

### Task 7.9: Automated CVE Alerting for Deployed Images

**Problem:** When a new CVE is published (like Log4Shell), there's no automated way to know if any deployed images are affected. Someone must manually check Harbor scans. The SBOM search (Task 3.3) helps, but it's reactive — nobody is alerted proactively.

**Where:** `platform/core/monitoring/` + `apps/dashboard/server.js`.

**Steps:**
1. Create a daily CronJob that:
   - Lists all deployed images (from running pods across tenant namespaces)
   - Queries Harbor's Trivy scan results for each image
   - Compares against the previous day's results
   - If NEW critical or high CVEs appear (that weren't there yesterday), trigger an alert

2. Send notification:
   ```
   NEW CVE Alert: 3 new critical vulnerabilities detected

   CVE-2026-1234 (CRITICAL) — openssl 3.0.2
     Affected: team-alpha/my-app:v1.2.0, team-beta/api:v3.1.0
     Fix available: openssl 3.0.15

   CVE-2026-1235 (HIGH) — curl 8.1.0
     Affected: team-alpha/frontend:v2.0.0
     Fix available: curl 8.6.0
   ```

3. Auto-create POA&M findings (from Task 3.5) for new critical CVEs with the appropriate SLA.

4. Add a "New Vulnerabilities" alert banner on the Security tab when new CVEs are found.

5. Create Prometheus metric: `sre_new_cves_total{severity="critical|high"}` for trend tracking.

**Acceptance Criteria:**
- Daily CVE comparison detects NEW vulnerabilities (not just existing ones)
- Notification includes affected images and available fixes
- Auto-creates POA&M findings for critical CVEs
- Alert banner shown in dashboard Security tab

---

### Task 7.10: Compliance Gate in Deployment Pipeline

**Problem:** The DSOP pipeline has 8 security gates (SAST, Secrets, Build, SBOM, CVE, DAST, ISSM, Signing), but no compliance gate. A deployment can succeed even if it would degrade the compliance score — e.g., deploying to a namespace that has no NetworkPolicies, or deploying an image with an unreviewed STIG finding.

**Where:** `apps/dashboard/server.js` — deployment endpoint. `apps/dsop-wizard/`.

**Steps:**
1. Add a pre-deployment compliance check that runs before any deployment (Quick Deploy, DSOP wizard, or Helm chart deploy):

   ```javascript
   async function complianceGate(namespace, image) {
     const checks = [];

     // Check 1: Namespace has required labels
     const ns = await k8s.getNamespace(namespace);
     if (!ns.metadata.labels['sre.io/security-categorization'])
       checks.push({ severity: 'high', message: `Namespace ${namespace} missing security categorization label` });

     // Check 2: Namespace has NetworkPolicies
     const nps = await k8s.listNetworkPolicies(namespace);
     if (nps.length === 0)
       checks.push({ severity: 'critical', message: `Namespace ${namespace} has no NetworkPolicies` });

     // Check 3: Image has been scanned (Harbor Trivy)
     const scanStatus = await harbor.getImageScanStatus(image);
     if (scanStatus.severity === 'critical' && scanStatus.unmitigated > 0)
       checks.push({ severity: 'critical', message: `Image has ${scanStatus.unmitigated} unmitigated critical CVEs` });

     // Check 4: Image is signed (Cosign)
     const signed = await harbor.isImageSigned(image);
     if (!signed)
       checks.push({ severity: 'high', message: `Image is not signed with Cosign` });

     return { passed: checks.filter(c => c.severity === 'critical').length === 0, checks };
   }
   ```

2. Block deployment if any critical compliance check fails. Show warnings for high/medium but allow deployment.

3. Show the compliance gate results in the DSOP wizard (as a pre-deploy check in Step 5 or Step 6).

4. Log all compliance gate results in the audit trail.

**Acceptance Criteria:**
- Pre-deployment compliance checks run before every deployment
- Critical failures block deployment (no NetworkPolicies, unmitigated critical CVEs)
- High/medium findings shown as warnings
- Compliance gate results logged in audit trail

---

### Task 7.11: Air-Gap Compliance Package

**Problem:** In air-gapped environments (SIPR, classified networks), the RPOC portal can't reach the SRE platform API. The portal falls back to demo data, which is useless for assessors. Need a way to export a full compliance snapshot that the portal can consume offline.

**Where:** `scripts/` + RPOC portal.

**Steps:**
1. Create `scripts/export-compliance-snapshot.sh` that generates a single JSON file containing everything the portal needs:
   ```json
   {
     "generated_at": "2026-03-25T10:00:00Z",
     "platform_version": "v2.1.0",
     "controls": [ /* all control data with live health */ ],
     "findings": [ /* all findings with status */ ],
     "pipeline_stats": { /* gate pass rates, run counts */ },
     "raise_status": [ /* RPOC requirement verification */ ],
     "stig_results": { /* latest STIG scan */ },
     "component_inventory": [ /* all HelmReleases with versions */ ],
     "certificates": [ /* all certs with expiry */ ],
     "poam": [ /* open POA&M items */ ],
     "score": { "overall": 94.2, "trend": "stable" }
   }
   ```

2. The portal loads this JSON file when the API is unreachable:
   - Add a "Load Snapshot" button to the portal settings
   - User uploads the JSON file or places it at a known path
   - Portal renders all dashboards from the snapshot data
   - Shows "Data from snapshot: 2026-03-25 10:00 UTC" instead of "Live from SRE Platform"

3. Document the air-gap workflow:
   - On the connected network: run `./scripts/export-compliance-snapshot.sh > snapshot.json`
   - Transfer `snapshot.json` to the air-gapped network (via approved media)
   - On the air-gapped network: load into the portal

**Acceptance Criteria:**
- Snapshot contains all data the portal needs
- Portal can render all dashboards from a snapshot file
- Clear indicator that data is from a snapshot (not live)
- Air-gap workflow documented

---

### Task 7.12: Compliance Notification Digest for Authorizing Official (AO)

**Problem:** The Authorizing Official (the person who signs the ATO) needs periodic high-level updates — not a technical dashboard, but a brief executive summary. Currently there's nothing tailored for the AO.

**Where:** `scripts/` or `apps/dashboard/server.js`.

**Steps:**
1. Create a monthly AO summary (email/PDF):
   ```
   === SRE Platform — Monthly Compliance Summary ===
   Period: March 2026

   COMPLIANCE POSTURE: 94% (Stable — no change from February)

   KEY METRICS:
   - Controls Implemented: 46/48 (2 partial)
   - Open Findings: 8 (0 critical, 2 high, 3 medium, 3 low)
   - Findings Remediated This Month: 5
   - Mean Time to Remediate: 12 days (target: 30)
   - STIG Compliance: 96% (87/91 findings clean)
   - Active Risk Acceptances: 2 (both current, next expiry: June 2026)

   CHANGES THIS MONTH:
   - 3 platform component upgrades (Kyverno 3.3.6→3.3.7, Istio 1.22→1.23, cert-manager 1.15→1.16)
   - 12 application deployments processed (all passed security gates)
   - 1 new tenant onboarded (team-gamma)
   - 0 security incidents

   ACTION ITEMS REQUIRING AO ATTENTION:
   - None this month

   NEXT QUARTER:
   - Q2 tabletop exercise: April 15 (GitOps repo compromise scenario)
   - Annual penetration test: May 2026
   - CMMC C3PAO assessment: Scheduled June 2026
   ```

2. Generate automatically from compliance API data + finding lifecycle + change log.

3. Deliver as PDF (via RPOC portal PDF server) + email.

4. Store in `compliance/ao-summaries/YYYY-MM.pdf` for audit trail.

**Acceptance Criteria:**
- Monthly AO summary auto-generated
- Covers posture, findings, changes, and upcoming events
- PDF format suitable for executive consumption
- Stored for audit trail

---

### Task 7.13: CMMC Practice-Level Evidence Mapping

**Problem:** The CMMC self-assessment (`compliance/cmmc/self-assessment.yaml`) shows 72 implemented, 18 partial, 8 planned — but doesn't link each practice to specific, retrievable evidence. A C3PAO assessor asking "show me evidence for AC.L2-3.1.1" gets a description but not the actual artifact.

**Where:** Extend `compliance/cmmc/` and the compliance API.

**Steps:**
1. For each of the 110 CMMC practices, add an `evidence` field linking to:
   - API endpoint that returns live evidence (e.g., `/api/compliance/evidence/AC-2`)
   - File paths in the repo (e.g., `platform/core/keycloak/helmrelease.yaml`)
   - Grafana dashboard deep link (e.g., `grafana:keycloak`)
   - Screenshot or export instructions if automated evidence isn't available

2. For the 18 partially-implemented practices, add:
   - What's done vs. what's remaining
   - Remediation plan with timeline
   - POA&M reference

3. For the 8 planned practices, add:
   - Implementation plan with timeline
   - Dependencies (what must be done first)
   - POA&M reference

4. Create server endpoint: `GET /api/compliance/cmmc/practices` that returns all 110 practices with evidence links.

5. Add a "CMMC" section to the Compliance tab (or wire to the RPOC portal's existing controls tracker).

**Acceptance Criteria:**
- All 110 CMMC practices have evidence links
- Partial and planned practices have remediation timelines
- C3PAO assessor can retrieve evidence per practice from the dashboard
- Practices map to NIST 800-171 and 800-53 references

---

### Task 7.14: Automated Rules of Behavior Acknowledgment

**Problem:** NIST PL-4 (Rules of Behavior) requires users to acknowledge acceptable use policies before getting access. The rules of behavior document exists (`rpoc-ato-portal/compliance/raise/rules-of-behavior.md`) but there's no tracking of who has signed it.

**Where:** `apps/dashboard/` — login flow or first-access check.

**Steps:**
1. On first login to the SRE dashboard (or annually), show a modal:
   ```
   === Rules of Behavior ===

   Before accessing the SRE Platform, you must acknowledge the following:
   [Display rules-of-behavior.md content]

   ☐ I have read and agree to the Rules of Behavior
   ☐ I understand that my actions are logged and auditable
   ☐ I will report any security incidents immediately

   [Accept] [Decline — logs out]
   ```

2. Store acknowledgment in Keycloak user attributes:
   ```json
   {
     "rob_accepted": "true",
     "rob_accepted_date": "2026-03-25",
     "rob_version": "1.0"
   }
   ```

3. If the rules document is updated (version changes), require re-acknowledgment.

4. Create server endpoint: `GET /api/compliance/rob/status` — returns count of users who have/haven't signed.

5. Add to the personnel compliance view (Task 7.8): "Rules of Behavior: 45/48 users signed"

6. Block dashboard access until RoB is signed (redirect to the modal on every page load if not signed).

**Acceptance Criteria:**
- First-login modal requires RoB acknowledgment before access
- Acknowledgment stored per user with date and version
- Re-acknowledgment required when document version changes
- Compliance report shows signed vs. unsigned count

---

### Task 7.15: Continuous ATO (cATO) Evidence Timeline

**Problem:** For continuous ATO, the AO needs to see that compliance evidence is collected continuously — not just at assessment time. There's no single view showing "evidence was collected for control X on these dates" over time.

**Where:** `apps/dashboard/client/src/components/compliance/` + Grafana dashboard.

**Steps:**
1. Create a server endpoint: `GET /api/compliance/evidence-timeline` that returns per-control:
   ```json
   {
     "AC-2": {
       "evidence_sources": ["keycloak_users", "keycloak_events"],
       "collection_history": [
         { "date": "2026-03-25", "status": "collected", "source": "daily-cron" },
         { "date": "2026-03-24", "status": "collected", "source": "daily-cron" },
         { "date": "2026-03-23", "status": "missed", "reason": "cron failed" }
       ],
       "coverage_30d": 0.97,
       "last_collected": "2026-03-25T06:00:00Z"
     }
   }
   ```

2. Add an "Evidence Timeline" view to the Compliance tab:
   - Heatmap calendar (like GitHub contribution graph) per control
   - Each cell is a day, colored by: green (evidence collected), yellow (partial), red (missed)
   - Click a cell to see what evidence was collected that day
   - Overall coverage percentage: "97% evidence coverage over last 90 days"

3. This data comes from the daily compliance evidence CronJob (from platform-experience-plan Task 3.4).

4. Alert when evidence collection fails for 3+ consecutive days for any control.

5. Include the coverage report in the AO monthly summary (Task 7.12).

**Acceptance Criteria:**
- Heatmap shows per-control evidence collection over time
- Missed collections are highlighted
- Overall coverage percentage calculated
- Alert on consecutive missed collections
- AO summary includes coverage percentage

---

## Execution Order Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| **Phase 1** | 1.1-1.3 | Medium (API + JS + React) | CRITICAL — connects platform to portal |
| **Phase 2** | 2.1-2.4 | Medium (scripts + UI + formatters) | HIGH — ATO package assembly |
| **Phase 3** | 3.1-3.5 | Large (CronJobs + DB + dashboards) | HIGH — continuous monitoring |
| **Phase 4** | 4.1-4.3 | Medium (API + portal JS + scripts) | MEDIUM — RAISE automation |
| **Phase 5** | 5.1-5.3 | Medium (workflows + UI + digest) | HIGH — ISSM daily life |
| **Phase 6** | 6.1-6.3 | Medium (RBAC + export/import + SAR) | MEDIUM — assessor experience |
| **Phase 7** | 7.1-7.15 | Large (scripts + CronJobs + UI + docs) | HIGH — operational compliance |
| **Phase 8** | 8.1-8.5 | Medium (wizard + API + portal + docs) | HIGH — app compliance onboarding |

**Phase 7 parallel execution:**
- **7A — Testing and scanning** (7.1, 7.4, 7.9, 7.10): Automated validation, can run together
- **7B — Documentation and tracking** (7.6, 7.7, 7.8, 7.13, 7.14): Compliance docs + UI, can run together
- **7C — Automation and intelligence** (7.2, 7.3, 7.5, 7.11, 7.12, 7.15): Data generation + reporting, depends on Phase 1 API
- Phase 8 (app compliance onboarding): Depends on Phase 1 API + Phase 3.5 finding lifecycle

---

## Phase 8: Application Compliance Onboarding

When a developer brings new software to the platform, there's a compliance dimension beyond just "deploy it." The ISSM needs to know what the app does, what data it handles, what controls it inherits vs. owns, and whether it introduces new risk. These tasks make that process structured and automated.

---

### Task 8.1: App Security Categorization Wizard

**Problem:** Before an app deploys, its data sensitivity must be categorized per FIPS 199 (Low/Moderate/High for Confidentiality, Integrity, Availability). This determines which controls apply. Currently there's no process for this — all tenant namespaces default to "Moderate" but nobody verifies that's correct for each app.

**Where:** `apps/dsop-wizard/src/` — enhance Step 2 (App Info) or add a new step.

**Steps:**
1. Add a "Security Categorization" section to the DSOP wizard Step 2 (App Info):

   ```
   What type of data does this application process?
   ○ Public information (Low)
   ○ Internal operational data (Low-Moderate)
   ○ Controlled Unclassified Information / CUI (Moderate)
   ○ Personally Identifiable Information / PII (Moderate-High)
   ○ Protected Health Information / PHI (High)
   ○ Financial data (Moderate-High)
   ○ Not sure — request ISSM review
   ```

2. Based on selection, auto-set the FIPS 199 categorization:
   - **Confidentiality:** Low / Moderate / High
   - **Integrity:** Low / Moderate / High
   - **Availability:** Low / Moderate / High

3. If the categorization is higher than the namespace's `sre.io/security-categorization` label, flag it:
   - "This app handles PII (High) but the namespace is categorized as Moderate. ISSM review required before deployment."
   - Block deployment until ISSM confirms the namespace categorization is appropriate

4. Store the categorization in the HelmRelease annotations:
   ```yaml
   metadata:
     annotations:
       sre.io/data-types: "CUI, PII"
       sre.io/fips-199-confidentiality: "Moderate"
       sre.io/fips-199-integrity: "Moderate"
       sre.io/fips-199-availability: "Low"
   ```

5. Include in the compliance package and pipeline evidence.

**Acceptance Criteria:**
- Wizard captures data sensitivity classification before deployment
- Mismatch between app and namespace categorization blocks deployment
- Categorization stored in HelmRelease annotations
- Included in compliance evidence

---

### Task 8.2: Inherited Controls Report per App

**Problem:** When an app deploys on SRE, it inherits 30+ NIST controls from the platform. But neither the developer nor the assessor gets a document saying "here's what your app inherits and here's what you're responsible for." The control inheritance matrix (platform-experience-plan Task 3.3) covers this at the platform level, but each app needs its own tailored version based on what features it uses.

**Where:** `apps/dashboard/server.js` + DSOP wizard Step 7 (Complete).

**Steps:**
1. After deployment, auto-generate an "App Compliance Profile" that shows:

   **Inherited from Platform (no app action needed):**
   - SC-8: Encryption in transit (Istio mTLS) ✓
   - AC-4: Network isolation (NetworkPolicies) ✓
   - AU-2: Audit logging (Loki collection) ✓
   - SI-7: Image integrity (Cosign verified) ✓
   - RA-5: Vulnerability scanning (Harbor Trivy) ✓
   - ... (all controls the platform handles)

   **Shared (platform + app must both act):**
   - AC-2: Account management — Platform provides Keycloak SSO; App must use OAuth2 (not local auth)
   - AU-12: Audit generation — Platform collects stdout; App must log in structured JSON
   - SC-12: Key management — Platform provides OpenBao; App must use ExternalSecrets (not hardcoded)

   **App-Owned (developer responsible):**
   - SI-10: Input validation — App must validate all user input
   - SC-18: Mobile code — App must not execute untrusted client-side scripts
   - SA-11: Developer testing — App must have its own test suite

   **Conditional (based on app features):**
   - If `database.enabled: true` → AC-2 extends to database access control
   - If `ingress.enabled: true` → SC-7 extends to app-level boundary protection
   - If `externalServices` configured → CA-3 (ISA) applies for external connections

2. Generate this based on the app's HelmRelease values (which chart, which features enabled).

3. Include in the DSOP wizard compliance package download (Step 7).

4. Create server endpoint: `GET /api/apps/:namespace/:name/compliance-profile`

5. Show in the Applications tab when clicking an app: "Compliance Profile" expandable section.

**Acceptance Criteria:**
- Per-app compliance profile generated from HelmRelease values
- Controls categorized as Inherited / Shared / App-Owned / Conditional
- Downloadable from DSOP wizard and Applications tab
- Tailored based on which chart features are enabled

---

### Task 8.3: App Owner Compliance Package Generator

**Problem:** The RPOC portal has app owner templates (`rpoc-ato-portal/compliance/raise/app-owner-package/`) with 5 templates: vulnerability management plan, mitigation statement, STIG checklist, changelog, architecture template. But developers must manually fill these in. Many fields can be auto-populated from the pipeline and platform data.

**Where:** RPOC portal + SRE compliance API.

**Steps:**
1. Auto-populate the app owner package documents from pipeline and platform data:

   **vulnerability-management-plan-template.md:**
   - Auto-fill: app name, team, image registry, scan tool (Trivy), scan frequency (on every push), SLA thresholds (from Task 3.5)
   - Auto-fill: current CVE counts by severity from Harbor
   - Leave manual: escalation contacts, exception process (link to Kyverno PolicyException docs)

   **mitigation-statement-template.md:**
   - Auto-fill from pipeline findings with disposition=`accepted_risk`:
     - Finding ID, CVE, severity, justification, compensating controls
   - Leave manual: ISSM signature, AO concurrence

   **app-stig-checklist-template.md:**
   - Auto-fill: app image details, base image, scan results
   - Auto-fill any applicable STIG findings from Trivy/kube-bench
   - Leave manual: app-specific STIG checks (e.g., application-level encryption)

   **changelog-template.md:**
   - Auto-fill from Git history: `git log --oneline --since="3 months ago" -- apps/tenants/<team>/`
   - Include pipeline runs with dates and gate results

   **application-architecture-template.md:**
   - Auto-fill: services list (from Helm values), database (if enabled), external services (if configured)
   - Auto-fill: data flow from Istio traffic (Task 7.2)
   - Leave manual: business logic description, data classification narrative

2. Create server endpoint: `GET /api/apps/:namespace/:name/owner-package` that generates the pre-filled package as a ZIP.

3. Add a "Download App Compliance Package" button to the Applications tab per app.

4. Also available from the DSOP wizard Step 7 (alongside the existing compliance package).

**Acceptance Criteria:**
- 5 app owner documents auto-populated from live data
- Developer only needs to fill in business-specific sections
- Downloadable from Applications tab and DSOP wizard
- Package includes all required RAISE 2.0 APPO (Application Platform Product Owner) artifacts

---

### Task 8.4: Pre-Deployment Compliance Checklist

**Problem:** Developers deploy apps without knowing whether they meet compliance requirements. The Kyverno policies catch some issues (image registry, security context), but there's no pre-flight check that covers the full compliance picture — data categorization, SBOM availability, signed image, scan results clean, etc.

**Where:** `apps/dsop-wizard/src/` — add between Step 5 (Review) and Step 6 (Deploy).

**Steps:**
1. Add a "Compliance Readiness" check that runs before deployment:

   ```
   Pre-Deployment Compliance Checklist:

   ✅ Security categorization completed (Moderate)
   ✅ Image scanned by Trivy (0 critical, 2 high — all mitigated)
   ✅ Image signed with Cosign
   ✅ SBOM generated and attached (SPDX + CycloneDX)
   ✅ All SAST findings addressed (0 open)
   ✅ No secrets detected in source code
   ✅ Target namespace has NetworkPolicies
   ✅ Target namespace has Istio injection enabled
   ⚠️ No liveness/readiness probes configured — add probes for production
   ❌ External service api.stripe.com has no ISA — ISSM review required

   Result: 9/10 passed, 1 warning, 1 blocker
   [Deploy Anyway (warnings only)] [Request ISSM Review (blockers)]
   ```

2. Blockers (red) prevent deployment:
   - Missing security categorization
   - Unmitigated critical CVEs
   - Missing image signature
   - External services without ISA

3. Warnings (yellow) allow deployment but are noted:
   - Missing probes
   - High CVEs with accepted_risk disposition
   - Missing SBOM (non-blocking but tracked)

4. Green items are informational (everything is good).

5. Store the checklist result in the pipeline run record for audit trail.

**Acceptance Criteria:**
- Pre-deployment checklist runs automatically in DSOP wizard
- Blockers prevent deployment until resolved or ISSM-approved
- Warnings are logged but don't block
- Checklist results stored in audit trail

---

### Task 8.5: App Decommissioning Compliance Workflow

**Problem:** When an app is deleted from the platform, there's no compliance process. Data might need to be preserved for retention requirements, audit logs should be archived, and the POA&M should be updated to close any app-specific findings. Currently "delete" just removes the HelmRelease.

**Where:** `apps/dashboard/server.js` — delete endpoint. `apps/dashboard/client/src/` — Applications tab.

**Steps:**
1. When a developer or admin clicks "Delete" on an app, show a compliance decommissioning checklist:

   ```
   App Decommissioning: team-alpha/payment-api

   Before removal, confirm:
   ☐ All application data has been backed up or is not subject to retention
   ☐ Audit logs for this app have been preserved (Loki retains for 30 days)
   ☐ Any open POA&M findings for this app have been closed or transferred
   ☐ Any active risk acceptances for this app have been revoked
   ☐ The app owner has been notified of decommissioning
   ☐ Harbor images will be retained for [30/90/365] days per retention policy

   Reason for decommissioning: [text field]

   [Confirm Decommissioning] [Cancel]
   ```

2. On confirmation:
   - Auto-close any POA&M findings for the app (status → "closed_decommissioned")
   - Auto-revoke any PolicyExceptions scoped to the app
   - Create an audit log entry: "App decommissioned by [user], reason: [text]"
   - Delete the HelmRelease (Flux removes the resources)
   - Do NOT delete Harbor images (retain per policy)

3. Create server endpoint: `POST /api/apps/:namespace/:name/decommission` (different from plain DELETE).

4. Include decommissioning events in the compliance timeline.

**Acceptance Criteria:**
- Decommissioning requires checklist acknowledgment (not just a delete button)
- POA&M findings auto-closed on decommission
- PolicyExceptions auto-revoked
- Audit trail records decommissioning with reason
- Harbor images retained per policy

---

## Phase 9: Assessment Readiness and Document Intelligence

These close the last gaps — the things that actually trip up ATO packages during independent assessment.

---

### Task 9.1: One-Time Placeholder Fill Tool

**Problem:** Every document in `rpoc-ato-portal/compliance/raise/` has `_[PLACEHOLDER]_` fields (organization name, ISSM name, system owner, dates, facility address, etc.). Filling these in across 30 documents is tedious and error-prone — miss one and the assessor flags it.

**Where:** Create `rpoc-ato-portal/scripts/fill-placeholders.sh` or a portal UI page.

**Steps:**
1. Create a config file where the user fills in their org details once:
   ```yaml
   # rpoc-ato-portal/compliance/raise/org-config.yaml
   organization:
     name: "Defense Innovation Unit"
     abbreviation: "DIU"
     address: "1234 Innovation Way, Mountain View, CA 94043"
   system:
     name: "Secure Runtime Environment (SRE)"
     abbreviation: "SRE"
     emass_id: ""
     ditpr_id: ""
     fips_category: "Moderate-Moderate-Moderate"
   personnel:
     system_owner:
       name: "John Smith"
       title: "Program Manager"
       email: "john.smith@example.mil"
       phone: "(555) 123-4567"
     issm:
       name: "Jane Doe"
       title: "Information System Security Manager"
       email: "jane.doe@example.mil"
     isso:
       name: "Bob Wilson"
       title: "Information System Security Officer"
       email: "bob.wilson@example.mil"
     authorizing_official:
       name: "Col. Sarah Johnson"
       title: "Authorizing Official"
   dates:
     ato_target: "2026-09-01"
     system_go_live: "2026-06-01"
   ```

2. Create a script that replaces all `_[PLACEHOLDER]_`, `_[ORGANIZATION]_`, `_[ISSM NAME]_`, `_[SYSTEM OWNER]_`, etc. across all 30 markdown files using the config:
   ```bash
   ./scripts/fill-placeholders.sh --config compliance/raise/org-config.yaml
   ```

3. Also create a portal page (`placeholder-setup.html`) with a form that generates the config and runs the replacement — so non-technical users (ISSMs) can fill it in without touching YAML.

4. Track which placeholders haven't been filled: `./scripts/fill-placeholders.sh --check` lists remaining unfilled fields.

**Acceptance Criteria:**
- Fill in org details once, propagate to all 30 documents
- Check mode lists remaining unfilled placeholders
- Portal UI for non-technical users
- No placeholder is missed across any document

---

### Task 9.2: Cross-Reference Validator

**Problem:** The SSP references specific files (`platform/core/kyverno/helmrelease.yaml`), the control mapping references manifest paths, and STIG checklists reference Ansible roles. If any of these files are moved, renamed, or deleted, the compliance documents silently break — assessors click links that go nowhere.

**Where:** Create `scripts/validate-compliance-refs.sh`

**Steps:**
1. Parse all compliance documents (SSP JSON, control mapping JSON, STIG YAMLs) and extract every file path reference.

2. Check that each referenced file actually exists in the repo:
   ```bash
   # Example checks
   jq -r '.controls[].evidence[]' compliance/nist-800-53-mappings/control-mapping.json | while read path; do
     [ -f "$path" ] || echo "BROKEN REF: $path (in control-mapping.json)"
   done
   ```

3. Also check that referenced Kubernetes resources exist in the cluster:
   - Control says "Kyverno ClusterPolicy: require-labels" → verify `kubectl get clusterpolicy require-labels`
   - Control says "HelmRelease: istio" → verify `kubectl get helmrelease istio -n istio-system`

4. Output: list of broken references with which document contains them and what they should point to.

5. Run as part of `task validate` and in CI.

**Acceptance Criteria:**
- All file path references in compliance docs are validated
- Broken references reported with source document and line
- Runs in CI to catch drift early
- Cluster resource references validated when cluster is reachable

---

### Task 9.3: Compliance Gate in CI/CD (Block PRs That Reduce Compliance)

**Problem:** A developer could submit a PR that changes a Kyverno policy from `Enforce` to `Audit`, removes a NetworkPolicy, or deletes a STIG checklist. Nothing in CI catches compliance regressions.

**Where:** Create `.github/workflows/compliance-gate.yaml`

**Steps:**
1. Create a GitHub Actions workflow that runs on PRs touching `policies/`, `platform/`, or `compliance/`:

   ```yaml
   name: Compliance Gate
   on:
     pull_request:
       paths:
         - 'policies/**'
         - 'platform/**'
         - 'compliance/**'
         - 'apps/tenants/**'

   jobs:
     compliance-check:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         # Check 1: No Kyverno policies switched from Enforce to Audit
         - name: Check policy enforcement
           run: |
             git diff origin/main...HEAD -- policies/ | grep -E '^\+.*validationFailureAction.*Audit' && {
               echo "::error::Policy switched from Enforce to Audit. This requires ISSM approval."
               exit 1
             } || true

         # Check 2: No NetworkPolicies deleted
         - name: Check network policies
           run: |
             DELETED=$(git diff origin/main...HEAD --name-only --diff-filter=D -- 'apps/tenants/*/network-policies/' 'platform/*/network-policies/')
             [ -n "$DELETED" ] && {
               echo "::error::NetworkPolicy files deleted: $DELETED"
               exit 1
             } || true

         # Check 3: Kyverno policy tests exist for any new/modified policies
         - name: Check policy tests
           run: |
             for policy in $(git diff origin/main...HEAD --name-only -- 'policies/custom/*.yaml' 'policies/baseline/*.yaml' 'policies/restricted/*.yaml'); do
               POLICY_NAME=$(basename "$policy" .yaml)
               [ -d "policies/tests/$POLICY_NAME" ] || {
                 echo "::error::Policy $POLICY_NAME has no test suite in policies/tests/"
                 exit 1
               }
             done

         # Check 4: Compliance document references still valid
         - name: Validate compliance refs
           run: ./scripts/validate-compliance-refs.sh --files-only

         # Check 5: Run Kyverno policy tests
         - name: Run policy tests
           run: kyverno test policies/tests/
   ```

2. Make the workflow a required check for PR merge on the `main` branch.

**Acceptance Criteria:**
- PRs that weaken policies (Enforce→Audit) are blocked
- PRs that delete NetworkPolicies are blocked
- New policies without tests are blocked
- Broken compliance references are caught in CI
- Kyverno policy tests run on every PR

---

### Task 9.4: Automated Evidence Screenshots via Grafana Rendering

**Problem:** The ATO evidence package (Task 2.1) generates JSON artifacts, but assessors often want visual evidence — screenshots of Grafana dashboards showing metrics are healthy, Keycloak showing user management is configured, etc. Currently someone must manually take screenshots.

**Where:** Enhance `scripts/generate-ato-package.sh` and add Grafana image rendering.

**Steps:**
1. Grafana has a built-in rendering API. Call it to generate PNG screenshots of key dashboards:
   ```bash
   # Screenshot cluster overview dashboard
   curl -s "https://grafana.apps.sre.example.com/render/d/sre-cluster-overview/cluster-summary?width=1200&height=800&orgId=1" \
     -u "admin:prom-operator" \
     -o "${OUTPUT_DIR}/screenshots/cluster-overview.png"

   # Screenshot Kyverno compliance dashboard
   curl -s "https://grafana.apps.sre.example.com/render/d/sre-kyverno-compliance/compliance-summary?width=1200&height=800" \
     -u "admin:prom-operator" \
     -o "${OUTPUT_DIR}/screenshots/kyverno-compliance.png"

   # Screenshot Istio mesh dashboard
   curl -s "https://grafana.apps.sre.example.com/render/d/sre-istio-mesh/mesh-summary?width=1200&height=800" \
     -u "admin:prom-operator" \
     -o "${OUTPUT_DIR}/screenshots/istio-mesh.png"
   ```

2. Generate screenshots for 10 key dashboards that map to NIST control families:
   - Cluster Overview → CM-2, CM-8
   - Kyverno Compliance → AC-6, CM-7
   - Istio Mesh → SC-8, AC-4
   - Certificate Manager → IA-5, SC-12
   - Flux GitOps → CM-3, SA-10
   - NeuVector Security → SI-3, SI-4
   - Harbor Registry → RA-5, SI-7
   - Audit Logs → AU-2, AU-6
   - Alerting Overview → IR-4, IR-5
   - Node Overview → SC-13 (FIPS)

3. Each screenshot is timestamped and named by control family.

4. Include a `screenshots/` directory in the ATO evidence ZIP.

5. If Grafana rendering is not available (no rendering plugin), skip with a warning.

**Note:** Grafana image rendering requires the `grafana-image-renderer` plugin. Check if it's deployed; if not, add it to the Grafana HelmRelease values:
```yaml
imageRenderer:
  enabled: true
```

**Acceptance Criteria:**
- 10 dashboard screenshots auto-captured in the evidence package
- Each screenshot timestamped and labeled with NIST control family
- Graceful skip if rendering plugin not available
- Screenshots are legible (1200x800 minimum)

---

### Task 9.5: POA&M Auto-Close on Remediation

**Problem:** When a CVE finding is tracked in the POA&M (Task 3.5) and a developer deploys a patched image, the finding should auto-close. Currently findings sit open until someone manually updates them.

**Where:** `apps/dashboard/server.js` — deployment handler + finding lifecycle.

**Steps:**
1. After a successful deployment, check if any open POA&M findings reference the deployed image:
   ```javascript
   async function checkRemediatedFindings(namespace, appName, newImageTag) {
     // Find open findings for this app
     const openFindings = await db.query(
       `SELECT * FROM finding_lifecycle
        WHERE affected_resource LIKE $1
        AND status IN ('open', 'in_progress')
        AND source IN ('trivy', 'pipeline')`,
       [`%${namespace}/${appName}%`]
     );

     for (const finding of openFindings) {
       // Re-scan the new image for this specific CVE
       const stillPresent = await checkCVEInImage(newImageTag, finding.cve_id);
       if (!stillPresent) {
         await db.query(
           `UPDATE finding_lifecycle SET status='mitigated', mitigated_at=NOW(),
            mitigated_by='auto-remediation', notes='CVE no longer present in ${newImageTag}'
            WHERE id=$1`,
           [finding.id]
         );
         logger.info(`Auto-closed finding ${finding.id}: ${finding.title} — remediated in ${newImageTag}`);
       }
     }
   }
   ```

2. Call this function after every successful deployment in the deploy handler.

3. Log auto-closures in the audit trail.

4. Show in the ISSM daily digest: "3 findings auto-remediated by new deployments yesterday"

**Acceptance Criteria:**
- Open findings auto-close when the patched image deploys
- Auto-closure logged in audit trail
- ISSM digest reports auto-remediations
- Only closes findings where the specific CVE is no longer present (verified by re-scan)

---

### Task 9.6: SCA Assessment Dry-Run Checklist

**Problem:** Before the independent SCA shows up for the 8-12 week assessment, the ISSM needs to know "are we ready?" There's no checklist for assessment preparation — what should be in place, what evidence should be pre-staged, what common gotchas to fix first.

**Where:** Create `rpoc-ato-portal/compliance/raise/sca-assessment-prep.md` and a portal page.

**Steps:**
1. Create a comprehensive pre-assessment checklist:

   ```markdown
   # SCA Assessment Preparation Checklist

   ## 30 Days Before Assessment

   ### Documentation Ready
   - [ ] All 30 ATO package documents have no remaining _[PLACEHOLDER]_ fields
   - [ ] SSP control narratives uploaded to eMASS
   - [ ] POA&M current (no stale findings older than SLA)
   - [ ] All QREV templates filled for current quarter
   - [ ] Cross-reference validator passes: `./scripts/validate-compliance-refs.sh`

   ### Platform Ready
   - [ ] Compliance score ≥ 95%: `./scripts/compliance-report.sh`
   - [ ] All Kyverno policies in Enforce mode (no Audit for production controls)
   - [ ] STIG scan passing ≥ 95%: `./scripts/quarterly-stig-scan.sh`
   - [ ] Control validation tests pass: `./scripts/control-validation-tests.sh`
   - [ ] No critical/high CVEs without disposition in deployed images
   - [ ] All PolicyExceptions have valid justifications and are not expired
   - [ ] All certificates have > 30 days before expiry
   - [ ] Velero backups running on schedule, last restore test passed
   - [ ] OpenBao unsealed and healthy

   ### Evidence Pre-Staged
   - [ ] Generate fresh ATO evidence package: `./scripts/generate-ato-package.sh`
   - [ ] Grafana dashboard screenshots captured (10 dashboards)
   - [ ] Data flow diagram current (generated from live Istio traffic)
   - [ ] Personnel list current (training dates, access review dates)
   - [ ] Rules of Behavior signed by all users
   - [ ] Tabletop exercise completed this quarter with after-action report

   ### Access for Assessor
   - [ ] Assessor Keycloak account created (compliance-assessors group)
   - [ ] Assessor can access: Dashboard, Grafana, Harbor (read-only)
   - [ ] Assessor CANNOT access: Admin tab, deployment, user management
   - [ ] Assessment worksheet pre-filled and ready for handoff

   ## Common Gotchas (Things Assessors Always Flag)
   - Incomplete POA&M (every finding must have a remediation plan + timeline)
   - Stale evidence (screenshots from 6 months ago don't count)
   - Missing signatures on RoB (every user, not just admins)
   - PPSM registration incomplete (every external port must be registered)
   - No evidence of contingency plan testing (need exercise reports)
   - Separation of duties not enforced (same person can deploy and approve)
   ```

2. Add a "Assessment Prep" page to the RPOC portal with an interactive checklist.

3. Create `scripts/assessment-readiness.sh` that runs all the automated checks and reports a readiness score.

**Acceptance Criteria:**
- Comprehensive checklist covering docs, platform, evidence, and access
- Automated readiness script checks everything that can be automated
- Portal page with interactive checklist
- Common gotchas section prevents known assessment failures

---

### Task 9.7: SLSA Build Provenance Attestations

**Problem:** The CI/CD pipeline signs images with Cosign (SI-7) and generates SBOMs (CM-8), but doesn't generate SLSA (Supply-chain Levels for Software Artifacts) build provenance. SLSA proves WHERE and HOW the image was built — not just that it was signed. Assessors increasingly ask for this for SA-10 (Developer Configuration Management).

**Where:** `ci/github-actions/build-scan-deploy.yaml` — the sign-and-push job.

**Steps:**
1. After Cosign signing, add SLSA provenance attestation:
   ```yaml
   - name: Generate SLSA provenance
     uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.0.0
     with:
       image: ${{ env.HARBOR_REGISTRY }}/${{ inputs.harbor-project }}/${{ inputs.image-name }}
       digest: ${{ steps.push.outputs.digest }}
   ```

   Or using Cosign attestation:
   ```yaml
   - name: Attach SLSA provenance
     run: |
       cosign attest --predicate <(cat <<EOF
       {
         "_type": "https://in-toto.io/Statement/v0.1",
         "predicateType": "https://slsa.dev/provenance/v0.2",
         "subject": [{"name": "${IMAGE}", "digest": {"sha256": "${DIGEST}"}}],
         "predicate": {
           "builder": {"id": "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"},
           "buildType": "https://github.com/slsa-framework/slsa-github-generator/container@v1",
           "invocation": {
             "configSource": {
               "uri": "git+https://github.com/${GITHUB_REPOSITORY}@refs/heads/${GITHUB_REF_NAME}",
               "digest": {"sha1": "${GITHUB_SHA}"},
               "entryPoint": ".github/workflows/build-scan-deploy.yaml"
             }
           },
           "metadata": {
             "buildStartedOn": "${BUILD_START}",
             "buildFinishedOn": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
             "completeness": {"parameters": true, "environment": true, "materials": true}
           },
           "materials": [
             {"uri": "git+https://github.com/${GITHUB_REPOSITORY}", "digest": {"sha1": "${GITHUB_SHA}"}}
           ]
         }
       }
       EOF
       ) --key env://COSIGN_PRIVATE_KEY "${IMAGE}@${DIGEST}"
   ```

2. Add a Kyverno policy that verifies SLSA provenance on deployment (alongside the existing image signature verification):
   ```yaml
   verifyImages:
     - imageReferences: ["harbor.apps.sre.example.com/*"]
       attestations:
         - predicateType: "https://slsa.dev/provenance/v0.2"
           conditions:
             - all:
                 - key: "{{ builder.id }}"
                   operator: Equals
                   value: "https://github.com/morbidsteve/*"
   ```

3. Add SLSA status to the DSOP wizard pipeline evidence (Gate 7: Image Signing → include provenance verification).

4. Document in `ci/README.md` under the image signing section.

**Acceptance Criteria:**
- SLSA provenance attestation generated for every CI/CD build
- Provenance attached to image in Harbor via Cosign attestation
- Kyverno policy verifies provenance on deployment (Audit mode initially)
- Pipeline evidence shows SLSA verification status

---

### Task 9.8: Audit Log Integrity (Tamper-Proof Chain)

**Problem:** NIST AU-9 (Protection of Audit Information) requires that audit logs can't be tampered with. The platform logs to Loki and the pipeline DB, but neither has tamper detection. If someone with admin access modifies audit entries, there's no way to detect it.

**Where:** `apps/dashboard/server.js` — audit logging function.

**Steps:**
1. Add a hash chain to the audit trail in the pipeline database:
   ```javascript
   async function auditLog(action, actor, target, details = {}) {
     // Get the hash of the previous entry
     const prev = await db.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
     const prevHash = prev.rows.length > 0 ? prev.rows[0].hash : '0000000000000000';

     const entry = {
       timestamp: new Date().toISOString(),
       action, actor, target,
       details: JSON.stringify(details),
       prev_hash: prevHash,
     };

     // Hash this entry + previous hash = chain
     const hash = crypto.createHash('sha256')
       .update(prevHash + entry.timestamp + entry.action + entry.actor + entry.target + entry.details)
       .digest('hex');

     await db.query(
       'INSERT INTO audit_log (timestamp, action, actor, target, details, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
       [entry.timestamp, entry.action, entry.actor, entry.target, entry.details, prevHash, hash]
     );
   }
   ```

2. Create a verification script: `scripts/verify-audit-chain.sh` that:
   - Reads all audit entries in order
   - Recomputes each hash from the entry data + previous hash
   - Reports PASS if all hashes match, FAIL with the first broken link

3. Run the verification weekly as a CronJob and alert if the chain is broken.

4. Include audit chain verification in the ATO evidence package.

**Acceptance Criteria:**
- Every audit entry includes a hash linking to the previous entry
- Verification script detects any modified or deleted entries
- Weekly verification runs automatically
- Assessors can verify the chain independently

---

## Execution Order Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| **Phase 1** | 1.1-1.3 | Medium (API + JS + React) | CRITICAL — connects platform to portal |
| **Phase 2** | 2.1-2.4 | Medium (scripts + UI + formatters) | HIGH — ATO package assembly |
| **Phase 3** | 3.1-3.5 | Large (CronJobs + DB + dashboards) | HIGH — continuous monitoring |
| **Phase 4** | 4.1-4.3 | Medium (API + portal JS + scripts) | MEDIUM — RAISE automation |
| **Phase 5** | 5.1-5.3 | Medium (workflows + UI + digest) | HIGH — ISSM daily life |
| **Phase 6** | 6.1-6.3 | Medium (RBAC + export/import + SAR) | MEDIUM — assessor experience |
| **Phase 7** | 7.1-7.15 | Large (scripts + CronJobs + UI + docs) | HIGH — operational compliance |
| **Phase 8** | 8.1-8.5 | Medium (wizard + API + portal + docs) | HIGH — app compliance onboarding |
| **Phase 9** | 9.1-9.8 | Medium (scripts + CI + attestations) | HIGH — assessment readiness |

**Phase 9 parallel execution:**
- **9A** (9.1, 9.2, 9.6): Documentation and validation tools — pure scripts, no dependencies
- **9B** (9.3): CI gate — independent GitHub Actions workflow
- **9C** (9.4, 9.5): Evidence automation — depends on Phase 2 (package generator) and Phase 3.5 (finding lifecycle)
- **9D** (9.7, 9.8): Supply chain + audit integrity — independent, can run in parallel
- [ ] 11 compliance API endpoints return live data from cluster
- [ ] RPOC portal pages show live data when API is reachable and fall back to demo data when offline
- [ ] Compliance score visible on SRE dashboard Overview tab with trend arrow
- [ ] Score gauge on Compliance tab with 30-day sparkline

**ATO Package Assembly:**
- [ ] `./scripts/generate-ato-package.sh` generates 16+ evidence artifacts in a single ZIP
- [ ] Per-control evidence viewer shows live evidence from Keycloak, Harbor, Loki, Prometheus
- [ ] SSP narratives auto-generated for all 48 controls
- [ ] OSCAL-to-eMASS converter produces importable CSV

**Continuous Monitoring:**
- [ ] Drift detection runs hourly and alerts on mTLS, policy, NetworkPolicy, RBAC changes
- [ ] Weekly STIG scans run automatically with results stored and trended
- [ ] SBOM search finds packages and CVE-affected images across all deployed apps
- [ ] Grafana compliance trend dashboard shows 90-day history
- [ ] Finding SLA tracking alerts when remediation deadlines are breached

**RAISE 2.0:**
- [ ] 15+ RAISE requirements auto-verified from live cluster
- [ ] QREV documents auto-generated with real data
- [ ] CI/CD certification form auto-populated with pipeline statistics

**ISSM Workflow:**
- [ ] Daily digest delivered via Slack/email at 7am
- [ ] Risk acceptance workflow captures justification, compensating controls, and expiry
- [ ] Unified waiver/exception dashboard shows all approved deviations

**Assessor Experience:**
- [ ] Assessor role has read-only access to all compliance evidence
- [ ] Assessment worksheet export pre-fills platform evidence
- [ ] SAR auto-populated with scan results and control status

**Operational Compliance (Phase 7):**
- [ ] Control validation tests attempt 15+ actual violations and verify they're blocked
- [ ] Data flow diagram auto-generated from Istio traffic with Mermaid + JSON output
- [ ] License inventory generated from SBOMs with allowlist/blocklist enforcement
- [ ] Monthly pentest runs automatically with results stored and tracked
- [ ] Change control records auto-created from Flux reconciliation events
- [ ] 5 ISA documents created for known external connections with expiry tracking
- [ ] Tabletop exercise tracker shows completed exercises and open action items
- [ ] Personnel training and access review dates tracked per user with overdue alerts
- [ ] Daily CVE alerting detects NEW vulnerabilities in deployed images
- [ ] Pre-deployment compliance gate blocks deploys with critical compliance failures
- [ ] Air-gap compliance snapshot exports all portal data as a single JSON file
- [ ] Monthly AO summary auto-generated with posture, findings, changes, and upcoming events
- [ ] All 110 CMMC practices have evidence links with partial/planned remediation timelines
- [ ] Rules of Behavior acknowledgment required on first login with version tracking
- [ ] cATO evidence timeline shows per-control collection heatmap with coverage percentage

**App Compliance Onboarding (Phase 8):**
- [ ] DSOP wizard captures FIPS 199 security categorization per app before deployment
- [ ] Categorization mismatch (app vs. namespace) blocks deployment and triggers ISSM review
- [ ] Per-app compliance profile auto-generated showing inherited/shared/app-owned controls
- [ ] 5 app owner compliance documents auto-populated from live data
- [ ] Pre-deployment compliance checklist runs with blockers/warnings before every deployment
- [ ] App decommissioning requires compliance checklist and auto-closes POA&M findings

**Assessment Readiness (Phase 9):**
- [ ] Placeholder fill tool replaces all `_[PLACEHOLDER]_` fields across 30 documents from a single config
- [ ] Cross-reference validator catches broken file/resource references in compliance docs
- [ ] CI compliance gate blocks PRs that weaken policies or delete NetworkPolicies
- [ ] Grafana screenshot automation captures 10 dashboards for evidence package
- [ ] POA&M findings auto-close when patched images deploy
- [ ] SCA assessment preparation checklist and readiness script exist
- [ ] SLSA build provenance attestations generated in CI/CD pipeline
- [ ] Audit log hash chain detects any tampered or deleted entries
