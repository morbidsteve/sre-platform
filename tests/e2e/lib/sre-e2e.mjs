import { chromium } from 'playwright';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SRE_DOMAIN = process.env.SRE_DOMAIN || 'apps.sre.example.com';
const KEYCLOAK_USER = process.env.SRE_TEST_USER || 'sre-admin';
const KEYCLOAK_PASS = process.env.SRE_TEST_PASS || 'SreAdmin123!';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || 'round4/screenshots';

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

  async init() {
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    this.page = await context.newPage();
    return this;
  }

  async screenshot(label) {
    this.stepNumber++;
    const filename = `${String(this.stepNumber).padStart(2, '0')}-${label}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`  📸 ${filename}`);
    return filepath;
  }

  async navigateToApp() {
    console.log(`\n🌐 Navigating to ${this.appUrl}`);
    await this.page.goto(this.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await this.screenshot('initial-load');
    return this.page.url();
  }

  async handleSSOLogin() {
    const currentUrl = this.page.url();
    if (currentUrl.includes('keycloak') || currentUrl.includes('/auth/')) {
      console.log('🔐 Keycloak SSO login required');
      await this.screenshot('keycloak-login-page');
      await this.page.fill('#username', KEYCLOAK_USER);
      await this.page.fill('#password', KEYCLOAK_PASS);
      await this.screenshot('keycloak-credentials-filled');
      await this.page.click('#kc-login');
      await this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
      await this.screenshot('after-sso-login');
      console.log(`  ✅ Logged in, now at: ${this.page.url()}`);
      return true;
    }
    console.log('  ℹ️  No SSO redirect — app is directly accessible');
    return false;
  }

  record(test, passed, detail = '') {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${test}${detail ? ' — ' + detail : ''}`);
    this.results.push({ test, passed, detail, timestamp: new Date().toISOString() });
  }

  async waitForText(text, timeout = 10000) {
    try {
      await this.page.waitForSelector(`text=${text}`, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  async checkHttp(urlPath, expectedStatus = 200) {
    const url = urlPath.startsWith('http') ? urlPath : `${this.appUrl}${urlPath}`;
    try {
      const response = await this.page.request.get(url);
      return response.status() === expectedStatus;
    } catch {
      return false;
    }
  }

  generateReport() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    let report = `# E2E Browser Test Report: ${this.appName}\n\n`;
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
    try {
      const screenshots = fs.readdirSync(this.screenshotDir).filter(f => f.endsWith('.png')).sort();
      screenshots.forEach(f => {
        report += `![${f}](../screenshots/${this.appName}/${f})\n\n`;
      });
    } catch { /* no screenshots */ }
    return report;
  }

  async cleanup() {
    if (this.browser) await this.browser.close();
  }
}

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
    } catch { /* pod not created yet */ }
    execSync('sleep 5');
  }
  console.log(`  ❌ Timed out after ${timeoutSeconds}s`);
  return false;
}
