# SRE DevSecOps Pipeline — Strategic Plan

## Vision
**One-click deployment from code to production with full RPOC/DSOP compliance.**

A developer pushes code (or gives a Git URL). The platform automatically:
1. Detects the app type (container, compose, helm, etc.)
2. Runs all 8 RAISE security gates
3. Generates compliance artifacts (SBOM, scan reports, attestations)
4. Presents a compliance summary for ISSM review
5. On approval, deploys to SRE with full security controls
6. Continuously monitors and rescans

---

## The 8 RAISE Gates (Already Defined in Our RPOC Package)

| Gate | Tool | What It Does | Status |
|------|------|-------------|--------|
| GATE 1: SAST | Semgrep | Static analysis of source code | **NOT YET** — need to add to pipeline |
| GATE 2: SBOM | Syft | Generate SPDX + CycloneDX SBOM | **NOT YET** — Harbor has auto-SBOM enabled but no Syft in pipeline |
| GATE 3: Secrets | Gitleaks | Detect hardcoded secrets | **NOT YET** — need to add to pipeline |
| GATE 4: CSS | Trivy | Container vulnerability scanning | **DONE** — Harbor auto-scans on push |
| GATE 5: DAST | OWASP ZAP | Dynamic app testing after deploy | **NOT YET** — need to add post-deploy |
| GATE 6: ISSM Review | Manual approval | Human reviews all artifacts | **NOT YET** — need approval workflow |
| GATE 7: Signing | Cosign | Sign image after approval | **NOT YET** — need Cosign in pipeline |
| GATE 8: Storage | Harbor | Store signed image + artifacts | **DONE** — Harbor is the registry |

### Current Pipeline (deploy-from-git):
```
Git URL → Analyze repo → Detect type → Build via Kaniko → Push to Harbor → Deploy HelmRelease
```

### Target Pipeline:
```
Git URL → Analyze repo → Detect type
  → GATE 1: SAST (Semgrep scan source code)
  → GATE 3: Secrets (Gitleaks scan repo)
  → Build via Kaniko → Push to Harbor
  → GATE 2: SBOM (Syft generate SBOM, attach to image)
  → GATE 4: CSS (Trivy scan — Harbor auto-scan on push)
  → Deploy to staging namespace
  → GATE 5: DAST (ZAP scan running app)
  → GATE 6: ISSM Review (dashboard shows all results, human approves)
  → GATE 7: Signing (Cosign sign approved image)
  → Deploy to production namespace
  → Continuous monitoring (NeuVector + Kyverno + Prometheus)
```

---

## App Intake Formats (All Must Be Supported)

| Format | Detection | Build Strategy | Example |
|--------|-----------|---------------|---------|
| Single Dockerfile | `Dockerfile` in root | Kaniko build | Simple web app |
| Multi-stage Dockerfile | `Dockerfile` with multiple stages | Kaniko build with `--target` | Frontend + backend in one repo |
| Docker Compose | `docker-compose.yml` | Parse services, Kaniko each | Microservice app |
| Helm Chart | `Chart.yaml` | No build needed, deploy chart | Pre-packaged app |
| Kustomize | `kustomization.yaml` | No build needed, apply kustomize | K8s-native app |
| Pre-built image | Just an image URL | Pull, scan, deploy | Third-party app |
| Source code only | Language files, no Dockerfile | Auto-generate Dockerfile (Buildpacks) | Developer's first app |
| Git repo URL | Any of the above | Auto-detect and route | Universal entry point |

### What's Missing for "Source Code Only":
Need Cloud Native Buildpacks (CNB) or Paketo as fallback when no Dockerfile exists.
Detect language → generate optimal Dockerfile → build → scan → deploy.

---

## Work Roles & UX Design

### Role 1: Platform Administrator (sre-admins)
**Day-to-day:** Cluster health, scaling, upgrades, user management, policy enforcement
**Needs:** Admin Console, full dashboard, Keycloak admin, monitoring
**Command-K:** All commands available
**View:** Full admin dashboard with all tabs

### Role 2: System Maintainer
**Day-to-day:** Keep services running, respond to alerts, scale resources
**Needs:** StatusBoard, Grafana, logs, problem pod view, node status
**Command-K:** Navigation, cluster ops, alerts, logs
**View:** StatusBoard + relevant dashboard tabs (Status, Cluster, Services)

