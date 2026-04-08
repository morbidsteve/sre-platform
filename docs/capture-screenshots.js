const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const DASHBOARD_URL = 'https://dashboard.apps.sre.example.com';
const KEYCLOAK_USER = 'sre-admin';
const KEYCLOAK_PASS = 'SreAdmin123!';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function capture(page, name, opts = {}) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await delay(opts.wait || 2000);
  await page.screenshot({ path: filepath, fullPage: opts.fullPage || false });
  console.log(`  ✓ ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log('Navigating to dashboard...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await capture(page, '01-login-page', { wait: 3000 });

  // Click "Sign in with Keycloak"
  console.log('Signing in via Keycloak...');
  await page.click('text=Sign in with Keycloak');
  await page.waitForURL(/keycloak/, { timeout: 15000 }).catch(() => {});
  await delay(2000);
  await capture(page, '02-keycloak-login');

  // Fill Keycloak credentials
  await page.fill('#username', KEYCLOAK_USER);
  await page.fill('#password', KEYCLOAK_PASS);
  await page.click('#kc-login');
  await page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {});
  await delay(5000); // Wait for dashboard to fully load
  await capture(page, '03-overview-tab', { wait: 3000 });

  // Navigate to each tab and capture
  const tabs = [
    { hash: 'deploy', name: '04-deploy-tab', wait: 5000 },
    { hash: 'applications', name: '05-applications-tab', wait: 8000 },
    { hash: 'security', name: '06-security-tab', wait: 10000 },
    { hash: 'operations', name: '07-operations-tab', wait: 8000 },
    { hash: 'compliance', name: '08-compliance-tab', wait: 8000 },
    { hash: 'admin', name: '09-admin-tab', wait: 8000 },
  ];

  for (const tab of tabs) {
    console.log(`Capturing ${tab.hash}...`);
    await page.goto(`${DASHBOARD_URL}/#${tab.hash}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await capture(page, tab.name, { wait: tab.wait });
  }

  // Ctrl+K command palette
  console.log('Capturing command palette...');
  await page.goto(`${DASHBOARD_URL}/#overview`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(5000);
  await page.keyboard.press('Control+k');
  await delay(2000);
  await capture(page, '10-command-palette');
  await page.keyboard.press('Escape');

  // Operations > Health Checks
  console.log('Capturing health checks...');
  await page.goto(`${DASHBOARD_URL}/#operations`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(2000);
  // Click Health Checks subtab
  const healthTab = await page.$('button:has-text("HEALTH CHECKS")');
  if (healthTab) {
    await healthTab.click();
    await delay(2000);
    // Click Run Health Checks button
    const runBtn = await page.$('button:has-text("Run Health Checks")');
    if (runBtn) {
      await runBtn.click();
      await delay(5000);
    }
    await capture(page, '11-health-checks');
  }

  // Security > Pipeline Runs subtab
  console.log('Capturing pipeline runs...');
  await page.goto(`${DASHBOARD_URL}/#security`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(10000);
  await capture(page, '12-pipeline-runs');

  // Admin > Quick Links
  console.log('Capturing admin quick links...');
  await page.goto(`${DASHBOARD_URL}/#admin`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(8000);
  await capture(page, '09-admin-tab-users', { wait: 1000 });
  const linksTab = await page.$('button:has-text("QUICK LINKS")');
  if (linksTab) {
    await linksTab.click();
    await delay(3000);
    await capture(page, '13-admin-quick-links');
  }

  // Compliance > Live Report
  console.log('Capturing compliance...');
  await page.goto(`${DASHBOARD_URL}/#compliance`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await delay(8000);
  await capture(page, '14-compliance-tab');

  await browser.close();
  console.log('\nDone! Screenshots saved to docs/screenshots/');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
