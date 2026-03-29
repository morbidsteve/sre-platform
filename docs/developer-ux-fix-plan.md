# Developer UX Fix Plan

The SRE platform's deployment UI is optimized for the happy path and silent on failure. When things go wrong, developers see a progress bar hang for 60-120 seconds followed by "Timeout - check status manually." The server returns structured error JSON with policy names, blockers, and denial reasons, but the client swallows it with `console.error()`. This plan fixes that.

**Core problem:** The toast notification system exists (`ToastContext.tsx`) and works, but is only used in one place. Every deploy, rollback, database creation, and Helm operation uses silent `catch {}` blocks.

**Goal:** A developer who hits any failure sees exactly what went wrong and how to fix it — within 5 seconds, not 120.

---

## Phase 1: Fix Silent Failures

The server already returns good error data. The client just doesn't show it. These tasks wire existing infrastructure together.

### Task 1.1: Wire Toast Notifications to All Deploy Operations

**Problem:** `DeployTab.tsx` catches deploy errors with `console.error('Deploy failed:', data.error)` and shows nothing to the user. Same for Helm chart deploys, database creation, and all other async operations.

**Files to change:**
- `apps/dashboard/client/src/components/deploy/DeployTab.tsx`
- `apps/dashboard/client/src/components/applications/HelmDeployForm.tsx`
- `apps/dashboard/client/src/components/applications/DatabaseForm.tsx`
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx` (delete, rollback)

**What the toast system already supports** (`apps/dashboard/client/src/context/ToastContext.tsx`):
- 4 types: `info`, `success`, `warning`, `error`
- Color-coded with auto-dismiss (4 seconds) or click-to-close
- Fixed bottom-right position
- Already imported in some components but unused

**Steps:**

1. In every component that performs an async operation, import and use the toast context:
   ```typescript
   const { showToast } = useToast();
   ```

2. **Quick Deploy** (`DeployTab.tsx`, around line 71-98 — `handleQuickDeploy`):
   ```typescript
   // CURRENT (broken):
   if (!data.success) {
     console.error('Deploy failed:', data.error);
   }

   // FIXED:
   if (!data.success) {
     if (data.blockers && data.blockers.length > 0) {
       showToast(`Deploy blocked: ${data.blockers.map(b => b.message).join('; ')}`, 'error');
     } else {
       showToast(`Deploy failed: ${data.error || 'Unknown error'}`, 'error');
     }
     return; // Stop progress indicator
   }
   showToast(`Deploying ${name} to ${team}...`, 'info');
   ```

3. **Helm Chart Deploy** (`HelmDeployForm.tsx`):
   - On 400 (invalid YAML): `showToast('Invalid YAML in values field. Check syntax.', 'error')`
   - On success: `showToast('Helm release created. Flux will reconcile shortly.', 'success')`
   - On any other error: `showToast('Helm deploy failed: ' + error.message, 'error')`

4. **Database Creation** (`DatabaseForm.tsx`):
   - On success: `showToast('Database provisioning started.', 'success')`
   - On error: `showToast('Database creation failed: ' + error.message, 'error')`

5. **App Delete** (`ApplicationsTab.tsx`):
   - Replace `window.confirm()` with a proper modal (the `ModalContext` exists)
   - On success: `showToast('Deleted ' + appName, 'success')`
   - On error: `showToast('Delete failed: ' + error.message, 'error')`

6. **Rollback** (`ApplicationsTab.tsx`):
   - On success: `showToast('Rolled back to revision ' + revision, 'success')`
   - On error: `showToast('Rollback failed: ' + error.message, 'error')` (the `rollbackError` state is already set but never displayed — wire it to a toast)

7. Remove all `// handle silently` comments and empty `catch {}` blocks. Every catch should show a toast.

**Acceptance Criteria:**
- Every async operation shows a toast on success or failure
- No `console.error` as the only feedback — all errors shown in UI
- No empty `catch {}` blocks remain in deploy-related components
- `window.confirm()` replaced with modal for delete

---

### Task 1.2: Surface Compliance Gate Results in the UI

**Problem:** The server's compliance gate (`complianceGate` function, server.js line ~11047) returns a structured response with blockers, warnings, and checks when it rejects a deploy. The response looks like:

```json
{
  "success": false,
  "error": "Compliance gate failed — deployment blocked",
  "blockers": [
    { "check": "image_scan", "severity": "critical", "message": "Image has 3 critical vulnerabilities" }
  ],
  "warnings": [
    { "check": "network_policies", "severity": "warning", "message": "Namespace has no NetworkPolicies" }
  ],
  "checks": [
    { "check": "istio_injection", "status": "pass", "message": "Istio injection enabled" },
    { "check": "resource_quota", "status": "warning", "message": "No ResourceQuota found" }
  ]
}
```

But the client never displays this.

**Files to change:**
- `apps/dashboard/client/src/components/deploy/DeployTab.tsx`
- Create new component: `apps/dashboard/client/src/components/deploy/ComplianceGateResult.tsx`

**Steps:**

1. Create a `ComplianceGateResult` component that renders the gate response:
   ```tsx
   // Shows blockers (red), warnings (yellow), passes (green) in a compact list
   // Each item shows: icon + check name + message
   // Blockers show a "How to fix" expandable with remediation guidance:
   //   - image_scan critical → "Update your base image or mitigate CVEs in Harbor"
   //   - network_policies missing → "Contact platform admin to verify namespace setup"
   //   - istio_injection missing → "Namespace needs istio-injection=enabled label"
   //   - resource_quota missing → "Contact platform admin to set up resource quotas"
   ```

2. In the deploy handler, when the server returns a non-success response with `blockers` or `checks`, show the `ComplianceGateResult` component in a modal or inline panel instead of silently failing.

3. If there are only warnings (no blockers), show the warnings but allow the deploy to proceed with a "Deploy Anyway" button.

4. If there are blockers, disable the deploy button and show the blocker details with fix guidance.

**Acceptance Criteria:**
- Compliance gate blockers shown in a clear, visual format
- Each blocker has a remediation hint
- Warnings shown but don't block deployment
- Developer understands exactly why their deploy was rejected

---

### Task 1.3: Show Failure Reasons on App Cards

**Problem:** The backend returns `statusReason` for each app (e.g., "CrashLoopBackOff", "ImagePullBackOff"), but the Applications tab never displays it. App cards only show "Running" (green) or "Deploying" (yellow). There's no "Failed" state in the UI.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx` — the app card rendering

**Steps:**

1. Add a third status state: **Failed** (red). The logic:
   ```typescript
   function getAppStatus(app) {
     if (app.status === 'failed' || app.statusReason?.includes('CrashLoop') || app.statusReason?.includes('Error') || app.statusReason?.includes('BackOff')) {
       return { label: 'Failed', color: 'red', reason: app.statusReason };
     }
     if (app.ready) {
       return { label: 'Running', color: 'green', reason: null };
     }
     return { label: 'Deploying', color: 'yellow', reason: app.statusReason || 'Waiting for pods...' };
   }
   ```

2. When status is Failed, show the `statusReason` below the status badge:
   ```
   ┌─────────────────────────────────────┐
   │ ● my-app                     Failed │
   │   CrashLoopBackOff: container       │
   │   exited with code 1                │
   │                                     │
   │   [View Logs]  [View Events]        │
   │   [Troubleshoot]                    │
   └─────────────────────────────────────┘
   ```

3. When status is Deploying for more than 5 minutes, show a warning:
   ```
   Deploying for 8 minutes... this may indicate a problem.
   [Check Status]
   ```

4. Add a "Troubleshoot" link on failed apps that opens a diagnostic panel (Task 2.4).

**Acceptance Criteria:**
- Failed apps show red status with the specific reason (CrashLoopBackOff, ImagePullBackOff, etc.)
- Long-running deploys show a warning after 5 minutes
- Each failure state has an action button (view logs, view events, troubleshoot)

---

### Task 1.4: Show Kyverno Denial Messages on Deploy Failure

**Problem:** When Kyverno blocks a pod, the denial message is only in Kubernetes events. The dashboard never fetches or displays it. The developer sees "Timeout" and has to use kubectl to find out what happened.

