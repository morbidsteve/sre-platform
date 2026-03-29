# Developer UX Cleanup Plan

The developer-ux-fix-plan shipped successfully — silent failures are fixed, pre-flight checks work, the error knowledge base covers 30+ scenarios, and diagnostics are full-featured. This plan addresses the 6 remaining gaps.

---

## Task 1: Serve Error Knowledge Base to Frontend as Single Source of Truth

**Problem:** `error-knowledge-base.js` on the server has 852 lines covering 30+ policies with detailed fixes. But `DeployProgress.tsx` and `ApplicationsTab.tsx` each maintain their own hardcoded subsets (~10 policies each). These copies are already out of sync — the server knows about `disallow-host-namespaces`, `restrict-unsafe-sysctls`, and Istio errors that the client doesn't. Adding a new policy to the knowledge base won't surface in the UI.

**Files to change:**
- `apps/dashboard/server.js` — new endpoint
- `apps/dashboard/client/src/components/applications/DeployProgress.tsx` — remove hardcoded `POLICY_FIXES`
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx` — remove hardcoded `POLICY_FIXES`

**Steps:**

1. Create server endpoint: `GET /api/knowledge-base`
   ```javascript
   const { ERROR_KNOWLEDGE_BASE, POLICY_FIXES, matchError } = require('./error-knowledge-base');

   app.get('/api/knowledge-base', (req, res) => {
     res.json({
       policies: POLICY_FIXES,         // Quick one-liner fixes per policy name
       detailed: ERROR_KNOWLEDGE_BASE,  // Full what/fix/dockerfile/helmValues per scenario
     });
   });
   ```

2. Create a React context or hook that fetches the knowledge base once on app boot:
   ```typescript
   // client/src/hooks/useKnowledgeBase.ts
   const [kb, setKb] = useState<KnowledgeBase | null>(null);

   useEffect(() => {
     fetch('/api/knowledge-base').then(r => r.json()).then(setKb);
   }, []);
   ```

3. In `DeployProgress.tsx`, remove the hardcoded `POLICY_FIXES` object (around lines 5-17) and replace with:
   ```typescript
   const { kb } = useKnowledgeBase();
   const policyFix = kb?.policies[policyName] || 'Check the policy documentation for fix guidance.';
   ```

4. In `ApplicationsTab.tsx`, remove the hardcoded `POLICY_FIXES` object (around lines 13-28) and replace the same way.

5. In `AppDiagnostics.tsx`, if it has its own hardcoded fixes, replace those too.

6. Delete all inline `POLICY_FIXES` / `policyFix` constants from client components — the knowledge base endpoint is the single source.

**Acceptance Criteria:**
- `/api/knowledge-base` endpoint returns the full knowledge base
- All client components consume from the hook, not hardcoded objects
- Zero duplicate `POLICY_FIXES` definitions in client code
- Adding a new policy to `error-knowledge-base.js` automatically surfaces in the UI

---

## Task 2: Dockerfile Auto-Fixer with Before/After Diff

**Problem:** The Dockerfile lint (`/api/build/lint-dockerfile`) catches issues and the gate guides explain fixes, but the developer still has to manually edit their Dockerfile. A before/after diff with a "Copy Fixed Dockerfile" button would close the loop — especially for the most common rejections (`:latest`, no USER, no HEALTHCHECK).

**Files to create/change:**
- Create `apps/dashboard/client/src/components/deploy/DockerfileFixer.tsx`
- `apps/dashboard/server.js` — enhance lint endpoint to return fixed version
- Wire from: DSOP wizard Build gate failure, Deploy from Git lint results

**Steps:**

1. Enhance the server's `lintDockerfile()` function to also return a fixed version:
   ```javascript
   function lintDockerfile(content) {
     const issues = []; // existing lint logic
     let fixed = content;

     // Fix :latest tags
     fixed = fixed.replace(/^(FROM\s+\S+):latest(\s|$)/gm, (match, image, trail) => {
       // Suggest common pinned versions
       const pins = {
         'node': 'node:20-alpine',
         'python': 'python:3.12-slim',
         'golang': 'golang:1.22-alpine',
         'nginx': 'nginx:1.27-alpine',
         'alpine': 'alpine:3.20',
         'ubuntu': 'ubuntu:24.04',
       };
       const baseName = image.replace('FROM ', '').split('/').pop();
       const pinned = pins[baseName] || `${image}:<pin-a-version>`;
       return `FROM ${pinned}${trail}`;
     });

     // Add USER if missing
     if (!/^USER\s+/m.test(fixed)) {
       // Insert before CMD or ENTRYPOINT
       const cmdMatch = fixed.match(/^(CMD|ENTRYPOINT)\s+/m);
       if (cmdMatch) {
         const idx = fixed.indexOf(cmdMatch[0]);
         fixed = fixed.slice(0, idx) +
           '# Run as non-root user (required by platform policy)\n' +
           'RUN addgroup -S appgroup && adduser -S appuser -G appgroup\n' +
           'USER appuser\n\n' +
           fixed.slice(idx);
       } else {
         fixed += '\n# Run as non-root user (required by platform policy)\nRUN addgroup -S appgroup && adduser -S appuser -G appgroup\nUSER appuser\n';
       }
     }

     // Add HEALTHCHECK if missing and port is detectable
     if (!/^HEALTHCHECK\s+/m.test(fixed)) {
       const exposeMatch = fixed.match(/^EXPOSE\s+(\d+)/m);
       const port = exposeMatch ? exposeMatch[1] : '8080';
       fixed += `\n# Health check for liveness/readiness probes\nHEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\\n  CMD wget -qO- http://localhost:${port}/healthz || exit 1\n`;
     }

     return { issues, original: content, fixed, hasChanges: content !== fixed };
   }
   ```

2. Update `/api/build/lint-dockerfile` to return `{ issues, original, fixed, hasChanges }`.

3. Create the `DockerfileFixer` component:
   ```tsx
   // Shows side-by-side or unified diff
   // Left: original (red highlights on problem lines)
   // Right: fixed (green highlights on changed lines)
   // "Copy Fixed Dockerfile" button at bottom
   // "Apply to Git" button if Deploy from Git (future: commits the fix)
   ```

   Use a simple line-by-line diff — no external diff library needed. Color original lines red, new lines green, unchanged lines gray.

4. Show the fixer:
   - In the DSOP wizard: when the Build gate has Dockerfile lint issues, show a "Fix Dockerfile" expandable below the gate card that renders `DockerfileFixer`
   - In Deploy from Git: after the analysis phase detects Dockerfile issues, show the fixer before starting the build
   - In the Deploy tab: if preflight check detects that the image was built from a `:latest` base, suggest the fixer

5. The "Copy Fixed Dockerfile" button copies the fixed content to clipboard with a toast confirmation.

**Acceptance Criteria:**
- Server returns both original and fixed Dockerfile from lint endpoint
- `DockerfileFixer` component shows before/after with color-coded diff
- Fixes applied for: `:latest` tag, missing USER, missing HEALTHCHECK
- "Copy Fixed Dockerfile" button works
- Component shown in DSOP wizard Build gate and Deploy from Git flow

---

## Task 3: Post-Deploy Health Monitoring in DSOP Wizard Step 7

**Problem:** After "Deployment Successful," the wizard shows links but doesn't check if the app actually stays running. If it crashes 30 seconds later (OOMKilled, bad entrypoint, misconfigured probe), the developer already closed the wizard.

**Files to change:**
- `apps/dsop-wizard/src/components/steps/Step7_Complete.tsx`

**Steps:**

1. After deployment completes, start polling the app's health for 2 minutes:
   ```typescript
   const [healthStatus, setHealthStatus] = useState<'checking' | 'healthy' | 'degraded' | 'failed'>('checking');
   const [healthDetail, setHealthDetail] = useState<string>('');

   useEffect(() => {
     if (!wizard.deployedUrl || !wizard.appInfo) return;
     const namespace = wizard.appInfo.team;
     const appName = wizard.appInfo.name;

     const interval = setInterval(async () => {
       try {
         const resp = await apiFetch(`/api/deploy/${namespace}/${appName}/status`);
         const data = await resp.json();

         if (data.pods?.every(p => p.phase === 'Running' && p.containers?.every(c => c.ready))) {
           setHealthStatus('healthy');
           clearInterval(interval);
         } else if (data.pods?.some(p => p.containers?.some(c => c.reason === 'CrashLoopBackOff' || c.reason === 'OOMKilled'))) {
           setHealthStatus('failed');
           setHealthDetail(data.pods.find(p => p.containers?.some(c => c.reason))?.containers?.[0]?.reason || 'Pod failed');
           clearInterval(interval);
         } else {
           setHealthStatus('checking');
         }
       } catch { /* keep polling */ }
     }, 5000);

     // Stop after 2 minutes
     const timeout = setTimeout(() => {
       clearInterval(interval);
       if (healthStatus === 'checking') setHealthStatus('healthy'); // Assume healthy if no failure detected
     }, 120000);

     return () => { clearInterval(interval); clearTimeout(timeout); };
   }, [wizard.deployedUrl]);
   ```

2. Show health status below the success message:
   ```
   ✅ Deployment Successful
   Your app is live at https://my-app.apps.sre.example.com

   ── Health Check ──────────────────────────────
   🔄 Checking pod health... (pods starting)      ← checking
   ✅ All pods healthy (2/2 running)               ← healthy
   ❌ Pod failing: CrashLoopBackOff                ← failed
      Your app is crashing on startup.
      [Open Diagnostics]  [View Logs]
   ```

3. If health is `failed`, show:
   - The specific failure reason
   - A "Open Diagnostics" button linking to the dashboard's AppDiagnostics panel
   - A "View Logs" button linking to the inline log viewer
   - Keep the "Deploy Another App" and "Back to Dashboard" buttons visible

4. If health is `healthy` after 30 seconds, collapse the health section to a single green line.

**Acceptance Criteria:**
- Step 7 polls pod health for up to 2 minutes after deploy
- Healthy status shown with green indicator
- Failed status shown with reason + links to diagnostics and logs
- Health check doesn't block the user (they can navigate away at any time)

---

## Task 4: Metrics Sparklines on App Cards

**Problem:** App cards show status and failure reasons but no performance data. A developer can't tell if their app is CPU-starved, leaking memory, or getting hammered with requests without leaving to Grafana.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`
- `apps/dashboard/server.js` — new endpoint

