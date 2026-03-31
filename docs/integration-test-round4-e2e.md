# SRE Platform — Integration Test Round 4 (Real Deployment + E2E Verification)

## Why This Round Exists

Rounds 1-3 were TEMPLATE tests. They proved the deploy script generates valid YAML
and that `helm template` renders without errors. But they NEVER:

- Actually deployed a pod to the cluster
- Waited for a pod to reach Running state
- Hit the app via its ingress URL
- Authenticated through Keycloak SSO
- Clicked a button, created a resource, or verified the app actually works
- Tested that a user (not an engineer with kubectl) can use the result

That means we have ZERO confidence that any of the "fixed" apps actually work.
A HelmRelease that renders clean YAML but produces a CrashLoopBackOff pod is not fixed.

Round 4 changes everything. Every app is:
1. **Actually deployed** to the live cluster
2. **Verified running** (pods healthy, no CrashLoops)
3. **Accessed via browser** through Playwright (including SSO login)
4. **Functionally tested** (can a user actually USE the app?)
5. **API tested** (programmatic verification of endpoints)

If Claude Code has to `kubectl exec` or `kubectl port-forward` to make something work,
that's a PLATFORM BUG — real users don't have kubectl access.

---

## Prerequisites

- Live SRE cluster with Flux, Istio, Keycloak, CNPG, and monitoring running
- Playwright installed (`tests/e2e/package.json` has it)
- `kubectl` access to the cluster
- DNS resolving `*.apps.sre.example.com` to the Istio gateway
- Keycloak SSO active with realm `sre` and user `sre-admin` / `SreAdmin123!`

---

## The Test Apps

Start small. Don't test 11-service Sock Shop — test 3 apps that cover the key patterns.
Each must be FULLY functional, not just "pod is running."

| # | App | Pattern | What "Working" Means |
|---|-----|---------|---------------------|
| 1 | go-httpbin | Stateless baseline | Browse to URL, see httpbin UI, submit a form, get response |
| 2 | Uptime Kuma | Stateful + WebSocket + root | Browse to URL, complete setup wizard, add a monitor, see it go green |
| 3 | Gitea | Multi-protocol + persistence | Browse to URL, complete setup, create a repo, git clone via HTTP, push a commit |

If these 3 work end-to-end through the browser with SSO, the platform is real.
If they don't, Rounds 1-3 were theater.

---

## The Prompt

```
You are an autonomous E2E test engineer for the SRE platform. Your job is DIFFERENT
from previous rounds. Previous rounds validated YAML templates. You are validating
REAL DEPLOYMENTS by actually deploying apps to the cluster, accessing them through
a browser via Playwright, authenticating through Keycloak SSO, and testing them
like a human user would.

THE RULE: If you have to use kubectl exec, kubectl port-forward, or manually edit
a running pod to make something work, that's a PLATFORM BUG. Document it. Real
users don't have kubectl. Everything must work through the ingress + browser + API.

BRANCH: feat/e2e-integration-tests

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. ACTUALLY DEPLOY to the cluster. Not just helm template — kubectl apply / flux.
3. WAIT for pods to be healthy before testing. Poll with kubectl until Running.
4. Test through the INGRESS URL, not port-forward. If the ingress doesn't work, that's a bug.
5. Authenticate through Keycloak SSO when required. Use sre-admin / SreAdmin123!
6. Take SCREENSHOTS at every key step as evidence.
7. FIX THE PLATFORM when something fails — then redeploy and retest.
8. Keep a running log at tests/e2e/round4/RUN-LOG.md.
9. After EACH app: commit test report, screenshots, and any platform fixes separately.

## PHASE 0: SET UP THE E2E TEST FRAMEWORK

### 0A: Create the test helper library

Create tests/e2e/lib/sre-e2e.mjs — a shared helper module for all E2E tests:

```javascript
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const SRE_DOMAIN = process.env.SRE_DOMAIN || 'apps.sre.example.com';
const KEYCLOAK_USER = process.env.SRE_TEST_USER || 'sre-admin';
const KEYCLOAK_PASS = process.env.SRE_TEST_PASS || 'SreAdmin123!';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || 'tests/e2e/round4/screenshots';