**Files to change:**
- `apps/dashboard/server.js` — add event fetching to the deploy status endpoint
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx` — display denial events

**Steps:**

1. In the server's app status endpoint (`GET /api/deploy/:namespace/:name/status` or `GET /api/apps`), also fetch recent Kubernetes events for the app:
   ```javascript
   // Fetch events that mention Kyverno or policy
   const events = await k8sApi.listNamespacedEvent(namespace);
   const policyEvents = events.body.items.filter(e =>
     e.reason === 'PolicyViolation' ||
     e.message?.includes('kyverno') ||
     e.message?.includes('policy') ||
     e.message?.includes('blocked') ||
     e.message?.includes('denied')
   ).map(e => ({
     reason: e.reason,
     message: e.message,
     timestamp: e.lastTimestamp,
     source: e.source?.component,
   }));
   ```

2. Return policy events in the app status response:
   ```json
   {
     "name": "my-app",
     "status": "failed",
     "statusReason": "Pod creation blocked by admission webhook",
     "policyViolations": [
       {
         "reason": "PolicyViolation",
         "message": "validation error: policy require-run-as-nonroot: container must set runAsNonRoot to true",
         "timestamp": "2026-03-26T10:00:00Z"
       }
     ]
   }
   ```

3. In the UI, when `policyViolations` is non-empty, show a distinct "Policy Violation" banner on the app card:
   ```
   ┌─────────────────────────────────────────┐
   │ ● my-app                  Policy Denied │
   │                                         │
   │ ⛔ require-run-as-nonroot               │
   │   Container must set runAsNonRoot: true  │
   │                                         │
   │ Fix: Add USER 1000 to your Dockerfile   │
   │      or set runAsNonRoot: true in your  │
   │      Helm values.                       │
   │                                         │
   │ [Request Exception]  [View All Policies]│
   └─────────────────────────────────────────┘
   ```

4. The "Fix" text should come from a remediation mapping:
   ```javascript
   const POLICY_FIXES = {
     'require-run-as-nonroot': 'Add `USER 1000` to your Dockerfile, or set `securityContext.runAsNonRoot: true` in your Helm values.',
     'require-security-context': 'Ensure your deployment has `securityContext.allowPrivilegeEscalation: false` and `capabilities.drop: ["ALL"]`.',
     'restrict-image-registries': 'Pull your image from `harbor.apps.sre.example.com`, not Docker Hub.',
     'disallow-latest-tag': 'Pin your image to a specific version tag (e.g., `:v1.2.3`), not `:latest`.',
     'require-resource-limits': 'Set `resources.requests` and `resources.limits` for CPU and memory.',
     'require-probes': 'Add `livenessProbe` and `readinessProbe` to your container spec.',
     'require-labels': 'Add required labels: `app.kubernetes.io/name`, `app.kubernetes.io/part-of`, `sre.io/team`.',
     'verify-image-signatures': 'Sign your image with Cosign before pushing to Harbor.',
   };
   ```

5. "Request Exception" links to the PolicyException process (`policies/custom/policy-exceptions/README.md`).

**Acceptance Criteria:**
- Kyverno denial messages shown on the app card within seconds (not after 120s timeout)
- Each policy violation includes the policy name, denial message, and fix instructions
- Fix instructions are actionable (specific commands/changes)
- "Request Exception" link available for cases where the fix isn't possible

---

### Task 1.5: Replace Timeout Message with Actual Failure Details

**Problem:** The `DeployProgress` component polls for 60-120 seconds, then shows "Timeout - check status manually." It never checks WHY the deploy failed — it just gives up.

**File to change:**
- `apps/dashboard/client/src/components/applications/DeployProgress.tsx`

**Steps:**

1. When the polling timeout is reached, instead of showing a generic timeout message, make one final diagnostic call:
   ```typescript
   // On timeout, fetch actual status
   const statusResp = await fetch(`/api/deploy/${namespace}/${name}/status`);
   const status = await statusResp.json();

   if (status.policyViolations?.length > 0) {
     setError(`Blocked by policy: ${status.policyViolations[0].message}`);
   } else if (status.helmRelease?.reason === 'InstallFailed') {
     setError(`Helm install failed: ${status.helmRelease.message}`);
   } else if (status.pods?.some(p => p.phase === 'Failed' || p.containers?.some(c => c.reason))) {
     const failedPod = status.pods.find(p => p.phase === 'Failed' || p.containers?.some(c => c.reason));
     const reason = failedPod.containers?.[0]?.reason || failedPod.phase;
     const message = failedPod.containers?.[0]?.message || '';
     setError(`Pod failed: ${reason}${message ? ' — ' + message : ''}`);
   } else {
     setError('Deploy is taking longer than expected. Check the Applications tab for status.');
   }
   ```

2. Show the error with an action:
   ```
   ⚠️ Deployment Issue Detected

   Blocked by policy: require-run-as-nonroot
   Container must set runAsNonRoot to true.

   [View Details]  [View in Applications Tab]
   ```

3. If the issue is a Kyverno policy, show the fix from the `POLICY_FIXES` mapping (Task 1.4).

4. If the issue is a pod crash, show a "View Logs" link.

5. Never show "check status manually" — always provide a specific reason or at least a link.

**Acceptance Criteria:**
- Timeout replaced with actual failure diagnosis
- Specific error message shown (policy violation, pod crash, Helm failure)
- Action buttons link to relevant diagnostic views
- "Check status manually" never shown

---

## Phase 2: Add Pre-Flight Checks

Catch problems before they become failed pods. Each check runs before the deploy API call and gives instant feedback.

### Task 2.1: Image Existence Check Before Deploy

**Problem:** Developer types `harbor.apps.sre.example.com/team-alpha/my-app:v1.2.3` but the image doesn't exist. They wait 2 minutes to find out via timeout. A HEAD request to the Harbor registry API takes <1 second.

**Files to change:**
- `apps/dashboard/server.js` — new endpoint
- `apps/dashboard/client/src/components/deploy/DeployTab.tsx` — call before deploy

**Steps:**

1. Create server endpoint: `GET /api/registry/check?image=<full-image-ref>`
   ```javascript
   app.get('/api/registry/check', async (req, res) => {
     const { image } = req.query;
     if (!image) return res.status(400).json({ error: 'image parameter required' });

     // Parse image into registry/project/repo:tag
     const { registry, project, repo, tag } = parseImageRef(image);

     // Check Harbor API for the artifact
     try {
       const resp = await fetch(
         `https://${registry}/api/v2.0/projects/${project}/repositories/${encodeURIComponent(repo)}/artifacts/${tag}`,
         { headers: { Authorization: `Basic ${harborAuth}` } }
       );
       if (resp.ok) {
         const artifact = await resp.json();
         return res.json({
           exists: true,
           digest: artifact.digest,
           scanned: artifact.scan_overview?.['application/vnd.security.vulnerability.report; version=1.1']?.scan_status === 'Success',
           vulnerabilities: {
             critical: artifact.scan_overview?.['application/vnd.security.vulnerability.report; version=1.1']?.summary?.fixable || 0,
           }
         });
       }
       if (resp.status === 404) {
         return res.json({ exists: false });
       }
       return res.json({ exists: false, error: 'Registry returned ' + resp.status });
     } catch (err) {
       return res.json({ exists: false, error: err.message });
     }
   });
   ```

2. In the deploy forms (Quick Deploy custom image, Helm if image specified), call the check when the image field loses focus (debounced, 500ms):
   ```typescript
   const [imageStatus, setImageStatus] = useState<'unchecked' | 'checking' | 'found' | 'not_found'>('unchecked');

   async function checkImage(imageRef: string) {
     if (!imageRef.includes('harbor')) { setImageStatus('unchecked'); return; }
     setImageStatus('checking');
     const resp = await fetch(`/api/registry/check?image=${encodeURIComponent(imageRef)}`);
     const data = await resp.json();
     setImageStatus(data.exists ? 'found' : 'not_found');
   }
   ```

3. Show inline indicator next to the image field:
   - Spinner while checking
   - Green checkmark + "Image found" if exists
   - Red X + "Image not found in Harbor. Push it first." if not exists
   - Also show scan status if found: "Scanned: 0 critical CVEs" or "Not scanned yet"

4. Disable the deploy button if image is `not_found`.

**Acceptance Criteria:**
- Image existence checked before deploy (debounced on field blur)
- Instant feedback: found/not-found with indicator
- Deploy button disabled if image doesn't exist
- Also shows scan status (scanned/not scanned, critical CVE count)

---

### Task 2.2: Kyverno Policy Dry-Run Before Deploy

**Problem:** Kyverno blocks pods at admission time, but the developer doesn't know until after they click deploy and wait 2 minutes. A dry-run can check policies before creating any resources.

**Files to change:**
- `apps/dashboard/server.js` — new endpoint
- `apps/dashboard/client/src/components/deploy/DeployTab.tsx` — pre-flight check

**Steps:**

1. Create server endpoint: `POST /api/deploy/preflight` that:
   a. Takes the same deploy payload (name, team, image, tag, port, securityContext)
   b. Renders the HelmRelease template into Kubernetes manifests (without applying)
   c. Runs `kubectl apply --dry-run=server -f -` to test admission
   d. Catches and parses any Kyverno denial messages
   e. Returns results:

   ```json
   {
     "passed": false,
     "violations": [
       {
         "policy": "require-run-as-nonroot",
         "rule": "run-as-nonroot",
         "message": "validation error: container must set runAsNonRoot to true",
         "fix": "Add USER 1000 to your Dockerfile"
       }
     ],
     "warnings": [],
     "resourceQuota": {
       "cpuAvailable": "2000m",
       "cpuRequested": "500m",
       "memoryAvailable": "4Gi",
       "memoryRequested": "512Mi",
       "withinQuota": true
     }
   }
   ```

2. In the deploy flow, run the preflight check after the user fills in the form but before the actual deploy. Show results inline:
   ```
   Pre-flight Check Results:
   ✅ Image found in Harbor (scanned, 0 critical CVEs)
   ✅ Namespace team-alpha exists with Istio injection
   ❌ Policy: require-run-as-nonroot — container must run as non-root
      Fix: Add USER 1000 to your Dockerfile
   ✅ Resource quota: 500m/2000m CPU, 512Mi/4Gi memory
   ⚠️ No liveness probe configured (recommended)

   [Fix Issues and Retry]  [Deploy Anyway (warnings only)]
   ```

3. Block deploy if any policy violations exist (red). Allow deploy with only warnings (yellow).

4. Cache the preflight results for 30 seconds so repeated deploys don't re-run the check.

**Acceptance Criteria:**
- Preflight check runs before deploy
- Policy violations caught and shown with fix instructions
- Resource quota checked and shown
- Deploy blocked on violations, allowed on warnings

---

### Task 2.3: Dockerfile Analysis During Deploy from Git

**Problem:** When a developer uses "Deploy from Git," the system clones their repo and builds with Kaniko. But it doesn't analyze the Dockerfile for common mistakes that will cause Kyverno rejections later. The developer waits through a full build only to have the resulting image rejected.

**Files to change:**
- `apps/dashboard/server.js` — enhance the Git analysis phase

**Steps:**

1. After cloning the repo and detecting a Dockerfile (the analysis job already does this), add a Dockerfile lint step that checks for:
   ```javascript
   function lintDockerfile(dockerfileContent) {
     const issues = [];

     // Check: FROM :latest
     if (/^FROM\s+\S+:latest/m.test(dockerfileContent)) {
       issues.push({
         severity: 'error',
         line: dockerfileContent.split('\n').findIndex(l => /^FROM\s+\S+:latest/.test(l)) + 1,
         message: 'FROM uses :latest tag. Pin to a specific version.',
         fix: 'Change FROM image:latest to FROM image:1.2.3'
       });
     }

     // Check: No USER directive (will run as root)
     if (!/^USER\s+/m.test(dockerfileContent)) {
       issues.push({
         severity: 'warning',
         message: 'No USER directive. Container will run as root, which violates require-run-as-nonroot policy.',
         fix: 'Add "USER 1000" before the CMD/ENTRYPOINT instruction'
       });
     }

     // Check: No HEALTHCHECK
     if (!/^HEALTHCHECK\s+/m.test(dockerfileContent)) {
       issues.push({
         severity: 'info',
         message: 'No HEALTHCHECK directive. Consider adding one for liveness/readiness probes.',
         fix: 'Add HEALTHCHECK CMD curl -f http://localhost:8080/healthz || exit 1'
       });
     }

     // Check: EXPOSE missing
     if (!/^EXPOSE\s+/m.test(dockerfileContent)) {
       issues.push({
         severity: 'info',
         message: 'No EXPOSE directive. The platform needs to know which port your app listens on.',
         fix: 'Add EXPOSE 8080 (or your app port)'
       });
     }

     // Check: ADD instead of COPY
     if (/^ADD\s+(?!https?:)/m.test(dockerfileContent)) {
       issues.push({
         severity: 'info',
         message: 'Using ADD instead of COPY. COPY is more explicit and preferred.',
         fix: 'Replace ADD with COPY unless you need URL or tar extraction'
       });
     }

     return issues;
   }
   ```

2. Return lint results in the detection/analysis response (Step 3 of the DSOP wizard or the Deploy from Git flow).

3. Show lint results before the build starts:
   ```
   Dockerfile Analysis:
   ⚠️ Line 1: FROM node:latest — Pin to a specific version
   ⚠️ No USER directive — Container will run as root (policy violation)
   ℹ️ No HEALTHCHECK — Consider adding one for probes

   [Fix and Continue]  [Continue Anyway]
   ```

4. If there are errors (`:latest` tag), block the build. Warnings and info are advisory.

**Acceptance Criteria:**
- Dockerfile analyzed before build starts
- Common issues caught: `:latest`, no USER, no HEALTHCHECK, no EXPOSE
- Results shown with line numbers and fix suggestions
- `:latest` tag blocks build, other issues are warnings

---

### Task 2.4: App Diagnostics Panel

**Problem:** When an app fails, the developer has to check 4 different places: Applications tab (status), Grafana (logs), Security tab (policy violations), Operations tab (events). There's no single "what's wrong with my app?" view.

**Files to change:**
- Create `apps/dashboard/client/src/components/applications/AppDiagnostics.tsx`
- Update `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`
- `apps/dashboard/server.js` — new aggregated diagnostics endpoint

**Steps:**

1. Create server endpoint: `GET /api/apps/:namespace/:name/diagnostics` that returns everything a developer needs in one call:
   ```json
   {
     "app": { "name": "my-app", "namespace": "team-alpha", "image": "harbor.../my-app:v1.0" },
     "helmRelease": {
       "ready": false,
       "reason": "InstallFailed",
       "message": "admission webhook denied the request: policy require-run-as-nonroot..."
     },
     "pods": [
       {
         "name": "my-app-7d4f5b-x2k9",
         "phase": "Pending",
         "containers": [{ "name": "app", "state": "waiting", "reason": "CrashLoopBackOff", "message": "..." }],
         "restartCount": 5
       }
     ],
     "recentEvents": [
       { "type": "Warning", "reason": "BackOff", "message": "Back-off restarting failed container", "age": "2m" },
       { "type": "Warning", "reason": "PolicyViolation", "message": "require-run-as-nonroot: ...", "age": "5m" }
     ],
     "recentLogs": [
       "Error: Cannot find module '/app/server.js'",
       "npm ERR! missing script: start"
     ],
     "policyViolations": [
       { "policy": "require-run-as-nonroot", "message": "...", "fix": "Add USER 1000 to Dockerfile" }
     ],
     "resources": {
       "cpu": { "requested": "100m", "limit": "500m", "used": "45m" },
       "memory": { "requested": "128Mi", "limit": "512Mi", "used": "89Mi" }
     },
     "probes": {
       "liveness": { "configured": true, "path": "/healthz", "passing": false, "lastFailure": "connection refused" },
       "readiness": { "configured": true, "path": "/readyz", "passing": false, "lastFailure": "connection refused" }
     },
     "suggestedActions": [
       { "priority": 1, "action": "Fix Dockerfile: add USER 1000", "reason": "Policy require-run-as-nonroot is blocking pod creation" },
       { "priority": 2, "action": "Check application entrypoint", "reason": "Container is crash-looping — check CMD/ENTRYPOINT in Dockerfile" }
     ]
   }
   ```

2. The `suggestedActions` are generated server-side by analyzing the combined state:
   ```javascript
   function generateSuggestedActions(diagnostics) {
     const actions = [];

     // Policy violations are highest priority
     for (const v of diagnostics.policyViolations) {
       actions.push({ priority: 1, action: POLICY_FIXES[v.policy] || `Fix policy: ${v.policy}`, reason: v.message });
     }

     // CrashLoopBackOff
     if (diagnostics.pods.some(p => p.containers?.some(c => c.reason === 'CrashLoopBackOff'))) {
       actions.push({ priority: 2, action: 'Check application logs for startup errors', reason: 'Container is restarting repeatedly' });
     }

     // ImagePullBackOff
     if (diagnostics.pods.some(p => p.containers?.some(c => c.reason === 'ImagePullBackOff'))) {
       actions.push({ priority: 1, action: 'Verify image exists in Harbor and credentials are correct', reason: 'Image cannot be pulled' });
     }

     // OOMKilled
     if (diagnostics.pods.some(p => p.containers?.some(c => c.reason === 'OOMKilled'))) {
       actions.push({ priority: 2, action: 'Increase memory limit in your deployment values', reason: 'Container exceeded memory limit' });
     }

     // Probes failing
     if (diagnostics.probes.liveness?.configured && !diagnostics.probes.liveness?.passing) {
       actions.push({ priority: 3, action: `Fix liveness probe at ${diagnostics.probes.liveness.path}`, reason: diagnostics.probes.liveness.lastFailure });
     }

     return actions.sort((a, b) => a.priority - b.priority);
   }
   ```

3. Create the `AppDiagnostics` component as a slide-out panel (opened by clicking "Troubleshoot" on a failed app card, or "View Details" on any app):

   ```
   ┌─────────────────────────────────────────────────┐
   │ Diagnostics: my-app                         [X] │
   ├─────────────────────────────────────────────────┤
   │                                                 │
   │ ⚡ Suggested Actions                            │
   │ 1. Fix Dockerfile: add USER 1000               │
   │    → Policy require-run-as-nonroot blocking     │
   │ 2. Check application entrypoint                 │
   │    → Container crash-looping                    │
   │                                                 │
   │ ── Pod Status ──────────────────────────────── │
   │ my-app-7d4f5b  CrashLoopBackOff  5 restarts   │
   │                                                 │
   │ ── Recent Events ──────────────────────────── │
   │ 2m ago  Warning  BackOff  Back-off restarting  │
   │ 5m ago  Warning  PolicyViolation  require-...  │
   │                                                 │
   │ ── Recent Logs (last 20 lines) ───────────── │
   │ Error: Cannot find module '/app/server.js'     │
   │ npm ERR! missing script: start                  │
   │                                                 │
   │ ── Resources ──────────────────────────────── │
   │ CPU:    45m / 500m  [████░░░░] 9%             │
   │ Memory: 89Mi / 512Mi [███░░░░] 17%            │
   │                                                 │
   │ ── Probes ─────────────────────────────────── │
   │ Liveness:  /healthz  ❌ connection refused     │
   │ Readiness: /readyz   ❌ connection refused     │
   │                                                 │
   │ [View Full Logs in Grafana]  [Request Exception]│
   └─────────────────────────────────────────────────┘
   ```

4. The panel includes:
   - Suggested actions (prioritized, actionable)
   - Pod status with restart count
   - Recent events (last 10, warnings highlighted)
   - Recent logs (last 20 lines from the pod, fetched inline — not a Grafana redirect)
   - Resource usage bars
   - Probe status
   - Links to Grafana (full logs) and exception process (if policy violation)

**Acceptance Criteria:**
- Single panel shows all diagnostic info for an app
- Suggested actions are prioritized and actionable
- Pod logs shown inline (last 20 lines)
- Opens from any app card (not just failed ones)
- Works for healthy apps too (shows resources, probes, logs)

---

## Phase 2.5: Comprehensive Error Intelligence for Every Rejection Type

The platform has multiple enforcement layers (Kyverno policies, Istio, Kubernetes RBAC, ResourceQuota, NetworkPolicy). When any of these blocks a developer, the error is currently opaque. This task builds a complete error-to-fix mapping for every rejection the developer can hit.

### Task 2.5: Build Complete Error-to-Fix Knowledge Base

**Problem:** Task 1.4 creates a `POLICY_FIXES` mapping for Kyverno policies, but developers also get blocked by Istio mTLS, RBAC permissions, NetworkPolicy, ResourceQuota, LimitRange, and namespace issues. Each of these produces different error messages and needs different fixes. There's no single knowledge base.

**Files to change:**
- Create `apps/dashboard/server/error-knowledge-base.js` (or `.ts`)
- Referenced by: diagnostics panel (Task 2.4), deploy error handler (Task 1.5), gate fix guides (Task 4.2)

**Steps:**

1. Create a comprehensive error-to-fix knowledge base covering every enforcement layer:

```javascript
const ERROR_KNOWLEDGE_BASE = {

  // ═══════════════════════════════════════════════
  // KYVERNO POLICIES (16 policies, each with specific fixes)
  // ═══════════════════════════════════════════════

  // Baseline policies (Enforce)
  'disallow-privileged-containers': {
    what: 'Your container requests privileged mode, which gives it full host access.',
    fix: 'Remove `privileged: true` from your container securityContext. If your app truly needs privileged access (very rare), request a PolicyException.',
    dockerfile: null,
    helmValues: 'Ensure you are NOT setting securityContext.privileged: true in your HelmRelease values.',
    docs: 'policies/custom/policy-exceptions/README.md',
  },
  'disallow-host-namespaces': {
    what: 'Your pod requests access to the host PID, IPC, or network namespace. This breaks container isolation.',
    fix: 'Remove hostPID, hostIPC, and hostNetwork from your pod spec. Use Kubernetes Services for networking instead of host networking.',
    helmValues: 'Do not set hostNetwork: true in your deployment.',
  },
  'disallow-host-ports': {
    what: 'Your container binds directly to a host port. Use Kubernetes Services and Istio ingress instead.',
    fix: 'Remove hostPort from your container ports. Use a Service (ClusterIP) and VirtualService for external access.',
  },
  'restrict-unsafe-sysctls': {
    what: 'Your pod sets kernel parameters (sysctls) that are not on the safe list.',
    fix: 'Remove unsafe sysctls from your pod spec. Safe sysctls: kernel.shm_rmid_forced, net.ipv4.ip_local_port_range, net.ipv4.tcp_syncookies.',
  },

  // Restricted policies (moving to Enforce)
  'require-run-as-nonroot': {
    what: 'Your container runs as root (UID 0). This is a security risk and violates the platform policy.',
    fix: 'Add a non-root user to your Dockerfile and switch to it.',
    dockerfile: 'Add before CMD:\n  RUN addgroup -S appgroup && adduser -S appuser -G appgroup\n  USER appuser',
    helmValues: 'The SRE Helm charts set this automatically. If using custom manifests, add:\n  securityContext:\n    runAsNonRoot: true\n    runAsUser: 1000',
  },
  'require-drop-all-capabilities': {
    what: 'Your container has Linux capabilities that it doesn\'t need. The platform requires dropping all capabilities.',
    fix: 'The SRE Helm charts handle this automatically. If using custom manifests, add:\n  securityContext:\n    capabilities:\n      drop: ["ALL"]',
  },
  'disallow-privilege-escalation': {
    what: 'Your container allows privilege escalation (a child process could gain more privileges than the parent).',
    fix: 'The SRE Helm charts set this automatically. If using custom manifests, add:\n  securityContext:\n    allowPrivilegeEscalation: false',
  },
  'restrict-volume-types': {
    what: 'Your pod uses a volume type that is not allowed (hostPath, nfs, etc.). Only safe volume types are permitted.',
    fix: 'Use only: configMap, secret, emptyDir, persistentVolumeClaim, projected, downwardAPI. Do not mount host paths.',
  },

  // Custom policies
  'require-labels': {
    what: 'Your resources are missing required labels that the platform uses for tracking and RBAC.',
    fix: 'Add these labels to your pod/deployment:\n  app.kubernetes.io/name: <your-app-name>\n  app.kubernetes.io/part-of: sre-platform\n  sre.io/team: <your-team>',
    helmValues: 'The SRE Helm charts add these automatically from your values.yaml app.name and app.team fields.',
  },
  'disallow-latest-tag': {
    what: 'Your container image uses the :latest tag or has no tag. This makes deployments unpredictable.',
    fix: 'Pin your image to a specific version tag.',
    dockerfile: 'Change: FROM node:latest\nTo: FROM node:20-alpine',
    helmValues: 'Set app.image.tag to a specific version (e.g., "v1.2.3"), not "latest".',
  },
  'restrict-image-registries': {
    what: 'Your image is from a registry that is not approved. All images must come from the platform\'s Harbor registry.',
    fix: 'Push your image to Harbor first:\n  docker tag my-app:v1.0 harbor.apps.sre.example.com/<your-team>/my-app:v1.0\n  docker push harbor.apps.sre.example.com/<your-team>/my-app:v1.0',
  },
  'require-resource-limits': {
    what: 'Your containers must declare CPU and memory requests and limits. This prevents one app from starving others.',
    fix: 'The SRE Helm charts set defaults (100m CPU, 128Mi memory). To customize:\n  app:\n    resources:\n      requests: { cpu: 100m, memory: 128Mi }\n      limits: { cpu: 500m, memory: 512Mi }',
  },
  'require-probes': {
    what: 'Your containers must have liveness and readiness probes so Kubernetes knows if your app is healthy.',
    fix: 'Add health check endpoints to your app:\n  GET /healthz → return 200 if alive\n  GET /readyz → return 200 if ready\n\nOr use TCP probes for non-HTTP apps:\n  app:\n    probes:\n      liveness: { type: tcp }\n      readiness: { type: tcp }',
  },
  'require-security-context': {
    what: 'Your pod is missing a security context. The platform requires non-root, read-only filesystem, and no privilege escalation.',
    fix: 'The SRE Helm charts set this automatically. If using custom manifests, add:\n  securityContext:\n    runAsNonRoot: true\n    readOnlyRootFilesystem: true\n    allowPrivilegeEscalation: false\n    capabilities:\n      drop: ["ALL"]',
  },
  'verify-image-signatures': {
    what: 'Your image is not signed with Cosign. The platform verifies image signatures to ensure supply chain integrity.',
    fix: 'Sign your image in CI/CD:\n  cosign sign --key cosign.key harbor.apps.sre.example.com/<team>/<app>:v1.0\n\nOr use the platform CI/CD pipeline (DSOP wizard) which signs automatically.',
  },
  'require-network-policies': {
    what: 'The namespace is missing NetworkPolicies. This is a platform admin issue, not yours.',
    fix: 'Contact your platform admin — the namespace was not properly onboarded. Run: ./scripts/onboard-tenant.sh <team>',
  },
  'require-istio-sidecar': {
    what: 'The namespace does not have Istio sidecar injection enabled. This is a platform admin issue.',
    fix: 'Contact your platform admin — the namespace needs the istio-injection=enabled label.',
  },

  // ═══════════════════════════════════════════════
  // ISTIO ERRORS
  // ═══════════════════════════════════════════════

  'istio-sidecar-injection-failed': {
    what: 'The Istio sidecar proxy failed to inject into your pod. This means your app won\'t have mTLS or be part of the service mesh.',
    fix: 'Check that your namespace has the label: istio-injection=enabled\nIf your pod has an annotation sidecar.istio.io/inject: "false", remove it.\nIf using init containers, they may conflict with Istio\'s init container.',
  },
  'istio-upstream-connect-error': {
    what: 'Istio cannot connect to your application. Your app may not be listening on the expected port, or it crashed before Istio could route traffic.',
    fix: 'Verify your app listens on the port specified in your Helm values (app.port).\nCheck: kubectl logs <pod> -c <your-app-container>\nCommon cause: app crashes on startup, Istio routes traffic to a dead container.',
  },
  'istio-503-no-healthy-upstream': {
    what: 'Istio returned 503 because no healthy pods were found for your service. All pods may be crash-looping or not ready.',
    fix: 'Check pod status: kubectl get pods -n <team> -l app.kubernetes.io/name=<app>\nIf pods are CrashLoopBackOff, check logs for startup errors.\nIf pods are Pending, check resource quota: kubectl describe quota -n <team>',
  },
  'istio-authorization-denied': {
    what: 'An Istio AuthorizationPolicy is blocking traffic to your service. This is the service mesh\'s access control.',
    fix: 'If calling from another namespace, the target service must allow your namespace:\n  authorizationPolicy:\n    allowedCallers:\n      - namespace: <your-namespace>\n        serviceAccounts: [<your-app>]\n\nIf calling from the same namespace, check the allow-same-namespace policy exists.',
  },
  'istio-mtls-error': {
    what: 'mTLS handshake failed between services. One side may not have an Istio sidecar, or certificates may be expired.',
    fix: 'Both pods must have Istio sidecars. Check: kubectl get pod -n <ns> <pod> -o jsonpath=\'{.spec.containers[*].name}\' — should include "istio-proxy".\nIf calling an external service, use a ServiceEntry + DestinationRule with DISABLE tls mode.',
  },

  // ═══════════════════════════════════════════════
  // KUBERNETES RBAC / PERMISSIONS
  // ═══════════════════════════════════════════════

  'forbidden-rbac': {
    what: 'You don\'t have permission to perform this action in this namespace. Your Keycloak group determines what you can do.',
    fix: 'Your access is based on Keycloak groups:\n  • <team>-developers: create, update, delete workloads\n  • <team>-viewers: read-only\n\nIf you need access, ask your team lead to add you to the correct Keycloak group.\nYou cannot modify: RBAC, ResourceQuotas, NetworkPolicies (platform-managed).',
  },
  'forbidden-namespace': {
    what: 'You tried to access a namespace that your team doesn\'t own.',
    fix: 'You can only deploy to your team\'s namespace. Check your team assignment in Keycloak.\nYour namespaces: kubectl auth can-i list pods --all-namespaces (shows accessible namespaces).',
  },

  // ═══════════════════════════════════════════════
  // RESOURCE QUOTA / LIMIT RANGE
  // ═══════════════════════════════════════════════

  'quota-exceeded-cpu': {
    what: 'Your namespace has used all its CPU allocation. No new pods can be created until existing ones free up CPU.',
    fix: 'Check current usage: kubectl describe quota -n <team>\nOptions:\n  1. Reduce CPU requests on existing apps\n  2. Scale down unused deployments\n  3. Ask platform admin to increase the namespace quota',
  },
  'quota-exceeded-memory': {
    what: 'Your namespace has used all its memory allocation.',
    fix: 'Check current usage: kubectl describe quota -n <team>\nOptions:\n  1. Reduce memory requests on existing apps\n  2. Scale down unused deployments\n  3. Ask platform admin to increase the namespace quota',
  },
  'quota-exceeded-pods': {
    what: 'Your namespace has reached the maximum number of pods (default: 20).',
    fix: 'Check current pod count: kubectl get pods -n <team> --no-headers | wc -l\nOptions:\n  1. Delete unused deployments\n  2. Reduce replica counts\n  3. Ask platform admin to increase pod quota',
  },
  'limitrange-violation': {
    what: 'Your container requests exceed the maximum allowed by the namespace LimitRange, or are below the minimum.',
    fix: 'Check limits: kubectl describe limitrange -n <team>\nDefaults: 100m-500m CPU, 128Mi-512Mi memory\nMax: 2 CPU, 4Gi memory per container\nMin: 50m CPU, 64Mi memory per container',
  },

  // ═══════════════════════════════════════════════
  // NETWORK POLICY
  // ═══════════════════════════════════════════════

  'networkpolicy-egress-blocked': {
    what: 'Your app\'s outbound traffic is being blocked by a NetworkPolicy. By default, only HTTPS (port 443), DNS, and same-namespace traffic is allowed.',
    fix: 'To call an external API on a non-443 port, add egress rules in your Helm values:\n  networkPolicy:\n    additionalEgress:\n      - to:\n          - ipBlock:\n              cidr: 0.0.0.0/0\n        ports:\n          - port: 8080\n            protocol: TCP\n\nAlso add an Istio ServiceEntry for external hosts (see externalServices in values).',
  },
  'networkpolicy-ingress-blocked': {
    what: 'Traffic to your app is being blocked. By default, only Istio gateway, monitoring, and same-namespace traffic can reach your pods.',
    fix: 'If another namespace needs to call your service, add ingress rules:\n  networkPolicy:\n    additionalIngress:\n      - from:\n          - namespaceSelector:\n              matchLabels:\n                kubernetes.io/metadata.name: <calling-namespace>\n        ports:\n          - port: 8080',
  },

  // ═══════════════════════════════════════════════
  // IMAGE / REGISTRY
  // ═══════════════════════════════════════════════

  'image-pull-backoff': {
    what: 'Kubernetes cannot pull your container image. The image may not exist, or credentials may be wrong.',
    fix: 'Check:\n  1. Image exists: docker pull <image> (locally)\n  2. Image is in Harbor: visit https://harbor.apps.sre.example.com and search\n  3. Tag is correct (no typos)\n  4. Harbor project is accessible to your namespace\n\nPush if missing:\n  docker tag my-app:v1 harbor.apps.sre.example.com/<team>/my-app:v1\n  docker push harbor.apps.sre.example.com/<team>/my-app:v1',
  },
  'image-not-scanned': {
    what: 'Your image has not been scanned for vulnerabilities by Trivy in Harbor.',
    fix: 'Harbor scans images automatically on push. If the scan hasn\'t completed:\n  1. Wait 2-3 minutes after pushing\n  2. Check in Harbor UI: Projects > <team> > <image> > Vulnerabilities\n  3. Trigger manual scan in Harbor if needed',
  },
};
```

2. Create a matcher function that parses Kubernetes error messages and maps them to knowledge base entries:

```javascript
function matchError(errorMessage, events = []) {
  const matches = [];

  // Kyverno policy violations
  const kyvernoMatch = errorMessage.match(/policy\s+(\S+)/i);
  if (kyvernoMatch && ERROR_KNOWLEDGE_BASE[kyvernoMatch[1]]) {
    matches.push({ ...ERROR_KNOWLEDGE_BASE[kyvernoMatch[1]], policy: kyvernoMatch[1] });
  }

  // Istio errors
  if (errorMessage.includes('503') && errorMessage.includes('upstream'))
    matches.push(ERROR_KNOWLEDGE_BASE['istio-503-no-healthy-upstream']);
  if (errorMessage.includes('RBAC: access denied') || errorMessage.includes('AuthorizationPolicy'))
    matches.push(ERROR_KNOWLEDGE_BASE['istio-authorization-denied']);

  // RBAC
  if (errorMessage.includes('forbidden') || errorMessage.includes('Forbidden'))
    matches.push(ERROR_KNOWLEDGE_BASE['forbidden-rbac']);

  // Quota
  if (errorMessage.includes('exceeded quota'))
    matches.push(ERROR_KNOWLEDGE_BASE[errorMessage.includes('cpu') ? 'quota-exceeded-cpu' : 'quota-exceeded-memory']);
  if (errorMessage.includes('pods') && errorMessage.includes('exceeded'))
    matches.push(ERROR_KNOWLEDGE_BASE['quota-exceeded-pods']);

  // Image
  if (errorMessage.includes('ImagePullBackOff') || errorMessage.includes('ErrImagePull'))
    matches.push(ERROR_KNOWLEDGE_BASE['image-pull-backoff']);

  // Network
  if (events.some(e => e.message?.includes('NetworkPolicy')))
    matches.push(ERROR_KNOWLEDGE_BASE['networkpolicy-egress-blocked']);

  return matches;
}
```

3. Wire this into:
   - **Task 1.4** (Kyverno denial display) — use knowledge base for fix text
   - **Task 1.5** (timeout replacement) — match the HelmRelease error against the knowledge base
   - **Task 2.2** (preflight dry-run) — match dry-run rejections against the knowledge base
   - **Task 2.4** (diagnostics panel) — `suggestedActions` generated from knowledge base matches
   - **Task 4.2** (gate fix guides) — knowledge base provides the "How to Fix" content

**Acceptance Criteria:**
- Knowledge base covers all 16 Kyverno policies with what/fix/dockerfile/helmValues guidance
- Knowledge base covers 5 Istio error scenarios
- Knowledge base covers 2 RBAC/permissions scenarios
- Knowledge base covers 4 resource quota/limit scenarios
- Knowledge base covers 2 NetworkPolicy scenarios
- Knowledge base covers 2 image/registry scenarios
- Matcher function parses real Kubernetes error messages and returns relevant entries
- Every error a developer can hit has a corresponding fix explanation
- Fix text includes specific commands, Dockerfile changes, or Helm values to set

---

## Phase 3: Make Post-Deploy Useful

### Task 3.1: Inline Log Viewer

**Problem:** "View Logs" opens Grafana Loki in a new tab with a namespace-level filter. The developer loses context and must manually filter to their specific app.

**Files to change:**
- Create `apps/dashboard/client/src/components/applications/LogViewer.tsx`
- `apps/dashboard/server.js` — enhance log endpoint

**Steps:**

1. Enhance the existing `GET /api/cluster/pods/:namespace/:name/logs` endpoint to support:
   - `?container=<name>` — specific container (default: first container)
   - `?tailLines=100` — number of lines
   - `?since=1h` — time-based filter
   - `?follow=true` — streaming via Server-Sent Events (SSE)

2. Create an inline `LogViewer` component (slide-out panel or modal):
   - Monospace font, dark background (terminal-style)
   - Auto-scroll to bottom with a toggle to pause
   - Search bar (client-side grep through loaded lines)
   - Container dropdown (for multi-container pods — main app + istio-proxy)
   - Time range selector: Last 15m, 1h, 6h, 24h
   - Download button (saves to .log file)
   - Level-based coloring: ERROR/FATAL lines in red, WARN in yellow
   - Line numbers

3. For SSE streaming (follow mode):
   ```javascript
   // Server
   app.get('/api/cluster/pods/:namespace/:name/logs/stream', (req, res) => {
     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache');
     res.setHeader('Connection', 'keep-alive');

     const logStream = k8sApi.readNamespacedPodLog(name, namespace, { follow: true });
     logStream.on('data', (chunk) => {
       res.write(`data: ${chunk.toString()}\n\n`);
     });
     req.on('close', () => logStream.destroy());
   });
   ```

4. Open the log viewer from:
   - App card "Logs" button (replaces Grafana redirect)
   - Diagnostics panel "View Full Logs" link
   - Applications tab action menu

**Acceptance Criteria:**
- Log viewer opens inline (no context switch to Grafana)
- Streaming (follow) mode shows new log lines in real-time
- Search, container filter, and time range all work
- ERROR lines highlighted in red
- Download button saves logs to file

---

### Task 3.2: App Actions (Scale, Restart, Update Image)

**Problem:** The Applications tab has "Delete" and "Rollback" but no way to scale, restart, or update an image. Developers must redeploy entirely or use kubectl.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`
- `apps/dashboard/server.js` — enhance/create endpoints