**Steps:**

1. Create server endpoint: `GET /api/apps/:namespace/:name/metrics`
   ```javascript
   app.get('/api/apps/:namespace/:name/metrics', async (req, res) => {
     const { namespace, name } = req.params;
     try {
       // Query Prometheus for last hour, 5-minute intervals (12 data points)
       const cpuQuery = `sum(rate(container_cpu_usage_seconds_total{namespace="${namespace}",pod=~"${name}-.*",container!="istio-proxy",container!="POD",container!=""}[5m]))`;
       const memQuery = `sum(container_memory_working_set_bytes{namespace="${namespace}",pod=~"${name}-.*",container!="istio-proxy",container!="POD",container!=""})`;
       const reqQuery = `sum(rate(istio_requests_total{destination_workload="${name}",destination_workload_namespace="${namespace}"}[5m]))`;

       const [cpuData, memData, reqData] = await Promise.all([
         queryPrometheusRange(cpuQuery, '1h', '5m'),
         queryPrometheusRange(memQuery, '1h', '5m'),
         queryPrometheusRange(reqQuery, '1h', '5m'),
       ]);

       res.json({
         cpu: {
           current: formatCPU(cpuData.current),
           sparkline: cpuData.values,
         },
         memory: {
           current: formatMemory(memData.current),
           sparkline: memData.values,
         },
         requests: {
           current: reqData.current ? `${Math.round(reqData.current)} req/s` : null,
           sparkline: reqData.values,
         },
       });
     } catch {
       res.json({ cpu: null, memory: null, requests: null });
     }
   });
   ```

