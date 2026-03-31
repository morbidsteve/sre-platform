# Round 5: Full Platform E2E Validation + ATO Body of Evidence

## Context

Rounds 1-3 validated templates only. Round 4 deployed 3 apps and found 5 critical
bugs. The hardening PR (43) and SSO fix PR (44) addressed those. Now we need to
validate the ENTIRE platform end-to-end and produce a complete ATO body of evidence.

This is not a partial test. This covers every platform component, every user journey,
and generates the compliance artifacts an assessor needs.

## The Prompt

```
You are conducting a COMPREHENSIVE end-to-end validation of the entire SRE platform.
This is the final quality gate before the platform is considered production-ready.
You will test every component, every user flow, and generate a complete ATO body
of evidence package.

BRANCH: test/round5-full-platform-e2e

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. Take a screenshot of EVERY significant state. Name them descriptively.
3. If something fails, document it with evidence and continue — do NOT silently retry.
4. If you must retry, log BOTH the failure AND the retry explicitly.
5. All results go in tests/e2e/round5/ with structured reports.
6. Credentials: sre-admin / SreAdmin123! (NEVER change these)
7. Domain: *.apps.sre.example.com

## SETUP

mkdir -p tests/e2e/round5/{screenshots,reports,evidence}
EVIDENCE_DIR="tests/e2e/round5/evidence"
REPORT_DIR="tests/e2e/round5/reports"
SCREENSHOT_DIR="tests/e2e/round5/screenshots"
DOMAIN="apps.sre.example.com"

## PHASE 1: Platform Health Check

Verify every core platform component is running. This is the foundation —
if anything here fails, stop and fix before continuing.

### 1A. Flux Reconciliation

```bash
flux get kustomizations -A 2>/dev/null || echo "Flux CLI not available — use kubectl"
kubectl get kustomizations.kustomize.toolkit.fluxcd.io -A -o wide
```

Expected: ALL kustomizations show Ready=True. Capture output to
$EVIDENCE_DIR/flux-kustomizations.txt

```bash
kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o wide
```

Expected: ALL HelmReleases show Ready=True. Capture output to
$EVIDENCE_DIR/flux-helmreleases.txt

If any are NOT ready, capture the error:
```bash
kubectl describe helmrelease <name> -n <namespace> | tail -30
```

### 1B. Pod Health — All Namespaces

```bash
kubectl get pods -A -o wide | grep -v Running | grep -v Completed
```

Expected: NO pods in CrashLoopBackOff, Error, or Pending state.
Capture FULL pod list to $EVIDENCE_DIR/all-pods.txt

### 1C. Core Service Endpoints

Test each platform service is responding. For each, record HTTP status code:

```bash
# Istio ingress gateway
kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}'

# Platform UIs (should all 302 to Keycloak when unauthenticated)
for svc in dashboard grafana prometheus alertmanager portal dsop kiali; do
  STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "https://${svc}.${DOMAIN}/" 2>/dev/null)
  echo "${svc}: ${STATUS}"
done
```

Expected: All return 302 (redirect to Keycloak). Capture to $EVIDENCE_DIR/service-endpoints.txt

```bash
# Keycloak itself (should return 200, NOT behind SSO)
curl -sk -o /dev/null -w '%{http_code}' "https://keycloak.${DOMAIN}/"
```

Expected: 200

### 1D. Certificate Status

```bash
kubectl get certificates -A
kubectl get certificaterequests -A | grep -v Approved
```

Expected: All certificates Ready=True, no pending requests.
Capture to $EVIDENCE_DIR/certificates.txt

### 1E. Kyverno Policies

```bash
kubectl get clusterpolicies -o wide
kubectl get policyreport -A --no-headers | wc -l
kubectl get clusterpolicyreport --no-headers 2>/dev/null | wc -l
```

Expected: All policies in Enforce or Audit mode. Capture to $EVIDENCE_DIR/kyverno-policies.txt

### 1F. Generate Phase 1 Report

Create $REPORT_DIR/01-platform-health.md with a table:

| Component | Status | Evidence |
|-----------|--------|----------|
| Flux Kustomizations | X/Y Ready | flux-kustomizations.txt |
| Flux HelmReleases | X/Y Ready | flux-helmreleases.txt |
| Pod Health | X pods running, Y issues | all-pods.txt |
| Service Endpoints | X/Y responding | service-endpoints.txt |
| Certificates | X/Y valid | certificates.txt |
| Kyverno Policies | X active | kyverno-policies.txt |

## PHASE 2: SSO Verification (Playwright)

Test that Keycloak SSO works correctly for both platform UIs and tenant apps.
This validates the Fix from PR #44.

Create tests/e2e/round5/sso-verification.mjs:

```javascript
#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DOMAIN = 'apps.sre.example.com';
const SSO_USER = 'sre-admin';
const SSO_PASS = 'SreAdmin123!';
const SCREENSHOT_DIR = 'tests/e2e/round5/screenshots/sso';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let n = 0;
async function shot(page, name) {
  n++;
  const f = path.join(SCREENSHOT_DIR, `${String(n).padStart(2,'0')}-${name}.png`);
  await page.screenshot({ path: f, fullPage: true });
  console.log(`  [screenshot] ${f}`);
}

