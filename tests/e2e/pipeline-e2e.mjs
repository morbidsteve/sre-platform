#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const DASHBOARD_URL = 'https://dashboard.apps.sre.example.com';
const WIZARD_URL = 'https://dsop.apps.sre.example.com';
const SSO_USER = 'sre-admin';
const SSO_PASS = 'SreAdmin123!';
const SCREENSHOT_DIR = '/home/fscyber/sre/sre-platform/docs/images/pipeline';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
for (const f of fs.readdirSync(SCREENSHOT_DIR)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(SCREENSHOT_DIR, f));
}

let n = 0;
async function shot(page, name) {
  n++;
  const f = `${String(n).padStart(2,'0')}_${name}.png`;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, f) });
  console.log(`  [screenshot] ${f}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickBtn(page, pattern, timeout = 5000) {
  try {
    await page.locator('button', { hasText: new RegExp(pattern, 'i') }).first().click({ timeout });
    return true;
  } catch { return false; }
}

(async () => {
  console.log('=== DSOP Pipeline E2E Test ===\n');
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
    // ── LOGIN ────────────────────────────────────────────────────────
    console.log('1. Login via Keycloak SSO...');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1000);
    if (await page.locator('text=Sign in with Keycloak').count()) {
      await page.locator('text=Sign in with Keycloak').click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(2000);
    }
    if (await page.locator('#username').count()) {
      await page.fill('#username', SSO_USER);
      await page.fill('#password', SSO_PASS);
      await shot(page, 'keycloak_login');
      await page.click('#kc-login');
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(3000);
    }
    // Dismiss onboarding
    await page.evaluate(() => {
      const el = document.getElementById('onboard-overlay');
      if (el) { el.classList.remove('show'); el.style.display = 'none'; }
    });
    await sleep(500);
    await shot(page, 'dashboard_home');
    console.log('  Logged in\n');

    // ── PIPELINE HISTORY ─────────────────────────────────────────────
    console.log('2. Pipeline History tab...');
    await page.click('button[data-tab="pipeline"]');
    await sleep(4000); // give JS time to fetch
    await shot(page, 'pipeline_history');
    console.log('');

    // ── ISSM QUEUE ──────────────────────────────────────────────────
    console.log('3. ISSM Queue tab...');
    await page.click('button[data-tab="issm"]');
    await sleep(4000);
    await shot(page, 'issm_queue');

    // Click Review on first item if present
    const reviewBtns = page.locator('#issm-queue-body button');
    if (await reviewBtns.count() > 0) {
      await reviewBtns.first().click();
      await sleep(2000);
      await shot(page, 'issm_review_panel');

      // Scroll panel
      await page.evaluate(() => { const p = document.querySelector('.run-detail-panel'); if(p) p.scrollTop = 400; });
      await sleep(500);
      await shot(page, 'issm_review_gates');
      await page.evaluate(() => { const p = document.querySelector('.run-detail-panel'); if(p) p.scrollTop = p.scrollHeight; });
      await sleep(500);
      await shot(page, 'issm_review_form');

      // Approve
      await page.locator('input[value="approved"]').click().catch(() => {});
      await page.locator('.review-form textarea').fill('Approved - E2E test').catch(() => {});
      await shot(page, 'issm_approve_filled');
      await page.locator('.review-form button').first().click().catch(() => {});
      await sleep(3000);
      await shot(page, 'issm_approved');
      console.log('  Review submitted');

      await page.evaluate(() => { const o = document.getElementById('run-detail-overlay'); if(o) o.style.display='none'; });
      await sleep(500);
    }
    console.log('');

    // ── DSOP WIZARD ─────────────────────────────────────────────────
    console.log('4. DSOP Wizard...');
    await page.goto(WIZARD_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);
    // Re-auth if needed
    if (page.url().includes('oauth2') || page.url().includes('keycloak')) {
      if (await page.locator('text=Sign in with Keycloak').count()) {
        await page.locator('text=Sign in with Keycloak').click();
        await sleep(3000);
      }
      if (await page.locator('#username').count()) {
        await page.fill('#username', SSO_USER);
        await page.fill('#password', SSO_PASS);
        await page.click('#kc-login');
        await sleep(3000);
      }
    }

    await shot(page, 'wizard_step1');
    console.log('  Step 1: Source');

    // Fill git URL — placeholder is "https://github.com/org/repo.git"
    await page.locator('input[placeholder*="github"]').first().fill('https://github.com/linuxserver/docker-wireshark');
    await shot(page, 'wizard_step1_filled');

    // Click Next (the → Next button at bottom)
    await clickBtn(page, 'Next');
    await sleep(2000);

    // Step 2: App Info — fill using label text associations
    console.log('  Step 2: App Info');

    // App Name — placeholder is "my-app"
    await page.locator('input[placeholder="my-app"]').fill('wireshark-e2e');

    // Description — placeholder is "Brief description of this application"
    await page.locator('input[placeholder*="Brief description"], textarea[placeholder*="Brief description"]').first().fill('Wireshark network analyzer');

    // Contact Email — placeholder contains "operator@" or "email"
    await page.locator('input[placeholder*="operator"], input[placeholder*="email" i]').first().fill('admin@sre.example.com').catch(() => {});

    await shot(page, 'wizard_step2_filled');

    // Click Analyze/Next - the button text says "Analyze & Continue" or "Next"
    // Scroll down first to see the button
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(500);

    const clicked = await clickBtn(page, 'Analyze') || await clickBtn(page, 'Next') || await clickBtn(page, 'Continue');
    console.log(`  Clicked analyze: ${clicked}`);

    // Wait for analysis (calls deploy/git API with analyze_only)
    console.log('  Analyzing...');
    await sleep(15000);
    await shot(page, 'wizard_step3_detection');
    console.log('  Step 3: Detection');

    // Start Security Pipeline button
    const pipeStarted = await clickBtn(page, 'Start Security Pipeline') ||
                         await clickBtn(page, 'Run Pipeline') ||
                         await clickBtn(page, 'Start Pipeline') ||
                         await clickBtn(page, 'Security');
    console.log(`  Started pipeline: ${pipeStarted}`);
    await sleep(5000);
    await shot(page, 'wizard_step4_scanning');
    console.log('  Step 4: Scanning...');

    // Wait for pipeline (up to 5 min)
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      if (i === 11) await shot(page, 'wizard_step4_progress_1min');
      if (i === 23) await shot(page, 'wizard_step4_progress_2min');

      const bodyText = await page.locator('body').textContent();
      if (bodyText.includes('Submit for ISSM') || bodyText.includes('review_pending') || bodyText.includes('Awaiting ISSM')) {
        console.log(`  Pipeline done after ${(i+1)*5}s`);
        break;
      }
    }
    await shot(page, 'wizard_step4_complete');

    // Submit for review
    const submitted = await clickBtn(page, 'Submit for ISSM') || await clickBtn(page, 'Submit.*Review');
    console.log(`  Submitted for review: ${submitted}`);
    await sleep(3000);
    await shot(page, 'wizard_submitted');

    // Next to review step
    await clickBtn(page, 'Next') || await clickBtn(page, 'Continue');
    await sleep(2000);
    await shot(page, 'wizard_step5_review');
    console.log('  Step 5: Review\n');

    // ── BACK TO DASHBOARD ───────────────────────────────────────────
    console.log('5. Dashboard final check...');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    await page.evaluate(() => {
      const el = document.getElementById('onboard-overlay');
      if (el) { el.classList.remove('show'); el.style.display = 'none'; }
    });

    await page.click('button[data-tab="pipeline"]');
    await sleep(4000);
    await shot(page, 'pipeline_final');

    // Click first run to show detail
    const rows = page.locator('#pipeline-runs-body tr');
    if (await rows.count() > 0) {
      await rows.first().click();
      await sleep(2000);
      await shot(page, 'run_detail');
      await page.evaluate(() => { const p = document.querySelector('.run-detail-panel'); if(p) p.scrollTop = 400; });
      await sleep(500);
      await shot(page, 'run_detail_gates');
      await page.evaluate(() => { const p = document.querySelector('.run-detail-panel'); if(p) p.scrollTop = p.scrollHeight; });
      await sleep(500);
      await shot(page, 'run_detail_audit');
      await page.evaluate(() => { const o = document.getElementById('run-detail-overlay'); if(o) o.style.display='none'; });
    }

    await page.click('button[data-tab="issm"]');
    await sleep(4000);
    await shot(page, 'issm_final');

    await page.click('button[data-tab="overview"]');
    await sleep(2000);
    await shot(page, 'overview_final');

    console.log('\n=== E2E Test Complete ===');

  } catch (err) {
    console.error('\nERROR:', err.message);
    await shot(page, 'error');
  } finally {
    await browser.close();
  }

  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).sort();
  console.log(`\nScreenshots: ${SCREENSHOT_DIR}/ (${files.length} files)`);
  files.forEach(f => console.log(`  ${f}`));
})();
