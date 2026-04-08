const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const DASHBOARD_URL = 'https://dashboard.apps.sre.example.com';

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Login via OAuth2 flow
  console.log('Logging in...');
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(3000);
  await page.click('text=Sign in with Keycloak');
  await page.waitForURL(/keycloak/, { timeout: 15000 }).catch(() => {});
  await delay(2000);
  await page.fill('#username', 'sre-admin');
  await page.fill('#password', 'SreAdmin123!');
  await page.click('#kc-login');
  await page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {});
  await delay(5000);
  console.log('Logged in.');

  // Click the Admin tab directly (hash navigation doesn't work after OAuth redirect)
  console.log('Clicking Admin tab...');
  await delay(3000);
  const adminTab = await page.$('button:has-text("Admin")');
  if (adminTab) {
    await adminTab.click();
    console.log('Clicked Admin tab');
  } else {
    console.log('Admin tab button not found, trying hash navigation...');
    await page.goto(`${DASHBOARD_URL}/#admin`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  await delay(12000);

  // Check what we see
  const content = await page.textContent('body');
  if (content.includes('Access Denied')) {
    console.log('Access Denied detected - trying to reload with fresh auth...');
    // Force reload to re-check auth
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(10000);
  }

  const filepath = path.join(SCREENSHOT_DIR, '09-admin-tab.png');
  await page.screenshot({ path: filepath });
  console.log('Saved 09-admin-tab.png');

  // Check content
  const body = await page.textContent('body');
  console.log('Page contains:', body.substring(0, 200));

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