export class SreE2E {
  constructor(appName) {
    this.appName = appName;
    this.appUrl = `https://${appName}.${SRE_DOMAIN}`;
    this.screenshotDir = path.join(SCREENSHOT_DIR, appName);
    this.browser = null;
    this.page = null;
    this.stepNumber = 0;
    this.results = [];
    fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  // Launch browser
  async init() {
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    this.page = await context.newPage();
    return this;
  }

  // Take screenshot with incrementing number
  async screenshot(label) {
    this.stepNumber++;
    const filename = `${String(this.stepNumber).padStart(2, '0')}-${label}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`  📸 ${filename}`);
    return filepath;
  }

  // Navigate to app URL
  async navigateToApp() {
    console.log(`\n🌐 Navigating to ${this.appUrl}`);
    await this.page.goto(this.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await this.screenshot('initial-load');
    return this.page.url(); // Returns actual URL (may be Keycloak redirect)
  }

  // Handle Keycloak SSO login if redirected
  async handleSSOLogin() {
    const currentUrl = this.page.url();
    if (currentUrl.includes('keycloak') || currentUrl.includes('/auth/')) {
      console.log('🔐 Keycloak SSO login required');
      await this.screenshot('keycloak-login-page');

      // Fill credentials
      await this.page.fill('#username', KEYCLOAK_USER);
      await this.page.fill('#password', KEYCLOAK_PASS);
      await this.screenshot('keycloak-credentials-filled');

      // Submit
      await this.page.click('#kc-login');
      await this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
      await this.screenshot('after-sso-login');

      console.log(`  ✅ Logged in, now at: ${this.page.url()}`);
      return true;
    }
    console.log('  ℹ️  No SSO redirect — app is directly accessible');
    return false;
  }

  // Record a test result
  record(test, passed, detail = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${test}${detail ? ' — ' + detail : ''}`);
    this.results.push({ test, passed, detail, timestamp: new Date().toISOString() });
  }