**Steps:**

1. **Restart**: Add a "Restart" button per app that calls:
   ```
   POST /api/cluster/deployments/:namespace/:name/restart
   ```
   This endpoint already exists in the server. Just wire a button to it.
   - Show toast: "Restarting my-app..."
   - Show toast on completion: "my-app restarted successfully"

2. **Scale**: Add a "Scale" button that opens a popover with a number input:
   ```
   Replicas: [  2  ] [- ] [+ ]  [Apply]
   ```
   Wire to:
   ```
   PATCH /api/cluster/deployments/:namespace/:name/scale
   Body: { replicas: 3 }
   ```
   This endpoint already exists in the server.

3. **Update Image**: Add an "Update Image" button that opens a modal:
   ```
   Current: harbor.apps.sre.example.com/team/app:v1.0.0
   New tag:  [v1.1.0                              ]

   [Check Image] → shows found/not-found (reuse Task 2.1)
   [Update]
   ```
   Create new server endpoint:
   ```
   PATCH /api/apps/:namespace/:name/image
   Body: { tag: "v1.1.0" }
   ```
   Server updates the HelmRelease values in Git (or patches directly if not GitOps).

4. All actions require `developers` or `sre-admins` group membership.

**Acceptance Criteria:**
- Restart, Scale, and Update Image buttons available on each app card
- Restart triggers rolling restart
- Scale adjusts replicas with immediate effect
- Update Image changes the tag (with image existence check)
- All actions show toast notifications on success/failure

