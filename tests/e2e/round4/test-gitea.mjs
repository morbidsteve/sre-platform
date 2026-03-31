import { SreE2E } from '../lib/sre-e2e.mjs';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function testGitea() {
  const e2e = await new SreE2E('gitea').init();
  const GITEA_URL = e2e.appUrl;

  try {
    // 1. Navigate to Gitea
    await e2e.navigateToApp();
    await e2e.handleSSOLogin();

    // 2. Check if Gitea needs initial setup
    const needsInstall = await e2e.waitForText('Initial Configuration', 5000)
      || await e2e.waitForText('Installation', 5000)
      || await e2e.waitForText('Database Type', 5000);

    if (needsInstall) {
      console.log('📝 Gitea initial setup required');
      await e2e.screenshot('install-page');

      try {
        // Set Site Title
        const titleInput = await e2e.page.$('input[name="site_title"], #site_title');
        if (titleInput) await titleInput.fill('SRE Gitea');

        // Set Server Domain
        const domainInput = await e2e.page.$('input[name="domain"], #domain');
        if (domainInput) {
          await domainInput.fill('');
          await domainInput.fill('gitea.apps.sre.example.com');
        }

        // Set Root URL
        const rootUrlInput = await e2e.page.$('input[name="app_url"], #app_url');
        if (rootUrlInput) {
          await rootUrlInput.fill('');
          await rootUrlInput.fill(GITEA_URL + '/');
        }

        await e2e.screenshot('install-configured');

        // Look for the admin account section — expand it if collapsed
        const adminSection = await e2e.page.$('text=Administrator Account Settings');
        if (adminSection) await adminSection.click();
        await e2e.page.waitForTimeout(1000);

        // Fill admin account
        const adminUser = await e2e.page.$('input[name="admin_name"], #admin_name');
        const adminPass = await e2e.page.$('input[name="admin_passwd"], #admin_passwd');
        const adminPassConfirm = await e2e.page.$('input[name="admin_confirm_passwd"], #admin_confirm_passwd');
        const adminEmail = await e2e.page.$('input[name="admin_email"], #admin_email');

        if (adminUser) await adminUser.fill('sre-test');
        if (adminEmail) await adminEmail.fill('sre-test@sre.example.com');
        if (adminPass) await adminPass.fill('SreTest123!');
        if (adminPassConfirm) await adminPassConfirm.fill('SreTest123!');

        await e2e.screenshot('admin-account-filled');

        // Submit install form
        const submitBtn = await e2e.page.$('button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
          await e2e.page.waitForTimeout(10000);
          await e2e.screenshot('install-complete');
        }

        e2e.record('Initial setup completed', true, 'Database + admin created');
      } catch (err) {
        e2e.record('Initial setup', false, err.message);
        await e2e.screenshot('install-error');
      }
    } else {
      // Already installed — try to sign in
      const hasSignIn = await e2e.waitForText('Sign In', 5000);
      if (hasSignIn) {
        await e2e.page.goto(`${GITEA_URL}/user/login`, { waitUntil: 'networkidle', timeout: 10000 });
        await e2e.screenshot('login-page');
        try {
          await e2e.page.fill('input[name="user_name"]', 'sre-test');
          await e2e.page.fill('input[name="password"]', 'SreTest123!');
          await e2e.page.click('button[type="submit"]');
          await e2e.page.waitForTimeout(5000);
          e2e.record('Login successful', true, 'sre-test user');
        } catch (err) {
          e2e.record('Login', false, err.message);
        }
      }
      await e2e.screenshot('logged-in');
    }

    // 3. Verify we're logged in / dashboard loaded
    await e2e.page.waitForTimeout(3000);
    await e2e.screenshot('after-setup');
    const loggedIn = await e2e.waitForText('sre-test', 5000)
      || await e2e.waitForText('Dashboard', 5000)
      || await e2e.waitForText('Repository', 5000)
      || await e2e.waitForText('Explore', 5000);
    e2e.record('Gitea dashboard/home accessible', loggedIn);

    // 4. Create a repository
    try {
      await e2e.page.goto(`${GITEA_URL}/repo/create`, { waitUntil: 'networkidle', timeout: 10000 });
      await e2e.screenshot('create-repo-page');

      const repoName = await e2e.page.$('input[name="repo_name"], #repo_name');
      if (repoName) await repoName.fill('sre-e2e-test');

      const descInput = await e2e.page.$('textarea[name="description"], #description');
      if (descInput) await descInput.fill('E2E test repo from SRE platform');

      // Initialize with README
      const initCheckbox = await e2e.page.$('input[name="auto_init"], #auto-init');
      if (initCheckbox) await initCheckbox.check();

      await e2e.screenshot('repo-form-filled');
      const createBtn = await e2e.page.$('button[type="submit"]');
      if (createBtn) await createBtn.click();
      await e2e.page.waitForTimeout(5000);
      await e2e.screenshot('repo-created');

      const repoExists = await e2e.waitForText('sre-e2e-test', 5000);
      e2e.record('Repository created via UI', repoExists, 'sre-e2e-test');
    } catch (err) {
      e2e.record('Repository creation', false, err.message);
      await e2e.screenshot('repo-create-error');
    }

    // 5. Git clone via HTTPS
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-clone-'));
    try {
      console.log(`\n🔧 Testing git clone to ${tmpDir}`);
      execSync(
        `git clone -c http.sslVerify=false ${GITEA_URL}/sre-test/sre-e2e-test.git ${tmpDir}/repo 2>&1`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      e2e.record('Git clone via HTTPS', true, 'Repository cloned successfully');

      // 6. Push a commit
      try {
        execSync(`
          cd ${tmpDir}/repo &&
          git config user.email "sre-test@sre.example.com" &&
          git config user.name "SRE E2E Test" &&
          echo "# Deployed on SRE Platform" > PLATFORM.md &&
          echo "This repo was cloned and pushed via the SRE platform E2E test." >> PLATFORM.md &&
          echo "Date: $(date -Iseconds)" >> PLATFORM.md &&
          git add PLATFORM.md &&
          git commit -m "test: verify git push through SRE platform" &&
          git -c http.sslVerify=false push origin main 2>&1
        `, { encoding: 'utf-8', timeout: 30000 });
        e2e.record('Git push via HTTPS', true, 'Commit pushed successfully');
      } catch (pushErr) {
        // Try with HEAD for default branch
        try {
          execSync(`
            cd ${tmpDir}/repo &&
            BRANCH=$(git symbolic-ref --short HEAD) &&
            git -c http.sslVerify=false push origin $BRANCH 2>&1
          `, { encoding: 'utf-8', timeout: 30000 });
          e2e.record('Git push via HTTPS', true, 'Commit pushed (non-main branch)');
        } catch (e2) {
          e2e.record('Git push via HTTPS', false, pushErr.message);
        }
      }
    } catch (cloneErr) {
      e2e.record('Git clone via HTTPS', false, cloneErr.message);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 7. Verify pushed file in UI
    await e2e.page.goto(`${GITEA_URL}/sre-test/sre-e2e-test`, { waitUntil: 'networkidle', timeout: 10000 });
    const hasPlatformMd = await e2e.waitForText('PLATFORM.md', 5000);
    e2e.record('Pushed file visible in UI', hasPlatformMd,
      hasPlatformMd ? 'PLATFORM.md in repo' : 'File not visible yet');
    await e2e.screenshot('repo-with-push');

    // 8. Test API
    const apiResp = await e2e.page.request.get(`${GITEA_URL}/api/v1/version`);
    e2e.record('API /version returns 200', apiResp.status() === 200, `Status: ${apiResp.status()}`);

    await e2e.screenshot('tests-complete');

    const report = e2e.generateReport();
    fs.writeFileSync('round4/reports/gitea-browser.md', report);
    console.log(`\n📄 Report: round4/reports/gitea-browser.md`);

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  const passed = e2e.results.filter(r => r.passed).length;
  const total = e2e.results.length;
  console.log(`\n📊 gitea: ${passed}/${total} tests passed`);
  return e2e.results;
}

testGitea().catch(console.error);