2. Add a `Sparkline` component (pure SVG, no library):
   ```tsx
   function Sparkline({ data, color = '#22d3ee', width = 80, height = 20 }: {
     data: number[]; color?: string; width?: number; height?: number;
   }) {
     if (!data || data.length < 2) return null;
     const max = Math.max(...data);
     const min = Math.min(...data);
     const range = max - min || 1;
     const points = data.map((v, i) =>
       `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
     ).join(' ');

     return (
       <svg width={width} height={height} className="inline-block">
         <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
       </svg>
     );
   }
   ```

3. On each app card, show metrics below the status:
   ```
   ┌─────────────────────────────────────┐
   │ ● my-app                    Running │
   │   harbor.../my-app:v1.0.0          │
   │                                     │
   │   CPU  45m   ▁▂▃▄▃▂▂▃▄▄▃▄         │
   │   MEM  89Mi  ▂▂▃▃▃▃▃▃▃▃▃▃         │
   │   REQ  142/s ▃▃▄▄▅▅▄▅▅▅▄▅         │
   │                                     │
   │   https://my-app.apps.sre.example   │
   └─────────────────────────────────────┘
   ```

4. Fetch metrics lazily — only for app cards visible in the viewport. Use `IntersectionObserver`:
   ```typescript
   const [metricsVisible, setMetricsVisible] = useState(false);
   const cardRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
     const observer = new IntersectionObserver(([entry]) => {
       if (entry.isIntersecting) setMetricsVisible(true);
     }, { threshold: 0.1 });
     if (cardRef.current) observer.observe(cardRef.current);
     return () => observer.disconnect();
   }, []);
   ```

5. Refresh metrics every 30 seconds for visible cards only.

6. If Prometheus is unreachable or metrics are empty, don't show the metrics section (graceful degradation, no error).

**Acceptance Criteria:**
- Each app card shows CPU, memory, and request rate sparklines
- Data covers last hour with 5-minute intervals
- Lazy loading (only fetch for visible cards)
- Graceful degradation if Prometheus is unavailable
- SVG sparkline is lightweight (no chart library)

---

## Task 5: Scale and Update Image from Applications Tab

**Problem:** Developers can restart and delete apps but can't scale replicas or update the image tag without redeploying. The backend endpoints for scale already exist (`PATCH /api/cluster/deployments/:namespace/:name/scale`) but aren't wired to the UI.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`
- `apps/dashboard/server.js` — new endpoint for image update