---

### Task 3.3: Metrics Sparkline on App Cards

**Problem:** App cards show no performance data. A developer can't tell if their app is using too much memory or getting high request rates without leaving to Grafana.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`
- `apps/dashboard/server.js` — new metrics endpoint

**Steps:**

1. Create server endpoint: `GET /api/apps/:namespace/:name/metrics` that queries Prometheus:
   ```javascript
   // CPU usage (last hour, 5-minute intervals)
   const cpuQuery = `rate(container_cpu_usage_seconds_total{namespace="${ns}", pod=~"${name}-.*", container!="istio-proxy"}[5m])`;

   // Memory usage (last hour)
   const memQuery = `container_memory_working_set_bytes{namespace="${ns}", pod=~"${name}-.*", container!="istio-proxy"}`;

   // Request rate (from Istio, last hour)
   const reqQuery = `sum(rate(istio_requests_total{destination_workload="${name}", destination_workload_namespace="${ns}"}[5m]))`;
   ```

2. Return sparkline-friendly data (12 data points for last hour, 5-minute intervals):
   ```json
   {
     "cpu": { "current": "45m", "limit": "500m", "sparkline": [30, 35, 42, 45, 43, 40, 38, 41, 44, 45, 43, 45] },
     "memory": { "current": "89Mi", "limit": "512Mi", "sparkline": [80, 82, 85, 87, 88, 89, 89, 89, 89, 89, 89, 89] },
     "requests": { "current": "142 req/s", "sparkline": [120, 125, 130, 135, 140, 142, 138, 141, 143, 142, 140, 142] }
   }
   ```

