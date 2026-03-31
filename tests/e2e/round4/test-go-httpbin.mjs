import { SreE2E } from '../lib/sre-e2e.mjs';

async function testGoHttpbin() {
  const e2e = await new SreE2E('go-httpbin').init();

  try {
    // 1. Navigate to app
    const url = await e2e.navigateToApp();

    // 2. Handle SSO if redirected
    await e2e.handleSSOLogin();

    // 3. Verify the httpbin UI loaded
    const hasTitle = await e2e.waitForText('go-httpbin', 10000)
      || await e2e.waitForText('httpbin', 10000)
      || await e2e.waitForText('HTTP Methods', 10000);
    e2e.record('App UI loads', hasTitle, hasTitle ? 'httpbin content visible' : 'Content not found');
    await e2e.screenshot('app-loaded');

    // 4. Test GET /get endpoint via API
    const getResp = await e2e.page.request.get(`${e2e.appUrl}/get`);
    const getStatus = getResp.status();
    e2e.record('GET /get returns 200', getStatus === 200, `Status: ${getStatus}`);

    // 5. Test /headers endpoint
    const headersResp = await e2e.page.request.get(`${e2e.appUrl}/headers`);
    e2e.record('GET /headers returns 200', headersResp.status() === 200, `Status: ${headersResp.status()}`);

    // 6. Test /status endpoint
    const statusResp = await e2e.page.request.get(`${e2e.appUrl}/status/418`);
    e2e.record('GET /status/418 returns 418', statusResp.status() === 418, `Status: ${statusResp.status()}`);

    // 7. Test POST /post
    const postResp = await e2e.page.request.post(`${e2e.appUrl}/post`, {
      data: { test: 'hello from SRE platform E2E' }
    });
    e2e.record('POST /post returns 200', postResp.status() === 200, `Status: ${postResp.status()}`);

    // 8. Navigate to /get page in browser
    await e2e.page.goto(`${e2e.appUrl}/get`, { waitUntil: 'networkidle', timeout: 10000 });
    await e2e.screenshot('get-endpoint-browser');
    const hasJson = await e2e.waitForText('headers', 5000);
    e2e.record('GET /get renders JSON in browser', hasJson);

    await e2e.screenshot('tests-complete');

    // Write report
    const report = e2e.generateReport();
    const fs = await import('fs');
    fs.writeFileSync('round4/reports/go-httpbin-browser.md', report);
    console.log(`\n📄 Report: round4/reports/go-httpbin-browser.md`);

  } catch (error) {
    console.error(`❌ Test failed with error: ${error.message}`);
    await e2e.screenshot('error-state');
    e2e.record('Test execution', false, error.message);
  } finally {
    await e2e.cleanup();
  }

  // Print summary
  const passed = e2e.results.filter(r => r.passed).length;
  const total = e2e.results.length;
  console.log(`\n📊 go-httpbin: ${passed}/${total} tests passed`);
  return e2e.results;
}

testGoHttpbin().catch(console.error);