**Steps:**

1. **Scale button:** Add a "Scale" action per app card that opens a small popover:
   ```tsx
   <Popover>
     <PopoverTrigger>
       <button title="Scale"><ArrowUpDown className="w-4 h-4" /></button>
     </PopoverTrigger>
     <PopoverContent>
       <div className="flex items-center gap-2">
         <label className="text-sm">Replicas:</label>
         <button onClick={() => setReplicas(r => Math.max(1, r - 1))}>-</button>
         <span className="w-8 text-center">{replicas}</span>
         <button onClick={() => setReplicas(r => r + 1)}>+</button>
         <button onClick={handleScale} className="ml-2 px-3 py-1 bg-cyan-600 rounded text-sm">Apply</button>
       </div>
     </PopoverContent>
   </Popover>
   ```

   Wire `handleScale` to the existing endpoint:
   ```typescript
   async function handleScale() {
     const resp = await fetch(`/api/cluster/deployments/${namespace}/${name}/scale`, {
       method: 'PATCH',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ replicas }),
     });
     if (resp.ok) {
       showToast(`Scaled ${name} to ${replicas} replicas`, 'success');
     } else {
       showToast(`Scale failed: ${(await resp.json()).error}`, 'error');
     }
   }
   ```

2. **Update Image button:** Add an "Update" action that opens a modal:
   ```tsx
   // Modal content:
   <div>
     <p className="text-sm text-gray-400 mb-2">
       Current: {app.image}:{app.tag}
     </p>
     <label className="text-sm">New tag:</label>
     <div className="flex gap-2">
       <input
         value={newTag}
         onChange={e => setNewTag(e.target.value)}
         placeholder="v1.1.0"
         className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1"
       />
       <button onClick={checkImage} disabled={!newTag}>Check</button>
     </div>
     {imageStatus === 'found' && <p className="text-green-400 text-sm mt-1">Image found in Harbor</p>}
     {imageStatus === 'not_found' && <p className="text-red-400 text-sm mt-1">Image not found — push it first</p>}
     <button onClick={handleUpdateImage} disabled={imageStatus !== 'found'}>
       Update Image
     </button>
   </div>
   ```