3. Render tiny sparkline charts on each app card using an inline SVG (no chart library needed — just a polyline):
   ```
   ┌─────────────────────────────────────┐
   │ ● my-app                    Running │
   │   harbor.../my-app:v1.0.0          │
   │                                     │
   │   CPU  45m/500m   ▁▂▃▄▃▂▂▃▄▄▃▄    │
   │   MEM  89Mi/512Mi ▂▂▃▃▃▃▃▃▃▃▃▃    │
   │   REQ  142/s      ▃▃▄▄▅▅▄▅▅▅▄▅    │
   │                                     │
   │   https://my-app.apps.sre.example   │
   └─────────────────────────────────────┘
   ```

4. Fetch metrics lazily (only when app card is visible in viewport) to avoid hammering Prometheus.

5. Refresh every 30 seconds.

**Acceptance Criteria:**
- Each app card shows CPU, memory, and request rate sparklines
- Current values shown next to limits
- Sparklines cover last hour
- Lazy loading prevents excessive Prometheus queries

---

## Phase 4: Help Developers Who Don't Know K8s Security

### Task 4.1: Contextual Help Tooltips in DSOP Wizard

**Problem:** The DSOP wizard uses security terms (SAST, SBOM, CVE, FIPS 199, mTLS) without explanation. A developer who's never done security scanning doesn't know what "SAST gate failed" means or why they should care.