### Role 3: Network Security Operations Center (NSOC)
**Day-to-day:** Monitor security events, respond to incidents, review compliance
**Needs:** Intel Feed, NeuVector, alerts, CVE reports, compliance status
**Command-K:** Security commands, alert management, NeuVector
**View:** Intel Feed as home page, alert-focused dashboard

### Role 4: Application Developer
**Day-to-day:** Build apps, push code, deploy to SRE, view logs, debug
**Needs:** Deploy wizard, logs, app status, DSOP pipeline status
**Command-K:** Deploy, view logs, app status, documentation
**View:** Simplified deploy view + their app status

### Role 5: Application Integrator
**Day-to-day:** Take third-party apps and deploy them to SRE
**Needs:** Deploy wizard (guided!), DSOP pipeline, compliance artifact generation
**Command-K:** Deploy, scan, compliance
**View:** Guided deployment wizard as primary experience

### Role 6: Compliance Officer / ISSM
**Day-to-day:** Review DSOP pipeline results, approve deployments, generate ATO packages
**Needs:** RPOC ATO Portal, scan results, SBOM viewer, approval workflow
**Command-K:** Compliance commands, approve/reject, view artifacts
**View:** Compliance-focused dashboard

---

## The Guided Deployment Wizard (THE BIG UX WIN)

This is the killer feature. A web-based step-by-step wizard that takes someone from
"I have an app" to "it's running securely on SRE" with DSOP compliance.

### Step 1: "What do you have?"
```
○ A Git repository URL
○ A container image (already built)
○ A Helm chart
○ I'm starting from scratch
```

### Step 2: "Tell us about your app" (auto-filled where possible)
```
App Name: [__________]
Description: [__________]
Team/Namespace: [dropdown of available teams]
Classification: [UNCLASSIFIED / CUI / SECRET]
Contact Email: [auto-filled from SSO]
```

### Step 3: Auto-Detection (for Git repos)
```
✓ Detected: Docker Compose with 3 services
  - frontend (nginx, port 80)
  - backend (python:3.11, port 8000)
  - worker (python:3.11, no port)

Resources detected:
  - PostgreSQL database → Will provision CNPG cluster
  - Redis cache → Will provision in-cluster Redis

External access:
  ○ Frontend needs public URL: [app-name].apps.sre.example.com
  ○ Backend is internal only
  ○ Worker is internal only
```

### Step 4: Security Pipeline (DSOP Gates)
```
Running RAISE Security Gates...

[████████░░] Gate 1: SAST (Semgrep) ......... PASSED ✓
             → 0 errors, 2 warnings (non-blocking)
[████████░░] Gate 2: SBOM (Syft) ............ PASSED ✓
             → SPDX + CycloneDX generated
[████████░░] Gate 3: Secrets (Gitleaks) ...... PASSED ✓
             → 0 secrets detected
[██████████] Gate 4: CSS (Trivy) ............ WARNING ⚠
             → 0 critical, 3 high, 12 medium
             [View Full Report] [Accept Risk]
[░░░░░░░░░░] Gate 5: DAST (ZAP) ............ PENDING
             → Will run after deployment to staging
[░░░░░░░░░░] Gate 6: ISSM Review ........... PENDING
             → Awaiting all gates + human approval
[░░░░░░░░░░] Gate 7: Signing (Cosign) ...... PENDING
             → Will sign after ISSM approval
[██████████] Gate 8: Storage (Harbor) ....... PASSED ✓
             → Images stored in Harbor with Trivy scan
```

### Step 5: Review & Approve
```
DEPLOYMENT SUMMARY
─────────────────────────────────
App: keystone
Type: Docker Compose (3 services)
Namespace: team-keystone
URL: https://keystone.apps.sre.example.com

Security Gates: 4/8 passed, 1 warning, 3 pending
Compliance: MODERATE impact level
SBOM: Generated (SPDX + CycloneDX)
Vulnerabilities: 0 critical, 3 high (accepted)

[Download ATO Package]  [Submit for ISSM Review]  [Deploy to Staging]
```

### Step 6: Deploy & Monitor
```
Deploying to staging...
[████████████████████████] 100%

Staging URL: https://keystone-staging.apps.sre.example.com

Running DAST scan (OWASP ZAP)...
[████████████████████████] 100%
→ Gate 5: DAST PASSED ✓

All gates passed. Ready for ISSM review.
[Submit for Production Approval]
```

### Step 7: Production (after ISSM approval)
```
ISSM APPROVED ✓
Signing image with Cosign...
Deploying to production...
Registering in portal...

YOUR APP IS LIVE
https://keystone.apps.sre.example.com

[View in Portal]  [View Logs]  [View Metrics]
```