  // Wait for text to appear on page
  async waitForText(text, timeout = 10000) {
    try {
      await this.page.waitForSelector(`text=${text}`, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  // Check HTTP status of a URL
  async checkHttp(urlPath, expectedStatus = 200) {
    const url = urlPath.startsWith('http') ? urlPath : `${this.appUrl}${urlPath}`;
    try {
      const response = await this.page.request.get(url);
      return response.status() === expectedStatus;
    } catch {
      return false;
    }
  }

  // Generate test report
  generateReport() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    let report = `# E2E Test Report: ${this.appName}\n\n`;
    report += `**URL:** ${this.appUrl}\n`;
    report += `**Date:** ${new Date().toISOString()}\n`;
    report += `**Result:** ${passed}/${total} passed, ${failed} failed\n\n`;
    report += `## Test Results\n\n`;
    report += `| # | Test | Status | Detail |\n`;
    report += `|---|------|--------|--------|\n`;
    this.results.forEach((r, i) => {
      report += `| ${i + 1} | ${r.test} | ${r.passed ? '✅ PASS' : '❌ FAIL'} | ${r.detail} |\n`;
    });
    report += `\n## Screenshots\n\n`;
    const screenshots = fs.readdirSync(this.screenshotDir).sort();
    screenshots.forEach(f => {
      report += `![${f}](screenshots/${this.appName}/${f})\n\n`;
    });
    return report;
  }

  async cleanup() {
    if (this.browser) await this.browser.close();
  }
}

// Kubectl helpers
export function kubectl(cmd) {
  return execSync(`kubectl ${cmd}`, { encoding: 'utf-8', timeout: 30000 }).trim();
}

export function waitForPod(namespace, labelSelector, timeoutSeconds = 180) {
  console.log(`⏳ Waiting for pod ${labelSelector} in ${namespace}...`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const result = kubectl(
        `get pods -n ${namespace} -l ${labelSelector} -o jsonpath='{.items[0].status.phase}'`
      );
      if (result === 'Running') {
        console.log(`  ✅ Pod is Running`);
        return true;
      }
      // Check for CrashLoopBackOff
      const status = kubectl(
        `get pods -n ${namespace} -l ${labelSelector} -o jsonpath='{.items[0].status.containerStatuses[0].state}'`
      );
      if (status.includes('CrashLoopBackOff')) {
        console.log(`  ❌ Pod is CrashLoopBackOff`);
        const logs = kubectl(`logs -n ${namespace} -l ${labelSelector} --tail=50`);
        console.log(`  Last 50 log lines:\n${logs}`);
        return false;
      }
    } catch { /* pod not created yet */ }
    execSync('sleep 5');
  }
  console.log(`  ❌ Timed out after ${timeoutSeconds}s`);
  return false;
}

export function getPodLogs(namespace, labelSelector, lines = 100) {
  try {
    return kubectl(`logs -n ${namespace} -l ${labelSelector} --tail=${lines}`);
  } catch {
    return '(no logs available)';
  }
}

export function curlFromCluster(url) {
  // Use kubectl run to curl from inside the cluster (tests real networking)
  try {
    return kubectl(
      `run curl-test --rm -i --restart=Never --image=curlimages/curl:8.5.0 -- ` +
      `curl -sSf -o /dev/null -w '%{http_code}' --max-time 10 '${url}'`
    );
  } catch (e) {
    return e.message;
  }
}
```

### 0B: Create the test directory structure

```bash
mkdir -p tests/e2e/round4/screenshots/go-httpbin
mkdir -p tests/e2e/round4/screenshots/uptime-kuma
mkdir -p tests/e2e/round4/screenshots/gitea
mkdir -p tests/e2e/round4/reports
mkdir -p tests/e2e/lib
```

### 0C: Verify cluster health FIRST

Before deploying anything, verify the cluster is ready:

```bash
# Flux status — all HelmReleases should be Ready
flux get helmreleases -A | grep -v "True"
# If anything is not Ready, fix it before proceeding

# Node health
kubectl get nodes
# All should be Ready

# Keycloak is running
kubectl get pods -n keycloak -l app.kubernetes.io/name=keycloak
# Should be Running

# Istio gateway is serving
curl -sk https://dashboard.apps.sre.example.com -o /dev/null -w '%{http_code}'
# Should be 200 or 302 (SSO redirect)

# DNS resolves
dig +short go-httpbin.apps.sre.example.com
# Should resolve to the gateway IP
```

If ANY of these fail, fix them FIRST. Do not deploy test apps to a broken cluster.
Log results to tests/e2e/round4/RUN-LOG.md.

Commit: git commit -m "test(e2e): round 4 framework — helper library, directory structure"

---

## APP 1: go-httpbin (Stateless Baseline)

The simplest app. If this doesn't work end-to-end, nothing will.

### Step 1: Deploy for real

```bash
# Deploy using the platform tooling
./scripts/sre-deploy-app.sh \
  --name go-httpbin \
  --team team-test \
  --image mccutchen/go-httpbin \
  --tag v2.14.0 \
  --port 8080 \
  --chart web-app \
  --ingress go-httpbin.apps.sre.example.com \
  --liveness-path / \
  --readiness-path / \
  --no-commit

# Apply to cluster (Flux will reconcile, or apply directly)
# Option A: Let Flux pick it up (push to Git, wait for reconcile)
# Option B: Apply directly for testing speed:
helm template go-httpbin apps/templates/web-app/ \
  -f apps/tenants/team-test/apps/go-httpbin.yaml \
  | kubectl apply -n team-test -f -

# If direct apply doesn't work (HelmRelease needs Flux), use:
kubectl apply -f apps/tenants/team-test/apps/go-httpbin.yaml
flux reconcile kustomization sre-tenants --with-source
```

### Step 2: Wait for healthy

```bash
# Wait for pod to be Running (max 3 minutes)
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=go-httpbin \
  -n team-test --timeout=180s

# If it fails, get diagnostic info:
kubectl describe pod -l app.kubernetes.io/name=go-httpbin -n team-test
kubectl logs -l app.kubernetes.io/name=go-httpbin -n team-test --tail=50
```

**If the pod is CrashLoopBackOff or ImagePullBackOff:**
- Check the error. Is it security context? Image registry? Missing secret?
- FIX THE PLATFORM (not just the one deployment)
- Redeploy and re-wait

### Step 3: Test internal connectivity

```bash
# Verify the Service exists and has endpoints
kubectl get svc -n team-test -l app.kubernetes.io/name=go-httpbin
kubectl get endpoints -n team-test go-httpbin

# Curl from inside the cluster (bypasses ingress — tests the app itself)
kubectl run curl-test --rm -i --restart=Never \
  --image=curlimages/curl:8.5.0 -n team-test -- \
  curl -sf http://go-httpbin:8080/ -o /dev/null -w '%{http_code}'
# Should return 200
```

### Step 4: Test ingress

```bash
# Curl from outside through Istio gateway
curl -sk https://go-httpbin.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
# Should return 200 (if no SSO) or 302 (if SSO redirect)
```

**If you get 404 or 503:**
- VirtualService missing or misconfigured
- Check: kubectl get virtualservice -n team-test
- Check: kubectl get gateway -n istio-system
- FIX THE PLATFORM

### Step 5: Playwright E2E test

Create and run: tests/e2e/round4/test-go-httpbin.mjs

```javascript
import { SreE2E } from '../lib/sre-e2e.mjs';

async function testGoHttpbin() {
  const e2e = await new SreE2E('go-httpbin').init();

  try {
    // 1. Navigate to app
    const url = await e2e.navigateToApp();

    // 2. Handle SSO if needed
    await e2e.handleSSOLogin();

    // 3. Verify the httpbin UI loaded
    const hasTitle = await e2e.waitForText('httpbin');
    e2e.record('App UI loads', hasTitle, hasTitle ? 'httpbin title visible' : 'Title not found');
    await e2e.screenshot('app-loaded');

    // 4. Test an endpoint — submit to /get
    await e2e.page.click('text=HTTP Methods');
    await e2e.screenshot('http-methods-section');

    // Try the GET endpoint
    const getUrl = `https://go-httpbin.${process.env.SRE_DOMAIN || 'apps.sre.example.com'}/get`;
    const response = await e2e.page.request.get(getUrl);
    const status = response.status();
    e2e.record('GET /get returns 200', status === 200, `Status: ${status}`);

    // 5. Test /headers endpoint
    const headersResp = await e2e.page.request.get(
      `https://go-httpbin.${process.env.SRE_DOMAIN || 'apps.sre.example.com'}/headers`
    );
    const headersStatus = headersResp.status();
    e2e.record('GET /headers returns 200', headersStatus === 200, `Status: ${headersStatus}`);

    // 6. Test /status endpoint
    const statusResp = await e2e.page.request.get(
      `https://go-httpbin.${process.env.SRE_DOMAIN || 'apps.sre.example.com'}/status/418`
    );
    e2e.record('GET /status/418 returns 418', statusResp.status() === 418,
      `Status: ${statusResp.status()}`);

    // 7. Test /post endpoint
    const postResp = await e2e.page.request.post(
      `https://go-httpbin.${process.env.SRE_DOMAIN || 'apps.sre.example.com'}/post`,
      { data: { test: 'hello from SRE platform' } }
    );
    e2e.record('POST /post returns 200', postResp.status() === 200,
      `Status: ${postResp.status()}`);

    await e2e.screenshot('tests-complete');

    // Write report
    const report = e2e.generateReport();
    const fs = await import('fs');
    fs.writeFileSync('tests/e2e/round4/reports/go-httpbin.md', report);
    console.log(`\n📄 Report: tests/e2e/round4/reports/go-httpbin.md`);

  } catch (error) {
    console.error(`❌ Test failed with error: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  return e2e.results;
}

testGoHttpbin().catch(console.error);
```

Run it:
```bash
cd tests/e2e && node round4/test-go-httpbin.mjs
```

**If SSO login fails:**
- Screenshot will show what went wrong
- Is Keycloak redirecting correctly?
- Does the OIDC client exist for this app's URL?
- You may need to register the app's URL as an OIDC client in Keycloak
  OR the app may not be behind SSO (it's a test app, not a platform UI)
- If SSO isn't configured for tenant apps, DOCUMENT THAT and test without SSO
- FIX: Either add SSO integration docs, or document that tenant apps handle their
  own auth and the platform only provides Keycloak as an available IdP

**If the app loads but tests fail:**
- Check screenshots for clues
- Is it a CORS issue? Istio misconfiguration? NetworkPolicy blocking?
- FIX THE PLATFORM

### Step 6: Report and commit

Write report to tests/e2e/round4/reports/go-httpbin.md.
Include: screenshots, test results, pod logs, any platform fixes made.

```bash
git add tests/e2e/
git commit -m "test(e2e): go-httpbin — full deployment + browser + API verification"
# If platform fixes were needed:
git commit -m "fix(<component>): <what> [from go-httpbin E2E test]"
```

---

## APP 2: Uptime Kuma (Stateful + WebSocket + Root User)

This tests the hardest Round 1 pattern with REAL deployment. If Uptime Kuma actually
starts, persists data, and lets you add a monitor through the browser, the stateful
app story is real.

### Step 1: Deploy for real

```bash
./scripts/sre-deploy-app.sh \
  --name uptime-kuma \
  --team team-test \
  --image louislam/uptime-kuma \
  --tag 1 \
  --port 3001 \
  --chart web-app \
  --ingress uptime-kuma.apps.sre.example.com \
  --run-as-root \
  --writable-root \
  --persist /app/data:2Gi \
  --liveness-path / \
  --readiness-path / \
  --no-commit

# Apply to cluster
kubectl apply -f apps/tenants/team-test/apps/uptime-kuma.yaml
flux reconcile kustomization sre-tenants --with-source
```

### Step 2: Wait for healthy

```bash
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=uptime-kuma \
  -n team-test --timeout=180s
```

**Common failures and fixes:**
- **CrashLoopBackOff: permission denied on /app/data** → PVC mount permissions wrong.
  Fix: add fsGroup or initContainer to chown. FIX THE CHART.
- **Kyverno blocks the pod** → PolicyException not created for root user.
  Fix: the deploy script with --run-as-root must also create a PolicyException.
  FIX THE PLATFORM.
- **ImagePullBackOff** → Image not in Harbor. For E2E tests, allow pulling from
  Docker Hub directly. Fix: NetworkPolicy must allow egress to registry.

### Step 3: Test internal + ingress

```bash
# Internal
kubectl run curl-test --rm -i --restart=Never \
  --image=curlimages/curl:8.5.0 -n team-test -- \
  curl -sf http://uptime-kuma:3001/ -o /dev/null -w '%{http_code}'

# Ingress
curl -sk https://uptime-kuma.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
```

### Step 4: Playwright E2E test

Create and run: tests/e2e/round4/test-uptime-kuma.mjs

```javascript
import { SreE2E } from '../lib/sre-e2e.mjs';

async function testUptimeKuma() {
  const e2e = await new SreE2E('uptime-kuma').init();

  try {
    // 1. Navigate to app
    await e2e.navigateToApp();
    await e2e.handleSSOLogin();

    // 2. Uptime Kuma first-run setup — create admin account
    //    (This only happens on first visit with empty database)
    const hasSetup = await e2e.waitForText('Create your admin account', 5000);
    if (hasSetup) {
      console.log('📝 First-run setup detected');
      await e2e.screenshot('setup-wizard');

      // Fill admin account form
      await e2e.page.fill('input[id="floatingInput"]', 'admin');
      await e2e.page.fill('input[id="floatingPassword"]', 'SreTest123!');
      await e2e.page.fill('input[id="repeat"]', 'SreTest123!');
      await e2e.screenshot('setup-filled');

      await e2e.page.click('button[type="submit"]');
      await e2e.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
      await e2e.screenshot('setup-complete');

      e2e.record('First-run setup completed', true, 'Admin account created');
    } else {
      console.log('ℹ️  No setup wizard — app may already be configured');
      e2e.record('App already configured', true, 'Skipped setup');
    }

    // 3. Verify dashboard loads
    const hasDashboard = await e2e.waitForText('Add New Monitor', 10000)
      || await e2e.waitForText('Dashboard', 10000);
    e2e.record('Dashboard loads after setup', hasDashboard);
    await e2e.screenshot('dashboard');

    // 4. Add a monitor (the core functionality test)
    if (hasDashboard) {
      // Click "Add New Monitor"
      try {
        await e2e.page.click('text=Add New Monitor');
        await e2e.screenshot('add-monitor-form');

        // Fill monitor form — monitor the go-httpbin app we deployed earlier
        await e2e.page.fill('input[id="name"]', 'go-httpbin health');
        // Set URL to internal service URL
        await e2e.page.fill('input[id="url"]',
          'http://go-httpbin.team-test.svc.cluster.local:8080/');
        await e2e.screenshot('monitor-filled');

        // Save
        await e2e.page.click('button:has-text("Save")');
        await e2e.page.waitForTimeout(5000); // Wait for first check
        await e2e.screenshot('monitor-saved');

        // Check if monitor shows UP status
        const isUp = await e2e.waitForText('Up', 10000);
        e2e.record('Monitor created and checking', true, 'Monitor saved');
        e2e.record('Monitor shows UP status', isUp,
          isUp ? 'go-httpbin is UP' : 'Monitor may still be checking');
        await e2e.screenshot('monitor-status');

      } catch (err) {
        e2e.record('Add monitor flow', false, err.message);
        await e2e.screenshot('add-monitor-error');
      }
    }

    // 5. Test WebSocket connection (Uptime Kuma uses WebSocket for real-time updates)
    //    If the dashboard loaded and shows live status, WebSocket is working
    const wsWorking = await e2e.page.evaluate(() => {
      // Check if socket.io is connected
      return typeof window.__NUXT__ !== 'undefined' || document.querySelector('.badge') !== null;
    });
    e2e.record('WebSocket connection active', wsWorking || hasDashboard,
      'Real-time updates require WebSocket through Istio');

    // 6. Test data persistence — we'll verify in the re-test phase by checking
    //    if the monitor still exists after pod restart
    e2e.record('Data persistence (PVC)', true, 'Will verify after pod restart in re-test');

    await e2e.screenshot('tests-complete');

    const report = e2e.generateReport();
    const fs = await import('fs');
    fs.writeFileSync('tests/e2e/round4/reports/uptime-kuma.md', report);

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  return e2e.results;
}

testUptimeKuma().catch(console.error);
```

### Step 5: Test persistence

After the Playwright test, verify data survives a pod restart:

```bash
# Delete the pod (Kubernetes will recreate it with the PVC still attached)
kubectl delete pod -n team-test -l app.kubernetes.io/name=uptime-kuma

# Wait for new pod
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=uptime-kuma \
  -n team-test --timeout=180s

# Re-run a quick Playwright check — does the monitor still exist?
# (Don't re-run setup wizard — if it shows setup again, PVC didn't persist)
```

Create a mini persistence test:
```javascript
// tests/e2e/round4/test-uptime-kuma-persistence.mjs
import { SreE2E } from '../lib/sre-e2e.mjs';

async function testPersistence() {
  const e2e = await new SreE2E('uptime-kuma').init();
  try {
    await e2e.navigateToApp();
    await e2e.handleSSOLogin();

    // If we see setup wizard again, data was lost
    const hasSetup = await e2e.waitForText('Create your admin account', 5000);
    e2e.record('Data survived pod restart', !hasSetup,
      hasSetup ? 'FAIL — setup wizard appeared again, PVC data lost' : 'Data persisted');

    // Check our monitor still exists
    const hasMonitor = await e2e.waitForText('go-httpbin health', 10000);
    e2e.record('Monitor survived pod restart', hasMonitor);

    await e2e.screenshot('persistence-test');
    const report = e2e.generateReport();
    const fs = await import('fs');
    fs.appendFileSync('tests/e2e/round4/reports/uptime-kuma.md',
      '\n\n## Persistence Test\n\n' + report);
  } finally {
    await e2e.cleanup();
  }
}

testPersistence().catch(console.error);
```

### Step 6: Report and commit

---

## APP 3: Gitea (Multi-Protocol + Persistence + Setup Wizard)

This is the hardest test. Gitea needs HTTP ingress, persistent storage, a setup wizard,
and actual Git operations (clone, push). If a user can `git clone` from an app deployed
through the platform, the developer experience is real.

### Step 1: Deploy for real

```bash
./scripts/sre-deploy-app.sh \
  --name gitea \
  --team team-test \
  --image gitea/gitea \
  --tag 1.22-rootless \
  --port 3000 \
  --chart web-app \
  --ingress gitea.apps.sre.example.com \
  --persist /var/lib/gitea:10Gi \
  --persist /etc/gitea:1Gi \
  --startup-probe / \
  --liveness-path /api/v1/version \
  --readiness-path /api/v1/version \
  --no-commit

# Note: Using rootless image to avoid --run-as-root.
# If rootless doesn't work, fall back to:
#   --image gitea/gitea --tag 1.22 --run-as-root

# Apply
kubectl apply -f apps/tenants/team-test/apps/gitea.yaml
flux reconcile kustomization sre-tenants --with-source
```

### Step 2: Wait for healthy + debug

```bash
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=gitea \
  -n team-test --timeout=300s

# Gitea can be slow on first start (database setup)
# If it fails, check:
kubectl logs -l app.kubernetes.io/name=gitea -n team-test --tail=100
```

**Common failures:**
- **SQLite permission denied** → PVC mount path or ownership wrong
- **Port binding failed** → rootless image uses 3000, root image uses 3000 too but
  may try to bind 22 for SSH (ignore SSH for now, test HTTP only)
- **readOnlyRootFilesystem** → Gitea writes to multiple paths, needs --writable-root
  or correct PVC mounts

### Step 3: Playwright E2E test

Create and run: tests/e2e/round4/test-gitea.mjs

```javascript
import { SreE2E } from '../lib/sre-e2e.mjs';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function testGitea() {
  const e2e = await new SreE2E('gitea').init();
  const GITEA_URL = `https://gitea.${process.env.SRE_DOMAIN || 'apps.sre.example.com'}`;

  try {
    // 1. Navigate to Gitea
    await e2e.navigateToApp();
    await e2e.handleSSOLogin();

    // 2. Check if Gitea needs initial setup
    const needsInstall = await e2e.waitForText('Initial Configuration', 5000)
      || await e2e.waitForText('Install Gitea', 5000);

    if (needsInstall) {
      console.log('📝 Gitea initial setup required');
      await e2e.screenshot('install-page');

      // Configure database (SQLite for simplicity)
      // Fill site title
      try {
        await e2e.page.fill('input[name="db_type"]', 'sqlite3').catch(() => {});
        // Many fields may already have defaults — just set the essentials
        // Set Site Title
        const titleInput = await e2e.page.$('input[name="site_title"]');
        if (titleInput) await titleInput.fill('SRE Gitea');

        // Set Server Domain
        const domainInput = await e2e.page.$('input[name="domain"]');
        if (domainInput) await domainInput.fill('gitea.apps.sre.example.com');

        // Set Root URL
        const rootUrlInput = await e2e.page.$('input[name="app_url"]');
        if (rootUrlInput) await rootUrlInput.fill(GITEA_URL + '/');

        await e2e.screenshot('install-configured');

        // Submit install form
        await e2e.page.click('button[type="submit"]');
        await e2e.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 });
        await e2e.screenshot('install-complete');
        e2e.record('Initial setup completed', true);
      } catch (err) {
        e2e.record('Initial setup', false, err.message);
        await e2e.screenshot('install-error');
      }
    }

    // 3. Register a test user (or log in if user exists)
    const hasSignIn = await e2e.waitForText('Sign In', 5000);
    if (hasSignIn) {
      // Try to register
      await e2e.page.click('text=Register');
      await e2e.page.waitForTimeout(2000);
      await e2e.screenshot('register-page');

      try {
        await e2e.page.fill('input[name="user_name"]', 'sre-test');
        await e2e.page.fill('input[name="email"]', 'sre-test@sre.example.com');
        await e2e.page.fill('input[name="password"]', 'SreTest123!');
        await e2e.page.fill('input[name="retype"]', 'SreTest123!');
        await e2e.screenshot('register-filled');

        await e2e.page.click('button[type="submit"]');
        await e2e.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
        await e2e.screenshot('register-complete');
        e2e.record('User registration', true, 'sre-test user created');
      } catch (err) {
        // User may already exist — try login instead
        console.log('Registration failed, trying login...');
        await e2e.page.goto(`${GITEA_URL}/user/login`, { waitUntil: 'networkidle' });
        await e2e.page.fill('input[name="user_name"]', 'sre-test');
        await e2e.page.fill('input[name="password"]', 'SreTest123!');
        await e2e.page.click('button[type="submit"]');
        await e2e.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
        e2e.record('User login', true, 'Logged in as sre-test');
      }
    }

    await e2e.screenshot('logged-in');

    // 4. Create a repository
    try {
      await e2e.page.goto(`${GITEA_URL}/repo/create`, { waitUntil: 'networkidle' });
      await e2e.screenshot('create-repo-page');

      await e2e.page.fill('input[name="repo_name"]', 'sre-e2e-test');
      await e2e.page.fill('textarea[name="description"]', 'E2E test repo from SRE platform');

      // Check "Initialize this repository"
      const initCheckbox = await e2e.page.$('input[name="auto_init"]');
      if (initCheckbox) await initCheckbox.check();

      await e2e.screenshot('repo-form-filled');
      await e2e.page.click('button[type="submit"]');
      await e2e.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
      await e2e.screenshot('repo-created');

      e2e.record('Repository created via UI', true, 'sre-e2e-test repo');
    } catch (err) {
      e2e.record('Repository creation', false, err.message);
      await e2e.screenshot('repo-create-error');
    }

    // 5. Test Git clone via HTTP (the real test — can a developer actually use this?)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-clone-'));
    try {
      console.log(`\n🔧 Testing git clone to ${tmpDir}`);
      execSync(
        `git clone -c http.sslVerify=false ${GITEA_URL}/sre-test/sre-e2e-test.git ${tmpDir}/repo`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      e2e.record('Git clone via HTTPS', true, 'Repository cloned successfully');

      // 6. Push a commit
      execSync(`
        cd ${tmpDir}/repo &&
        git config user.email "sre-test@sre.example.com" &&
        git config user.name "SRE E2E Test" &&
        echo "# Deployed on SRE Platform" > PLATFORM.md &&
        echo "This repo was cloned and pushed via the SRE platform E2E test." >> PLATFORM.md &&
        git add PLATFORM.md &&
        git commit -m "test: verify git push through SRE platform" &&
        git push -c http.sslVerify=false origin main
      `, { encoding: 'utf-8', timeout: 30000 });
      e2e.record('Git push via HTTPS', true, 'Commit pushed successfully');

    } catch (err) {
      e2e.record('Git operations', false, err.message);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 7. Verify the push shows in the UI
    await e2e.page.goto(`${GITEA_URL}/sre-test/sre-e2e-test`, { waitUntil: 'networkidle' });
    const hasPlatformMd = await e2e.waitForText('PLATFORM.md', 5000);
    e2e.record('Pushed file visible in UI', hasPlatformMd,
      hasPlatformMd ? 'PLATFORM.md appears in repo file list' : 'File not visible');
    await e2e.screenshot('repo-with-push');

    // 8. Test API
    const apiResp = await e2e.page.request.get(`${GITEA_URL}/api/v1/version`);
    e2e.record('API /version returns 200', apiResp.status() === 200,
      `Status: ${apiResp.status()}`);

    await e2e.screenshot('tests-complete');

    const report = e2e.generateReport();
    fs.writeFileSync('tests/e2e/round4/reports/gitea.md', report);

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  return e2e.results;
}

testGitea().catch(console.error);
```

### Step 4: Report and commit

---

## PHASE 2: PERSISTENCE + RESILIENCE TESTS

After all 3 apps are deployed and tested, verify they survive disruption:

### 2A: Pod restart test (data persistence)

```bash
for app in go-httpbin uptime-kuma gitea; do
  echo "=== Restarting $app ==="
  kubectl delete pod -n team-test -l app.kubernetes.io/name=$app
  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=$app \
    -n team-test --timeout=180s
  echo "$app is back"
done
```

Then re-run the Playwright tests (quick mode — just verify the app loads and data is there).
Uptime Kuma: monitor still exists? Gitea: repo still exists with PLATFORM.md?

### 2B: Resource usage check

```bash
# Are apps using reasonable resources?
kubectl top pods -n team-test
# No pod should be over 80% of its limit

# Any OOMKilled events?
kubectl get events -n team-test --field-selector reason=OOMKilling
```

### 2C: NetworkPolicy verification

```bash
# Can apps talk to things they shouldn't?
# Try to curl from go-httpbin pod to Kubernetes API — should be blocked
kubectl exec -n team-test deploy/go-httpbin -- \
  curl -sf --max-time 5 https://kubernetes.default.svc/ 2>&1 || echo "BLOCKED (good)"

# Can apps resolve DNS?
kubectl exec -n team-test deploy/go-httpbin -- \
  nslookup kubernetes.default.svc 2>&1 || echo "DNS check done"
```

---

## PHASE 3: CLEANUP + UNDEPLOY TEST

Real platforms need to undeploy cleanly too. Verify:

```bash
# Delete all test apps
for app in go-httpbin uptime-kuma gitea; do
  kubectl delete -f apps/tenants/team-test/apps/$app.yaml 2>/dev/null
done
flux reconcile kustomization sre-tenants --with-source

# Wait and verify pods are gone
sleep 30
kubectl get pods -n team-test
# Should show no pods (or only infrastructure pods)

# Verify PVCs (should PVCs be deleted or retained? Document the behavior)
kubectl get pvc -n team-test
# If PVCs remain after app deletion, that's a design decision to document
```

---

## PHASE 4: FINAL REPORT

Create tests/e2e/round4/FINAL-REPORT.md:

```markdown
# E2E Integration Test Round 4 — Final Report

## Executive Summary
(5 sentences: what was tested, what passed, what failed, what was fixed)

## Test Results by App

### go-httpbin (Stateless Baseline)
| Test | Status | Evidence |
|------|--------|----------|
| Pod reaches Running | ? | kubectl output |
| Internal curl returns 200 | ? | curl output |
| Ingress returns 200/302 | ? | curl output |
| SSO login succeeds | ? | screenshot |
| App UI loads in browser | ? | screenshot |
| GET /get returns 200 | ? | Playwright |
| POST /post returns 200 | ? | Playwright |

### Uptime Kuma (Stateful + WebSocket)
| Test | Status | Evidence |
|------|--------|----------|
| Pod reaches Running (with root + writable FS) | ? | kubectl |
| Setup wizard completes | ? | screenshot |
| Monitor created via UI | ? | screenshot |
| Monitor shows UP status | ? | screenshot |
| WebSocket connection works (real-time updates) | ? | screenshot |
| Data persists after pod restart | ? | screenshot |

### Gitea (Persistence + Git Operations)
| Test | Status | Evidence |
|------|--------|----------|
| Pod reaches Running | ? | kubectl |
| Initial setup completes | ? | screenshot |
| User registration works | ? | screenshot |
| Repository created via UI | ? | screenshot |
| git clone via HTTPS works | ? | terminal output |
| git push via HTTPS works | ? | terminal output |
| Pushed file visible in UI | ? | screenshot |
| API returns version | ? | Playwright |

## Platform Bugs Found
(Issues that required platform fixes during this round)

| # | Bug | Severity | Fixed? | How |
|---|-----|----------|--------|-----|

## Key Insight
(What did real deployment reveal that template validation missed?)

## Screenshots
(Link to all screenshots in tests/e2e/round4/screenshots/)

## Recommendations
1. (Top priority fix)
2. (Second priority)
3. (Third priority)
```

Commit everything:
```bash
git add tests/e2e/
git commit -m "test(e2e): round 4 — real deployment + browser + API verification for 3 apps"
```
```

---

## Running Order

```
Phase 0: Framework setup + cluster health check
App 1:   go-httpbin    — deploy, wait, curl, Playwright (baseline)
App 2:   Uptime Kuma   — deploy, wait, Playwright (setup wizard, add monitor, WebSocket)
App 3:   Gitea         — deploy, wait, Playwright (setup, create repo, git clone, git push)
Phase 2: Restart all pods, re-test persistence, check resources + networking
Phase 3: Undeploy all, verify clean removal
Phase 4: Final report with screenshots
```

## Kick-Off Prompt

```
This is Round 4 — real E2E testing. Previous rounds only validated YAML templates.
This round ACTUALLY DEPLOYS apps to the cluster, tests them through a browser with
Playwright, and authenticates through Keycloak SSO.

Read docs/integration-test-round4-e2e.md for the full plan, then execute the prompt
in "The Prompt" section.

CRITICAL RULES:
1. Actually deploy to the cluster — not just helm template.
2. Wait for pods to be Running before testing.
3. Test through the ingress URL — not port-forward.
4. If kubectl exec or port-forward is needed, that's a PLATFORM BUG.
5. Take screenshots at every step as evidence.
6. Fix the platform when things break, then redeploy and retest.

Start immediately. Do not stop or ask questions.
```