**Files to change:**
- `apps/dsop-wizard/src/components/steps/Step4_SecurityPipeline.tsx`
- `apps/dsop-wizard/src/components/pipeline/GateCard.tsx`
- `apps/dsop-wizard/src/components/steps/Step2_AppInfo.tsx`

**Steps:**

1. Create a `HelpTooltip` component:
   ```tsx
   function HelpTooltip({ term, children }: { term: string; children: React.ReactNode }) {
     return (
       <span className="group relative inline-flex items-center gap-1 cursor-help">
         {children}
         <HelpCircle className="w-3.5 h-3.5 text-gray-400" />
         <div className="invisible group-hover:visible absolute bottom-full left-0 mb-2 w-72 p-3 bg-gray-800 text-sm text-gray-200 rounded-lg shadow-lg z-50">
           {HELP_TEXT[term]}
         </div>
       </span>
     );
   }
   ```

2. Define help text for all security terms:
   ```typescript
   const HELP_TEXT: Record<string, string> = {
     'SAST': 'Static Application Security Testing. Scans your source code for security vulnerabilities like SQL injection, XSS, and hardcoded secrets — without running the code.',
     'Secrets': 'Scans your code for accidentally committed passwords, API keys, tokens, and other credentials that should never be in source control.',
     'SBOM': 'Software Bill of Materials. A list of every library and dependency in your container image. Used to track vulnerabilities and license compliance.',
     'CVE': 'Common Vulnerabilities and Exposures. Known security bugs in software libraries. Your container is scanned for these before deployment.',
     'DAST': 'Dynamic Application Security Testing. Tests your running application for vulnerabilities by sending real HTTP requests (like a hacker would).',
     'ISSM': 'Information System Security Manager. The person who reviews your security scan results and approves deployment. Required by RAISE 2.0.',
     'Cosign': 'A tool that cryptographically signs your container image, proving it came from your CI/CD pipeline and hasn\'t been tampered with.',
     'FIPS 199': 'Federal Information Processing Standard 199. Classifies your system by data sensitivity: Low, Moderate, or High for Confidentiality, Integrity, and Availability.',
     'mTLS': 'Mutual TLS. Encrypts all communication between services automatically. Both sides verify each other\'s identity. Handled by Istio — you don\'t need to configure it.',
     'Kyverno': 'A policy engine that enforces security rules on your deployment. If your container doesn\'t meet requirements (like running as non-root), Kyverno blocks it.',
     'PolicyException': 'A formal, time-limited waiver allowing your app to bypass a specific security policy. Requires ISSM approval and expires after 90 days.',
   };
   ```