---

## Implementation Plan

### Phase 1: DSOP Pipeline in Dashboard (Weeks 1-2)
- Add SAST (Semgrep) as a Kaniko sidecar job
- Add Secrets scanning (Gitleaks) as a pre-build job
- Add SBOM generation (Syft) as a post-build job
- Add Cosign signing as a post-approval step
- Add DAST (ZAP) as a post-deploy job
- All results stored as K8s ConfigMaps/Secrets

### Phase 2: Guided Deployment Wizard (Weeks 2-3)
- New tab in dashboard: "Deploy App" → wizard flow
- Step-by-step with auto-detection
- Real-time pipeline status with WebSocket updates
- Gate pass/fail visualization
- Downloadable compliance artifacts

### Phase 3: Approval Workflow (Week 3)
- Dashboard shows pending deployments needing ISSM review
- ISSM can view all scan artifacts, SBOM, vulnerability reports
- Approve/reject with comments
- Approved → auto-sign and deploy
- Rejected → developer gets notification with feedback

### Phase 4: ATO Package Generator (Week 4)
- Auto-generate ATO submission package per app
- Pre-fill app-owner-package templates from pipeline data
- Generate STIG checklists from scan results
- Create vulnerability management plan from Trivy data
- Bundle as downloadable zip

### Phase 5: Role-Based Views (Weeks 4-5)
- Different home pages per role (Keycloak groups)
- sre-admins → Admin Console
- developers → Deploy Wizard
- nsoc → Intel Feed
- compliance → RPOC ATO Portal

### Phase 6: On-Prem (GitLab) Support (Weeks 5-6)
- GitLab as bundled platform addon
- Same DSOP pipeline running in GitLab CI
- Mirror pipeline results to dashboard
- Offline Trivy DB updates
- Air-gapped SBOM generation

---

## Questions for You

### Pipeline & Compliance
1. Is RAISE 2.0 the specific RPOC framework you're targeting? The CI/CD tools certification doc references it specifically.
2. For GATE 6 (ISSM Review) — is the ISSM a person on your team, or does the customer provide one? This affects the approval workflow UX.
3. For Cosign signing — do you want to use keyless signing (Sigstore/Fulcio) or key-based? Key-based is simpler for air-gapped.
4. Do you need separate staging and production environments, or is the current single cluster sufficient? RAISE typically requires separate environments.
5. For the ATO package — is the target eMASS (Navy) or a different system? The templates reference NISP eMASS.
6. Should the DSOP pipeline run in GitHub Actions (cloud) or entirely within the SRE cluster (on-prem)? Or both?

### App Intake
7. For "pre-built image" deployments — do you need to support images from DockerHub/GHCR directly, or must everything go through Harbor first?
8. For Helm charts — should the wizard handle charts from arbitrary Helm repos, or only charts already in your Harbor OCI registry?
9. For source-code-only (no Dockerfile) — which languages should we support for auto-Dockerfile generation? (Python, Node, Go, Java, .NET, Rust?)
10. Should the platform support Windows containers, or Linux only?

### Usability
11. The "day one stay one" users — are these military personnel, contractors, or both? This affects the terminology and UX language.
12. For the guided wizard — should it be part of the SRE Dashboard, or a standalone app?
13. Do you want role-based landing pages (different home screen per role), or a unified portal with filtered content?
14. Should the documentation be built into the app (in-app guides, tooltips, walkthroughs) or separate docs pages?
15. For single-container deployment — should it be as simple as "paste a Docker image URL and click deploy"? Any security gates required even for that?

### On-Prem / Air-Gap
16. For on-prem deployments — is the target customer providing their own hardware, or are you shipping hardware + software?
17. Is GitLab Community Edition acceptable, or do you need GitLab EE features?
18. For air-gapped environments — how do you plan to get updates in? USB drives? Periodically connected?
19. Should the SRE platform itself be deployable via a single script/ISO, or is Ansible-based provisioning acceptable?

### Business
20. Is this being sold as a product, or used internally for a specific contract?
21. Who is the primary buyer — the cybersecurity service provider, or the end customer (e.g., a Navy command)?
22. How many simultaneous applications do you expect running on a typical deployment? 5? 50? 500?
23. Is multi-tenancy required (multiple teams with isolation), or single-tenant?
24. What's the classification ceiling — UNCLASSIFIED, CUI, or up to SECRET?