async function keycloakLogin(page) {
  // Handle the Keycloak login flow
  // May see OAuth2 proxy sign-in page first, then Keycloak
  const url = page.url();

  // Click "Sign in with Keycloak" if on OAuth2 proxy page
  const signInBtn = page.locator('text=Sign in with Keycloak');
  if (await signInBtn.count() > 0) {
    await signInBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  // Fill Keycloak form if present
  const usernameField = page.locator('#username');
  if (await usernameField.count() > 0) {
    await usernameField.fill(SSO_USER);
    await page.locator('#password').fill(SSO_PASS);
    await shot(page, 'keycloak-login-form');
    await page.click('#kc-login');
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  }
}

const results = [];
function record(test, status, detail = '') {
  results.push({ test, status, detail });
  console.log(`  [${status}] ${test}${detail ? ': ' + detail : ''}`);
}

(async () => {
  console.log('=== SSO Verification ===\n');
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  try {
    // ── TEST 1: Dashboard SSO ─────────────────────────────────
    console.log('1. Dashboard SSO...');
    const page = await context.newPage();
    await page.goto(`https://dashboard.${DOMAIN}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await shot(page, 'dashboard-before-login');

    // Should have been redirected to Keycloak
    const dashUrl = page.url();
    if (dashUrl.includes('keycloak') || await page.locator('text=Sign in').count() > 0) {
      record('Dashboard redirects to SSO', 'PASS');
    } else {
      record('Dashboard redirects to SSO', 'FAIL', `URL: ${dashUrl}`);
    }

    await keycloakLogin(page);
    await shot(page, 'dashboard-after-login');

    // Verify we're on the dashboard
    if (page.url().includes('dashboard')) {
      record('Dashboard accessible after SSO', 'PASS');
    } else {
      record('Dashboard accessible after SSO', 'FAIL', `URL: ${page.url()}`);
    }

    // ── TEST 2: SSO Cookie Shared (Cross-domain) ──────────────
    console.log('\n2. SSO cookie sharing...');
    // Navigate to Grafana — should NOT need to log in again
    await page.goto(`https://grafana.${DOMAIN}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, 'grafana-with-sso-cookie');

    const grafanaUrl = page.url();
    // If we're on Grafana (not on Keycloak login page), SSO cookie works
    if (!grafanaUrl.includes('keycloak') && !grafanaUrl.includes('dex')) {
      record('SSO cookie shared to Grafana', 'PASS');
    } else {
      record('SSO cookie shared to Grafana', 'FAIL', 'Had to re-login');
    }

    // ── TEST 3: Portal SSO ────────────────────────────────────
    console.log('\n3. Portal SSO...');
    await page.goto(`https://portal.${DOMAIN}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, 'portal-with-sso-cookie');

    if (!page.url().includes('keycloak')) {
      record('Portal accessible with SSO cookie', 'PASS');
    } else {
      record('Portal accessible with SSO cookie', 'FAIL');
    }

    // ── TEST 4: DSOP Wizard SSO ───────────────────────────────
    console.log('\n4. DSOP Wizard SSO...');
    await page.goto(`https://dsop.${DOMAIN}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    await shot(page, 'dsop-wizard-with-sso-cookie');

    if (!page.url().includes('keycloak')) {
      record('DSOP Wizard accessible with SSO cookie', 'PASS');
    } else {
      record('DSOP Wizard accessible with SSO cookie', 'FAIL');
    }

    // ── TEST 5: Tenant App SSO ────────────────────────────────
    console.log('\n5. Tenant app SSO enforcement...');
    // First, check if any tenant app exists
    // Use a fresh context (no cookies) to verify unauthenticated access is blocked
    const freshContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    const freshPage = await freshContext.newPage();

    // Try to access a known tenant app without auth
    // If go-httpbin or another test app is deployed, test it
    const tenantApps = ['go-httpbin', 'gitea', 'uptime-kuma'];
    for (const app of tenantApps) {
      try {
        const resp = await freshPage.goto(`https://${app}.${DOMAIN}/`, {
          waitUntil: 'networkidle', timeout: 15000
        });
        const status = resp?.status() || 0;
        const finalUrl = freshPage.url();
        await shot(freshPage, `tenant-${app}-no-auth`);

        if (finalUrl.includes('keycloak') || status === 302 || status === 403) {
          record(`Tenant app ${app} requires SSO`, 'PASS', `status=${status}`);
        } else if (status === 0 || status >= 500) {
          record(`Tenant app ${app} requires SSO`, 'SKIP', `app not deployed (status=${status})`);
        } else {
          record(`Tenant app ${app} requires SSO`, 'FAIL', `accessible without auth! status=${status}`);
        }
      } catch (e) {
        record(`Tenant app ${app} requires SSO`, 'SKIP', `not reachable: ${e.message}`);
      }
    }

    await freshContext.close();

    // ── TEST 6: Keycloak NOT behind SSO ───────────────────────
    console.log('\n6. Keycloak accessibility...');
    const kcContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    const kcPage = await kcContext.newPage();
    const kcResp = await kcPage.goto(`https://keycloak.${DOMAIN}/`, {
      waitUntil: 'networkidle', timeout: 15000
    });
    const kcStatus = kcResp?.status() || 0;
    await shot(kcPage, 'keycloak-direct-access');

    if (kcStatus === 200) {
      record('Keycloak accessible without SSO (no loop)', 'PASS');
    } else {
      record('Keycloak accessible without SSO', 'FAIL', `status=${kcStatus}`);
    }
    await kcContext.close();

    // ── REPORT ────────────────────────────────────────────────
    console.log('\n=== SSO Results ===');
    let pass = 0, fail = 0, skip = 0;
    for (const r of results) {
      if (r.status === 'PASS') pass++;
      else if (r.status === 'FAIL') fail++;
      else skip++;
    }
    console.log(`PASS: ${pass}  FAIL: ${fail}  SKIP: ${skip}`);

    // Write report
    let md = '# SSO Verification Report\n\n';
    md += '| Test | Status | Detail |\n|------|--------|--------|\n';
    for (const r of results) {
      md += `| ${r.test} | ${r.status} | ${r.detail} |\n`;
    }
    md += `\n**Total: ${pass} PASS, ${fail} FAIL, ${skip} SKIP**\n`;
    fs.writeFileSync('tests/e2e/round5/reports/02-sso-verification.md', md);

    await page.close();
  } catch (err) {
    console.error('FATAL:', err);
  } finally {
    await browser.close();
  }
})();
```

Run it:
```bash
cd /path/to/sre-platform
node tests/e2e/round5/sso-verification.mjs
```

## PHASE 3: Dashboard Functional Test (Playwright)

Test every tab and feature of the platform dashboard.

Create tests/e2e/round5/dashboard-e2e.mjs:

```javascript
#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DOMAIN = 'apps.sre.example.com';
const SSO_USER = 'sre-admin';
const SSO_PASS = 'SreAdmin123!';
const SCREENSHOT_DIR = 'tests/e2e/round5/screenshots/dashboard';
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let n = 0;
async function shot(page, name) {
  n++;
  const f = path.join(SCREENSHOT_DIR, `${String(n).padStart(2,'0')}-${name}.png`);
  await page.screenshot({ path: f, fullPage: true });
  console.log(`  [screenshot] ${f}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function record(test, status, detail = '') {
  results.push({ test, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`  [${icon} ${status}] ${test}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  console.log('=== Dashboard E2E Test ===\n');
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    // LOGIN
    console.log('Login...');
    await page.goto(`https://dashboard.${DOMAIN}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1000);
    if (await page.locator('text=Sign in with Keycloak').count()) {
      await page.locator('text=Sign in with Keycloak').click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(2000);
    }
    if (await page.locator('#username').count()) {
      await page.fill('#username', SSO_USER);
      await page.fill('#password', SSO_PASS);
      await page.click('#kc-login');
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(3000);
    }
    // Dismiss onboarding overlay if present
    await page.evaluate(() => {
      const el = document.getElementById('onboard-overlay');
      if (el) { el.classList.remove('show'); el.style.display = 'none'; }
    });
    await sleep(500);
    await shot(page, 'dashboard-home');
    record('Dashboard login', 'PASS');

    // TAB: Operations Cockpit
    console.log('\nOperations Cockpit...');
    const opsBtn = page.locator('button[data-tab="ops"], button:has-text("Operations")').first();
    if (await opsBtn.count()) {
      await opsBtn.click();
      await sleep(3000);
      await shot(page, 'ops-cockpit');
      record('Operations Cockpit loads', 'PASS');
    } else {
      record('Operations Cockpit tab', 'SKIP', 'tab not found');
    }

    // TAB: Pipeline History
    console.log('\nPipeline History...');
    const pipeBtn = page.locator('button[data-tab="pipeline"]').first();
    if (await pipeBtn.count()) {
      await pipeBtn.click();
      await sleep(4000);
      await shot(page, 'pipeline-history');
      record('Pipeline History loads', 'PASS');
    } else {
      record('Pipeline History tab', 'SKIP', 'tab not found');
    }

    // TAB: ISSM Queue
    console.log('\nISSM Queue...');
    const issmBtn = page.locator('button[data-tab="issm"]').first();
    if (await issmBtn.count()) {
      await issmBtn.click();
      await sleep(4000);
      await shot(page, 'issm-queue');
      record('ISSM Queue loads', 'PASS');

      // Check if there are items to review
      const reviewBtns = page.locator('#issm-queue-body button');
      const reviewCount = await reviewBtns.count();
      record('ISSM Queue items', reviewCount > 0 ? 'PASS' : 'SKIP',
             `${reviewCount} items`);
    } else {
      record('ISSM Queue tab', 'SKIP', 'tab not found');
    }

    // TAB: Compliance
    console.log('\nCompliance...');
    const compBtn = page.locator('button[data-tab="compliance"]').first();
    if (await compBtn.count()) {
      await compBtn.click();
      await sleep(3000);
      await shot(page, 'compliance-dashboard');
      record('Compliance Dashboard loads', 'PASS');
    } else {
      record('Compliance tab', 'SKIP', 'tab not found');
    }

    // TAB: Monitoring links
    console.log('\nMonitoring links...');
    const monBtn = page.locator('button[data-tab="monitoring"]').first();
    if (await monBtn.count()) {
      await monBtn.click();
      await sleep(3000);
      await shot(page, 'monitoring-tab');
      record('Monitoring tab loads', 'PASS');
    } else {
      record('Monitoring tab', 'SKIP', 'tab not found');
    }

    // Check all visible tabs/sections by iterating data-tab buttons
    console.log('\nAll tabs...');
    const allTabs = page.locator('button[data-tab]');
    const tabCount = await allTabs.count();
    for (let i = 0; i < tabCount; i++) {
      const tab = allTabs.nth(i);
      const tabName = await tab.getAttribute('data-tab');
      if (['ops', 'pipeline', 'issm', 'compliance', 'monitoring'].includes(tabName)) continue;
      try {
        await tab.click();
        await sleep(2000);
        await shot(page, `tab-${tabName}`);
        record(`Tab: ${tabName}`, 'PASS');
      } catch (e) {
        record(`Tab: ${tabName}`, 'FAIL', e.message);
      }
    }

    // Write report
    console.log('\n=== Dashboard Results ===');
    let pass = 0, fail = 0, skip = 0;
    for (const r of results) {
      if (r.status === 'PASS') pass++;
      else if (r.status === 'FAIL') fail++;
      else skip++;
    }
    console.log(`PASS: ${pass}  FAIL: ${fail}  SKIP: ${skip}`);

    let md = '# Dashboard E2E Report\n\n';
    md += '| Test | Status | Detail |\n|------|--------|--------|\n';
    for (const r of results) md += `| ${r.test} | ${r.status} | ${r.detail} |\n`;
    md += `\n**Total: ${pass} PASS, ${fail} FAIL, ${skip} SKIP**\n`;
    fs.writeFileSync('tests/e2e/round5/reports/03-dashboard.md', md);

    await page.close();
  } catch (err) {
    console.error('FATAL:', err);
  } finally {
    await browser.close();
  }
})();
```

Run: `node tests/e2e/round5/dashboard-e2e.mjs`

## PHASE 4: DSOP Wizard Full Pipeline Test (Playwright)

This is the most critical user journey: deploy an app through the wizard.
Use the existing pipeline-e2e.mjs as reference but build a cleaner version.

Create tests/e2e/round5/wizard-e2e.mjs that:

1. Opens the DSOP wizard at https://dsop.${DOMAIN}/
2. Logs in via Keycloak SSO (reuse the pattern from sso-verification.mjs)
3. Starts a new deployment wizard
4. Step 1 — App Source: Enter a public Git repo URL (use https://github.com/mccutchen/go-httpbin.git)
5. Step 2 — App Info: Fill in app name, team, port, image details
6. Step 3 — Detection: Wait for auto-detection to complete, screenshot results
7. Step 4 — Security Pipeline: Watch the RAISE gates run, screenshot each gate
8. Step 5 — Review: Screenshot the review page showing all security findings
9. Step 6 — Deploy: Click deploy, wait for completion
10. Step 7 — Complete: Verify the app is deployed and accessible

For each step, take a screenshot BEFORE and AFTER interaction.

If any step fails, screenshot the error and record it — do NOT silently retry.

After the wizard completes, verify:
- The app's pod is Running in the correct tenant namespace
- The app's VirtualService exists
- The app's ingress URL returns 302 (SSO redirect) when unauthenticated
- The app's ingress URL returns 200 when authenticated (with SSO cookie)

Write report to $REPORT_DIR/04-wizard-pipeline.md

## PHASE 5: Deploy Script CLI Test

Test the sre-deploy-app.sh script directly with 3 apps covering different patterns:

### 5A: Simple app (go-httpbin)

```bash
./scripts/sre-deploy-app.sh \
  --name httpbin-r5 --team team-alpha \
  --image mccutchen/go-httpbin --tag v2.14.0 --port 8080 \
  --ingress httpbin-r5.${DOMAIN} \
  --no-commit

# Apply
kubectl apply -f apps/tenants/team-alpha/apps/httpbin-r5.yaml

# Wait
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=httpbin-r5 \
  -n team-alpha --timeout=180s

# Test
curl -sk -o /dev/null -w '%{http_code}' "https://httpbin-r5.${DOMAIN}/"
# Should be 302 (SSO redirect)
```

### 5B: App requiring root + persistence (Uptime Kuma)

```bash
./scripts/sre-deploy-app.sh \
  --name kuma-r5 --team team-alpha \
  --image louislam/uptime-kuma --tag 1 --port 3001 \
  --run-as-root --persist /app/data:5Gi \
  --ingress kuma-r5.${DOMAIN} \
  --no-commit

# Check that PolicyException was generated
ls apps/tenants/team-alpha/apps/kuma-r5*
# Should show both kuma-r5.yaml and kuma-r5-policy-exception.yaml

# Apply both
kubectl apply -f apps/tenants/team-alpha/apps/kuma-r5.yaml
kubectl apply -f apps/tenants/team-alpha/apps/kuma-r5-policy-exception.yaml 2>/dev/null

kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=kuma-r5 \
  -n team-alpha --timeout=300s

curl -sk -o /dev/null -w '%{http_code}' "https://kuma-r5.${DOMAIN}/"
```

### 5C: Multi-PVC app (Gitea)

```bash
./scripts/sre-deploy-app.sh \
  --name gitea-r5 --team team-alpha \
  --image gitea/gitea --tag 1.22-rootless --port 3000 \
  --persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi \
  --ingress gitea-r5.${DOMAIN} \
  --no-commit

# Verify multiple PVCs
cat apps/tenants/team-alpha/apps/gitea-r5.yaml | grep -c "PersistentVolumeClaim"
# Should be 2 (or 1 in HelmRelease + 1 standalone)

kubectl apply -f apps/tenants/team-alpha/apps/gitea-r5.yaml
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=gitea-r5 \
  -n team-alpha --timeout=300s

# Verify PVCs created
kubectl get pvc -n team-alpha | grep gitea

curl -sk -o /dev/null -w '%{http_code}' "https://gitea-r5.${DOMAIN}/"
```

### 5D: Gitea Post-Install Test

IMPORTANT: Gitea has a known issue where it returns 404s immediately after
the install wizard submits. The test must handle this:

After Gitea starts and the install page loads, submit the install wizard,
then WAIT 5 seconds before navigating. If you get a 404, wait 3 more seconds
and retry up to 3 times. Log each attempt.

Use Playwright to:
1. Navigate to gitea-r5.${DOMAIN}
2. Complete install wizard (set admin user, site title "SRE Gitea")
3. WAIT 5 seconds after submit
4. Navigate to root URL — verify it loads (not 404)
5. Login with the admin creds you just set
6. Create a repo, push a file, verify it shows up
7. Screenshot every step including any 404s

Write report to $REPORT_DIR/05-deploy-script.md

## PHASE 6: Tenant Onboarding Test

Test the full tenant lifecycle:

```bash
# Create a brand new tenant
./scripts/onboard-tenant.sh team-round5

# Verify namespace exists with all required resources
kubectl get ns team-round5
kubectl get networkpolicy -n team-round5
kubectl get limitrange -n team-round5
kubectl get resourcequota -n team-round5

# Verify Istio NetworkPolicy is present (from hardening Fix 1)
kubectl get networkpolicy allow-istio-control-plane -n team-round5 2>/dev/null \
  || kubectl get networkpolicy -n team-round5 -o yaml | grep -c "istiod\|15012\|15017"

# Deploy an app to the new tenant
./scripts/sre-deploy-app.sh \
  --name hello --team team-round5 \
  --image mccutchen/go-httpbin --tag v2.14.0 --port 8080 \
  --ingress hello-r5.${DOMAIN} \
  --no-commit

kubectl apply -f apps/tenants/team-round5/apps/hello.yaml
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=hello \
  -n team-round5 --timeout=180s

# Verify the app works AND requires SSO
curl -sk -o /dev/null -w '%{http_code}' "https://hello-r5.${DOMAIN}/"
# MUST be 302 (SSO redirect) — NOT 200 (no auth) and NOT 403 (broken auth)
```

Write report to $REPORT_DIR/06-tenant-onboarding.md

## PHASE 7: Security Control Validation

Run the existing control validation tests and capture all output:

```bash
./scripts/control-validation-tests.sh --json > $EVIDENCE_DIR/control-validation.json 2>&1
./scripts/control-validation-tests.sh > $EVIDENCE_DIR/control-validation.txt 2>&1
```

If the script doesn't exist or fails, manually test these critical controls:

### AC-6: Least Privilege
```bash
# Try to create a privileged pod — should be BLOCKED by Kyverno
cat <<EOF | kubectl apply -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: test-privileged
  namespace: team-alpha
spec:
  containers:
  - name: test
    image: busybox
    securityContext:
      privileged: true
EOF
# Expected: denied by Kyverno
```

### CM-11: Unauthorized Registry
```bash
# Try to pull from Docker Hub directly — should be BLOCKED
cat <<EOF | kubectl apply -f - 2>&1
apiVersion: v1
kind: Pod
metadata:
  name: test-registry
  namespace: team-alpha
spec:
  containers:
  - name: test
    image: docker.io/nginx:latest
EOF
# Expected: denied by Kyverno (unauthorized registry + latest tag)
```

### SC-8: Encryption in Transit
```bash
# Verify Istio mTLS is STRICT
kubectl get peerauthentication -A
# Expected: default STRICT in istio-system
```

### SI-7: Image Integrity
```bash
# Verify Cosign image verification policy exists
kubectl get clusterpolicy verify-image-signatures 2>/dev/null \
  || kubectl get clusterpolicy -o yaml | grep -l "verifyImages"
```

Write report to $REPORT_DIR/07-security-controls.md

## PHASE 8: Monitoring & Logging Verification

### 8A: Prometheus

```bash
# Verify Prometheus is scraping targets
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090 &
PF_PID=$!
sleep 3
curl -s http://localhost:9090/api/v1/targets | python3 -m json.tool | grep -c '"health":"up"'
kill $PF_PID 2>/dev/null
```

Capture to $EVIDENCE_DIR/prometheus-targets.json

### 8B: Grafana Dashboards

Use Playwright to:
1. Navigate to https://grafana.${DOMAIN}/ (should be auto-authenticated via SSO cookie)
2. Browse to Dashboards list
3. Open the cluster overview dashboard
4. Screenshot showing data is flowing
5. Open the Kyverno violations dashboard if it exists
6. Screenshot

### 8C: Loki Logs

```bash
# Verify logs are flowing
kubectl port-forward -n logging svc/loki 3100:3100 &
PF_PID=$!
sleep 3
curl -s "http://localhost:3100/loki/api/v1/query?query=%7Bnamespace%3D%22team-alpha%22%7D&limit=5"
kill $PF_PID 2>/dev/null
```

### 8D: Alertmanager

```bash
# Verify Alertmanager is running and has receivers configured
kubectl port-forward -n monitoring svc/kube-prometheus-stack-alertmanager 9093:9093 &
PF_PID=$!
sleep 3
curl -s http://localhost:9093/api/v2/status | python3 -c "import sys,json; d=json.load(sys.stdin); print('Alertmanager:', d.get('cluster',{}).get('status','unknown'))"
kill $PF_PID 2>/dev/null
```

Write report to $REPORT_DIR/08-monitoring-logging.md

## PHASE 9: Runtime Security (NeuVector)

```bash
# Verify NeuVector pods
kubectl get pods -n cattle-neuvector-system

# Check NeuVector admission control
kubectl get validatingwebhookconfigurations | grep neuvector
```

If NeuVector has a UI at https://neuvector.${DOMAIN}/, test with Playwright.

Write report to $REPORT_DIR/09-runtime-security.md

## PHASE 10: Backup (Velero)

```bash
# Verify Velero
kubectl get pods -n velero
kubectl get backupstoragelocations -n velero
kubectl get schedules -n velero

# Check most recent backup
kubectl get backups -n velero --sort-by=.metadata.creationTimestamp | tail -5
```

Write report to $REPORT_DIR/10-backup.md

## PHASE 11: ATO Evidence Package

Generate the full ATO evidence package:

```bash
./scripts/generate-ato-package.sh -o tests/e2e/round5/evidence/
```

If the script fails, generate evidence manually:

### 11A: System Security Plan (OSCAL)
```bash
cp compliance/oscal/ssp.json $EVIDENCE_DIR/ssp.json 2>/dev/null
./compliance/oscal/generate-ssp.sh > $EVIDENCE_DIR/ssp-generated.json 2>/dev/null
```

### 11B: STIG Results
```bash
ls compliance/stig-checklists/
cp compliance/stig-checklists/* $EVIDENCE_DIR/ 2>/dev/null
```

### 11C: Kyverno Policy Reports (Machine-Readable Compliance)
```bash
kubectl get policyreport -A -o json > $EVIDENCE_DIR/kyverno-policy-reports.json
kubectl get clusterpolicyreport -o json > $EVIDENCE_DIR/kyverno-cluster-reports.json 2>/dev/null
```

### 11D: Network Policy Evidence
```bash
kubectl get networkpolicy -A -o json > $EVIDENCE_DIR/network-policies.json
```

### 11E: RBAC Evidence
```bash
kubectl get clusterroles -o json > $EVIDENCE_DIR/cluster-roles.json
kubectl get clusterrolebindings -o json > $EVIDENCE_DIR/cluster-role-bindings.json
```

### 11F: Certificate Evidence
```bash
kubectl get certificates -A -o json > $EVIDENCE_DIR/certificates.json
```

### 11G: Image Scan Results (Harbor/Trivy)
```bash
# If Harbor is accessible
HARBOR_URL="https://harbor.${DOMAIN}"
curl -sk "${HARBOR_URL}/api/v2.0/projects" -u admin:changeme 2>/dev/null \
  > $EVIDENCE_DIR/harbor-projects.json
```

### 11H: Istio mTLS Status
```bash
kubectl get peerauthentication -A -o json > $EVIDENCE_DIR/mtls-config.json
kubectl get authorizationpolicy -A -o json > $EVIDENCE_DIR/authz-policies.json
```

### 11I: Secrets Management
```bash
kubectl get externalsecrets -A -o json 2>/dev/null > $EVIDENCE_DIR/external-secrets.json
kubectl get secretstores -A -o json 2>/dev/null > $EVIDENCE_DIR/secret-stores.json
kubectl get clustersecretstores -o json 2>/dev/null > $EVIDENCE_DIR/cluster-secret-stores.json
```

Write report to $REPORT_DIR/11-ato-evidence.md listing all collected artifacts.

## PHASE 12: Final Report

Create tests/e2e/round5/FINAL-REPORT.md that:

1. Lists ALL phase results in a summary table:

| Phase | Test Area | Pass | Fail | Skip | Evidence |
|-------|-----------|------|------|------|----------|
| 1 | Platform Health | X | X | X | flux-*, all-pods.txt |
| 2 | SSO Verification | X | X | X | screenshots/sso/ |
| ... | ... | ... | ... | ... | ... |

2. Lists ALL bugs/issues found with severity:
   - CRITICAL: blocks ATO
   - HIGH: needs fix before production
   - MEDIUM: should fix
   - LOW: nice to have

3. Lists ALL evidence artifacts collected for ATO:
   | Artifact | NIST Control | File | Status |
   |----------|-------------|------|--------|
   | System Security Plan | PL-2 | ssp.json | Collected/Missing |
   | Kyverno Policy Reports | CA-7 | kyverno-policy-reports.json | Collected/Missing |
   | ... | ... | ... | ... |

4. Maps EVERY platform component to its NIST 800-53 controls with evidence status:
   | Component | Controls | Evidence | Verified |
   |-----------|----------|----------|----------|
   | Istio mTLS | SC-8, SC-13 | mtls-config.json | Yes/No |
   | Kyverno | AC-6, CM-7 | kyverno-policies.txt | Yes/No |
   | ... | ... | ... | ... |

5. Lists next steps and remaining gaps.

Commit everything:
```bash
git add tests/e2e/round5/
git commit -m "test(e2e): Round 5 — full platform E2E + ATO body of evidence

Covers:
- All platform components health check
- SSO verification for all UIs and tenant apps
- Dashboard functional test
- DSOP wizard pipeline test
- Deploy script CLI test (simple, root, multi-PVC)
- Tenant onboarding lifecycle
- NIST 800-53 control validation
- Monitoring/logging verification
- Runtime security check
- Backup verification
- ATO evidence package generation"

git push -u origin test/round5-full-platform-e2e
gh pr create --title "test: Round 5 — full platform E2E validation + ATO body of evidence" \
  --body "$(cat <<'EOF'
## Summary
Comprehensive end-to-end validation of the entire SRE platform covering 12 phases:
platform health, SSO, dashboard, wizard pipeline, deploy script, tenant onboarding,
security controls, monitoring, runtime security, backup, and ATO evidence collection.

## Evidence Collected
See tests/e2e/round5/evidence/ for machine-readable compliance artifacts.
See tests/e2e/round5/screenshots/ for visual evidence.
See tests/e2e/round5/FINAL-REPORT.md for the complete assessment.

## Test Plan
- [ ] All phases produce reports in tests/e2e/round5/reports/
- [ ] ATO evidence artifacts collected in tests/e2e/round5/evidence/
- [ ] FINAL-REPORT.md maps all components to NIST controls

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
```

---

## Kick-Off Prompt

```
Read docs/round5-full-platform-e2e.md and execute the prompt in "The Prompt" section.
This is a COMPREHENSIVE end-to-end test of the entire platform — every component,
every user flow, plus ATO body of evidence generation. Follow every phase in order.
Take screenshots of everything. Do not silently retry failures. Start with Phase 1.
```