3. Wrap security terms in the wizard with `HelpTooltip`:
   - Step 2: FIPS 199 section header, classification dropdown labels
   - Step 4: Each gate card header (SAST, Secrets, Build, SBOM, CVE, DAST, ISSM, Signing)
   - Step 4: Finding severity labels
   - Step 5: Security assessment summary terms

**Acceptance Criteria:**
- Hover any security term to see a plain-English explanation
- Tooltips cover all 11 key terms used in the wizard
- Tooltips don't block interaction (positioned to avoid overlapping buttons)
- Mobile: tooltips work on tap (not just hover)

---

### Task 4.2: "Why Did This Fail?" Guidance on Gate Cards

**Problem:** When a DSOP pipeline gate fails, the gate card shows the status (failed) and findings (table of issues), but doesn't explain what the developer should do about it. A Semgrep finding of "Possible SQL injection" means nothing to someone who doesn't know what SQL injection is.

**Files to change:**
- `apps/dsop-wizard/src/components/pipeline/GateCard.tsx`

**Steps:**

1. Add a "How to Fix" section that appears when a gate has failed or warning findings:

   ```typescript
   const GATE_FIX_GUIDES: Record<string, { overview: string; steps: string[] }> = {
     'SAST': {
       overview: 'Your code has potential security vulnerabilities. These were found by analyzing your source code.',
       steps: [
         'Review each finding — click to see the exact file and line number',
         'Fix the code issue (the description explains what\'s wrong)',
         'Common fixes: use parameterized queries (SQL injection), escape user input (XSS), don\'t log secrets',
         'Re-run the pipeline after fixing to verify'
       ]
     },
     'Secrets': {
       overview: 'Passwords, API keys, or tokens were found in your source code. These must be removed.',
       steps: [
         'Remove the secret from your code',
         'Store it in OpenBao (the platform\'s secrets manager) instead',
         'Add the file to .gitignore if it\'s a config file with secrets',
         'Rotate the exposed credential — it may have been compromised',
         'Use environment variables: reference secrets via `env.secretRef` in your Helm values'
       ]
     },
     'CVE': {
       overview: 'Your container image contains libraries with known security bugs.',
       steps: [
         'Update your base image to the latest patched version',
         'Run `npm audit fix` / `pip install --upgrade` / `go get -u` for your language',
         'If a fix isn\'t available, mark the finding as "accepted risk" with justification',
         'Critical CVEs must be fixed before deployment — High CVEs need a plan'
       ]
     },
     'Build': {
       overview: 'Your container image failed to build.',
       steps: [
         'Check the build log for the error (expand this gate for details)',
         'Common issues: missing files in COPY, wrong base image, npm install failures',
         'Test your build locally: docker build -t test .',
         'Ensure your Dockerfile doesn\'t require network access during build (Kaniko runs in-cluster)'
       ]
     },
   };
   ```

2. Show the guide below the findings table in the expanded gate card:
   ```
   ── How to Fix ──────────────────────────────────
   Your container image contains libraries with known security bugs.

   1. Update your base image to the latest patched version
   2. Run npm audit fix / pip install --upgrade for your language
   3. If no fix is available, mark as "accepted risk" with justification
   4. Critical CVEs must be fixed — High CVEs need a plan
   ```

3. For individual findings, if the scanner provides a fix suggestion (Semgrep and Trivy both can), show it inline:
   ```
   CVE-2024-1234 (CRITICAL) — openssl 3.0.2
   Fix available: Upgrade to openssl 3.0.15
   In Dockerfile: Change FROM alpine:3.18 to FROM alpine:3.19
   ```

**Acceptance Criteria:**
- Every failed gate shows a "How to Fix" guide with step-by-step instructions
- Guides are written for non-security-experts
- Individual findings show fix suggestions when available
- Guides cover all 8 gate types

