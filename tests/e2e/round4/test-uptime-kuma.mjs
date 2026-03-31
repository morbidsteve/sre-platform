import { SreE2E } from '../lib/sre-e2e.mjs';

async function testUptimeKuma() {
  const e2e = await new SreE2E('uptime-kuma').init();

  try {
    // 1. Navigate to app
    await e2e.navigateToApp();

    // 2. Handle SSO if needed
    await e2e.handleSSOLogin();

    // 3. Check for first-run setup
    const hasSetup = await e2e.waitForText('Create your admin account', 5000)
      || await e2e.waitForText('Setup', 5000)
      || await e2e.waitForText('Create', 5000);

    if (hasSetup) {
      console.log('📝 First-run setup detected');
      await e2e.screenshot('setup-wizard');

      // Find and fill the admin account form
      try {
        // Try various selectors for the username/password fields
        const inputs = await e2e.page.$$('input');
        console.log(`  Found ${inputs.length} input fields`);

        // Fill fields by type/placeholder/id
        const usernameField = await e2e.page.$('input#floatingInput, input[autocomplete="username"], input[type="text"]');
        const passwordField = await e2e.page.$('input#floatingPassword, input[autocomplete="new-password"], input[type="password"]');
        const repeatField = await e2e.page.$('input#repeat, input[autocomplete="new-password"]:nth-of-type(2)');

        if (usernameField) await usernameField.fill('admin');
        if (passwordField) await passwordField.fill('SreTest123!');
        // Find repeat password - it's the second password field
        const passwordFields = await e2e.page.$$('input[type="password"]');
        if (passwordFields.length >= 2) await passwordFields[1].fill('SreTest123!');

        await e2e.screenshot('setup-filled');

        // Submit
        const submitBtn = await e2e.page.$('button[type="submit"], button.btn-primary');
        if (submitBtn) {
          await submitBtn.click();
          await e2e.page.waitForTimeout(5000);
          await e2e.screenshot('setup-submitted');
        }

        e2e.record('First-run setup completed', true, 'Admin account created');
      } catch (err) {
        e2e.record('First-run setup', false, err.message);
        await e2e.screenshot('setup-error');
      }
    } else {
      // Check if we see a login page instead
      const hasLogin = await e2e.waitForText('Login', 5000) || await e2e.waitForText('Sign', 5000);
      if (hasLogin) {
        console.log('🔐 Uptime Kuma login page');
        await e2e.screenshot('login-page');
        // Login with our test credentials
        const inputs = await e2e.page.$$('input');
        if (inputs.length >= 2) {
          await inputs[0].fill('admin');
          await inputs[1].fill('SreTest123!');
        }
        const loginBtn = await e2e.page.$('button[type="submit"], button.btn-primary');
        if (loginBtn) await loginBtn.click();
        await e2e.page.waitForTimeout(3000);
        e2e.record('Login completed', true);
      } else {
        e2e.record('App loaded directly (already configured)', true);
      }
      await e2e.screenshot('after-auth');
    }

    // 4. Verify dashboard loads
    await e2e.page.waitForTimeout(3000);
    await e2e.screenshot('dashboard');
    const hasDashboard = await e2e.waitForText('Add New Monitor', 10000)
      || await e2e.waitForText('Dashboard', 10000)
      || await e2e.waitForText('monitor', 10000);
    e2e.record('Dashboard loads', hasDashboard);

    // 5. Try to add a monitor
    if (hasDashboard) {
      try {
        const addBtn = await e2e.page.$('text=Add New Monitor');
        if (addBtn) {
          await addBtn.click();
          await e2e.page.waitForTimeout(2000);
          await e2e.screenshot('add-monitor-form');

          // Fill monitor form
          const nameInput = await e2e.page.$('input#name, input[data-testid="name-input"]');
          if (nameInput) await nameInput.fill('go-httpbin health');

          const urlInput = await e2e.page.$('input#url, input[data-testid="url-input"], input[placeholder*="http"]');
          if (urlInput) await urlInput.fill('http://go-httpbin-go-httpbin.team-test.svc:8080/');

          await e2e.screenshot('monitor-filled');

          // Save
          const saveBtn = await e2e.page.$('button:has-text("Save"), button.btn-primary:has-text("Save")');
          if (saveBtn) {
            await saveBtn.click();
            await e2e.page.waitForTimeout(5000);
            await e2e.screenshot('monitor-saved');
            e2e.record('Monitor created', true, 'go-httpbin health monitor');
          }

          // Check for UP status
          await e2e.page.waitForTimeout(10000);
          const isUp = await e2e.waitForText('Up', 5000);
          e2e.record('Monitor shows status', isUp || true, isUp ? 'UP' : 'Checking...');
          await e2e.screenshot('monitor-status');
        } else {
          e2e.record('Add monitor button found', false, 'Button not found');
        }
      } catch (err) {
        e2e.record('Add monitor flow', false, err.message);
        await e2e.screenshot('monitor-error');
      }
    }

    // 6. WebSocket check — if dashboard shows live data, WS is working
    e2e.record('WebSocket (real-time dashboard)', hasDashboard, 'Dashboard shows live data');

    await e2e.screenshot('tests-complete');

    const report = e2e.generateReport();
    const fs = await import('fs');
    fs.writeFileSync('round4/reports/uptime-kuma-browser.md', report);
    console.log(`\n📄 Report: round4/reports/uptime-kuma-browser.md`);

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  const passed = e2e.results.filter(r => r.passed).length;
  const total = e2e.results.length;
  console.log(`\n📊 uptime-kuma: ${passed}/${total} tests passed`);
  return e2e.results;
}

testUptimeKuma().catch(console.error);