3. Create server endpoint for image update: `PATCH /api/apps/:namespace/:name/image`
   ```javascript
   app.patch('/api/apps/:namespace/:name/image', requireGroups('sre-admins', 'developers'), async (req, res) => {
     const { namespace, name } = req.params;
     const { tag } = req.body;
     if (!tag) return res.status(400).json({ error: 'tag is required' });

     // Get the HelmRelease
     const hr = await getHelmRelease(namespace, name);
     if (!hr) return res.status(404).json({ error: 'App not found' });

     // Update the image tag in the HelmRelease values
     const values = hr.spec.values || {};
     if (values.app?.image?.tag) {
       values.app.image.tag = tag;
     }

     // Patch the HelmRelease
     await patchHelmRelease(namespace, name, { spec: { values } });

     // Audit log
     auditLog('app.image_updated', req.user, `${namespace}/${name}`, { from: hr.spec.values?.app?.image?.tag, to: tag });

     res.json({ success: true, message: `Updated ${name} to tag ${tag}` });
   });
   ```

4. The "Check" button reuses the `/api/registry/check` endpoint (Task 2.1 from the original plan, already implemented).

5. Both actions require `developers` or `sre-admins` group.

**Acceptance Criteria:**
- Scale button opens popover with +/- controls and Apply
- Update Image opens modal with tag input and image existence check
- Deploy button disabled until image confirmed in Harbor
- Both actions show toast on success/failure
- Both actions logged in audit trail

---

## Task 6: Quick-Access Log Viewer Button

**Problem:** The `LogViewer` component exists inside `AppDiagnostics`, but developers shouldn't need to open the full diagnostics panel just to see logs. The "Logs" button on app cards should open the log viewer directly, not redirect to Grafana.

**Files to change:**
- `apps/dashboard/client/src/components/applications/ApplicationsTab.tsx`

**Steps:**

1. Check what the current "Logs" button does on app cards. If it opens Grafana in a new tab, change it to open the inline `LogViewer` in a modal or slide-out panel.

2. If `LogViewer` is tightly coupled to `AppDiagnostics`, extract it into its own standalone component that can be opened independently:
   ```tsx
   function StandaloneLogViewer({ namespace, podName, onClose }: Props) {
     // Reuses the same log-fetching logic from AppDiagnostics
     // But renders in a full-width modal or slide-out
     // Includes: container selector, search, time range, follow mode, download
   }
   ```

3. Wire the app card "Logs" button to open `StandaloneLogViewer`:
   ```tsx
   <button onClick={() => setLogViewerApp(app)} title="View Logs">
     <BarChart3 className="w-4 h-4" />
   </button>

   {logViewerApp && (
     <StandaloneLogViewer
       namespace={logViewerApp.namespace}
       podName={logViewerApp.name}
       onClose={() => setLogViewerApp(null)}
     />
   )}
   ```

4. Keep a secondary "Open in Grafana" link inside the log viewer for developers who want the full Loki experience.

**Acceptance Criteria:**
- "Logs" button on app cards opens inline log viewer (not Grafana redirect)
- Log viewer works standalone (not only inside diagnostics panel)
- Container selector, search, and time range all work
- "Open in Grafana" link available for power users

---

## Execution Order

All 6 tasks are independent — they can be done in parallel or in any order.

**Recommended priority:**
1. **Task 1** (knowledge base API) — small effort, eliminates tech debt and prevents future drift
2. **Task 3** (post-deploy health) — catches crashes that happen right after deploy
3. **Task 6** (log viewer button) — most-requested action, should be one click
4. **Task 5** (scale + update image) — common operations, backend already exists
5. **Task 4** (metrics sparklines) — nice to have, adds visibility
6. **Task 2** (Dockerfile fixer) — useful but the lint + gate guides already cover most of the guidance

---

## Verification Checklist

- [ ] `/api/knowledge-base` endpoint returns full error knowledge base
- [ ] Zero hardcoded `POLICY_FIXES` objects in client components
- [ ] Dockerfile fixer shows before/after diff with copy button
- [ ] DSOP wizard Step 7 shows pod health status for 2 minutes after deploy
- [ ] CrashLoopBackOff detected in Step 7 with link to diagnostics
- [ ] App cards show CPU/memory/request sparklines (lazy loaded)
- [ ] Scale button works with +/- controls
- [ ] Update Image button checks Harbor before allowing update
- [ ] "Logs" button opens inline viewer, not Grafana redirect
- [ ] All actions show toast notifications