---

### Task 4.3: Guided Dockerfile Fixer

**Problem:** The most common Kyverno rejections are: no USER directive (runs as root), no health check, and `:latest` tag. These are Dockerfile fixes, but the developer doesn't know how to make them. Instead of just telling them "fix your Dockerfile," show them exactly what to change.

**Files to change:**
- Create `apps/dashboard/client/src/components/deploy/DockerfileFixer.tsx`
- Wire from: compliance gate failure (Task 1.2), preflight check failure (Task 2.2), DSOP wizard gate failure

**Steps:**

1. Create a `DockerfileFixer` component that shows a before/after diff:

   ```
   ┌─────────────────────────────────────────────────────┐
   │ Dockerfile Fix Suggestions                          │
   │                                                     │
   │ Your container will be rejected because:            │
   │ • Runs as root (require-run-as-nonroot policy)      │
   │ • Uses :latest tag (disallow-latest-tag policy)     │
   │                                                     │
   │ Here's how to fix your Dockerfile:                  │
   │                                                     │
   │  FROM node:latest          →  FROM node:20-alpine   │
   │                                                     │
   │  WORKDIR /app                 WORKDIR /app          │
   │  COPY . .                     COPY . .              │
   │  RUN npm install              RUN npm install       │
   │                            +  RUN addgroup -S app   │
   │                            +    && adduser -S app   │
   │                            +  USER app              │
   │  EXPOSE 3000                  EXPOSE 3000           │
   │                            +  HEALTHCHECK CMD       │
   │                            +    wget -q --spider    │
   │                            +    http://localhost:3000│
   │                            +    || exit 1           │
   │  CMD ["node", "server.js"]    CMD ["node", ...]     │
   │                                                     │
   │ [Copy Fixed Dockerfile]                             │
   └─────────────────────────────────────────────────────┘
   ```

2. Generate the fix based on detected issues:
   - `:latest` → suggest the most common pinned version for that base image
   - No `USER` → add user creation + USER directive before CMD
   - No `HEALTHCHECK` → add a HEALTHCHECK based on the detected port

3. Include a "Copy Fixed Dockerfile" button that copies the corrected version to clipboard.

4. Show this component:
   - In the DSOP wizard when the Build gate fails or CVE gate finds `:latest` issues
   - In the Deploy tab when the preflight check detects Dockerfile issues (Task 2.3)
   - In the compliance gate failure panel (Task 1.2)

**Acceptance Criteria:**
- Before/after diff shown for Dockerfile issues
- Fixes generated for: `:latest`, missing USER, missing HEALTHCHECK
- "Copy Fixed Dockerfile" button works
- Shown in context when the relevant failure is detected

---

### Task 4.4: Common Issues Panel on Deploy Failure

**Problem:** When a deploy fails, the developer is stuck. There's no "here are the top 5 things that could be wrong" guide. They have to figure it out from scratch every time.

**Files to change:**
- `apps/dashboard/client/src/components/deploy/DeployTab.tsx` (or the progress indicator)

**Steps:**

1. When `DeployProgress` detects a failure (Task 1.5 — the enhanced timeout handler), show a "Common Issues" collapsible panel below the error:

   ```
   ⚠️ Deployment Failed: require-run-as-nonroot policy violation

   ── Common Issues & Fixes ──────────────────────────

   ❶ Container runs as root
      Your Dockerfile doesn't have a USER directive.
      Fix: Add "USER 1000" before CMD in your Dockerfile
      [Show Dockerfile Fix]

   ❷ Image not found
      The image tag doesn't exist in Harbor.
      Fix: Push your image first:
        docker push harbor.apps.sre.example.com/team/app:v1.0

   ❸ Image uses :latest tag
      Kyverno blocks :latest tags for security.
      Fix: Pin to a specific version: :v1.0.0

   ❹ No health check endpoint
      Your app needs /healthz and /readyz endpoints.
      Fix: Add a simple health route that returns 200

   ❺ Resource quota exceeded
      Your namespace is full.
      Fix: Scale down other apps or request a quota increase

   ── Still stuck? ───────────────────────────────────
   [Open Diagnostics Panel]  [View Troubleshooting Guide]
   ```

2. Highlight the specific issue that was detected (if known) — put it first in the list with a "This is likely your issue" marker.

3. The panel should be collapsible (expanded by default on failure, can be dismissed).

**Acceptance Criteria:**
- Common issues panel appears on any deploy failure
- Top 5 issues listed with specific fix instructions
- Detected issue highlighted/prioritized
- Links to diagnostics panel and troubleshooting docs

---

## Execution Order Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| **Phase 1** | 1.1-1.5 | Medium (React wiring + server enhancement) | CRITICAL — fix broken feedback loop |
| **Phase 2** | 2.1-2.4 | Medium (API endpoints + React components) | HIGH — prevent failures before they happen |
| **Phase 2.5** | 2.5 | Medium (error knowledge base) | CRITICAL — used by Phases 1, 2, 3, and 4 |
| **Phase 3** | 3.1-3.3 | Medium (log viewer + actions + metrics) | MEDIUM — make post-deploy useful |
| **Phase 4** | 4.1-4.4 | Medium (help text + guides + fixer) | MEDIUM — help non-K8s developers |

**Recommended execution:**
- **Task 2.5 first** — build the error knowledge base. It's referenced by Tasks 1.4, 1.5, 2.2, 2.4, 4.2, and 4.4. Everything uses it.
- **Phase 1 next** (wire toasts + show errors) — uses the knowledge base for fix text
- Phase 2.1 + 2.2 together (image check + policy dry-run)
- Phase 2.3 + 2.4 together (Dockerfile analysis + diagnostics panel)
- Phase 3 tasks are all independent
- Phase 4 tasks are all independent, but 4.3 (Dockerfile fixer) references 2.3 output

---

## Verification Checklist

After all phases are complete, verify:

**Silent Failure Fixes (Phase 1):**
- [ ] Quick Deploy shows toast on success AND failure (not console.error)
- [ ] Helm Deploy shows toast on success AND failure
- [ ] Database creation shows toast on success AND failure
- [ ] App delete shows toast on success AND failure (using modal, not window.confirm)
- [ ] Rollback shows toast on success AND failure
- [ ] No empty `catch {}` blocks remain in deploy-related components
- [ ] Compliance gate blockers shown in a visual panel with fix hints
- [ ] Failed app cards show red status with specific reason (CrashLoopBackOff, ImagePullBackOff, etc.)
- [ ] Kyverno denial messages shown on app cards with policy name, message, and fix instructions
- [ ] DeployProgress never shows "Timeout - check status manually" — always shows actual failure reason

**Pre-Flight Checks (Phase 2):**
- [ ] Image existence checked on field blur with found/not-found indicator
- [ ] Deploy button disabled when image not found
- [ ] Kyverno dry-run catches policy violations before deploy
- [ ] Resource quota availability shown in preflight results
- [ ] Dockerfile analyzed for :latest, missing USER, missing HEALTHCHECK before build
- [ ] App diagnostics panel shows pods, events, logs, resources, probes, and suggested actions in one view

**Error Knowledge Base (Phase 2.5):**
- [ ] All 16 Kyverno policies have what/fix/dockerfile/helmValues entries
- [ ] 5 Istio error scenarios covered (sidecar injection, upstream connect, 503, authz denied, mTLS)
- [ ] RBAC forbidden errors covered with Keycloak group explanation
- [ ] Resource quota exceeded errors covered (CPU, memory, pods) with kubectl commands
- [ ] NetworkPolicy blocked errors covered (egress and ingress) with Helm values fix
- [ ] Image pull errors covered with push/tag instructions
- [ ] Matcher function correctly parses real Kubernetes error messages into knowledge base entries
- [ ] Knowledge base wired into diagnostics panel, deploy error handler, gate fix guides, and preflight results

**Post-Deploy (Phase 3):**
- [ ] Log viewer opens inline with streaming, search, container filter, and time range
- [ ] Restart, Scale, and Update Image buttons work on app cards
- [ ] Metrics sparklines (CPU, memory, requests) shown on each app card

**Developer Help (Phase 4):**
- [ ] Hover any security term (SAST, CVE, SBOM, etc.) for plain-English tooltip
- [ ] Every failed gate shows "How to Fix" guide with step-by-step instructions
- [ ] Dockerfile fixer shows before/after diff with copy button
- [ ] Common issues panel appears on deploy failure with top 5 fixes
