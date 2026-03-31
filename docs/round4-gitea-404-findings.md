# Round 4 Gitea 404 Findings — Screenshot Analysis

## Discovery

The gitea-browser.md report claims 6/7 PASS, but reviewing the 21 screenshots
reveals the Playwright test actually FAILED its first run and silently retried.

## Screenshot Timeline (Two Separate Runs)

### First Run — FAILED (screenshots 01-10)

| # | File | What's Shown | Status |
|---|------|-------------|--------|
| 01 | initial-load | Gitea install page | OK |
| 02 | install-page | Install configuration form | OK |
| 03 | install-configured | Settings filled in | OK |
| 04 | admin-account-filled | Admin user form filled | OK |
| 05 | after-setup | Still on same admin form (didn't submit?) | SUSPECT |
| 06 | create-repo-page | **"Not Found. Go to default page."** | 404 |
| 07 | repo-form-filled | **Same "Not Found" text** | 404 |
| 08 | repo-with-push | **Big Gitea 404 — "does not exist or you are not authorized"** | 404 |
| 09 | tests-complete | **Same big 404** | 404 |
| 10 | tests-complete | **Same big 404** | 404 |

### Second Run — SUCCEEDED (screenshots 12-21)

| # | File | What's Shown | Status |
|---|------|-------------|--------|
| 12 | pw-debug | Gitea landing page ("SRE Gitea") — fresh navigation | OK |
| 13 | logged-in | Dashboard, sre-test user, 0 repos | OK |
| 17 | repo-form | New Repository form filled | OK |
| 18 | repo-created | sre-e2e-test repo with README | OK |
| 19 | repo-verify | Same repo view | OK |
| 20 | final | Same repo view | OK |
| 21 | repo-with-platform-md | PLATFORM.md pushed and visible | OK |

## Root Causes

### Bug A: Gitea post-install redirect 404

After submitting the install wizard, Gitea needs a moment to initialize before
all routes work. The first run submitted install → navigated immediately → hit
404s on every subsequent page. The second run worked because Gitea was already
configured from the first attempt.

**This is a real bug a human would hit too.** If someone completes the install
wizard and immediately tries to navigate, they'll see 404s.

**Fix:** The E2E test (and any deploy automation) should add a wait-and-retry
after install wizard submission. Something like:
```javascript
// After submitting install wizard
await page.waitForTimeout(3000);
await page.goto(baseUrl);
await page.waitForSelector('text=Sign In', { timeout: 30000 });
```

### Bug B: Silent test retry masks failures

The Playwright test script failed its first run entirely (5 consecutive 404s),
then silently restarted and succeeded on the second try. The report only
reflects the second run's results (6/7 PASS), making the test look much more
reliable than it actually is.

**Fix for E2E test framework:**
1. Each attempt should be logged separately in the report
2. Retries should be explicit: "Attempt 1: FAIL (post-install 404). Attempt 2: PASS"
3. Screenshots from failed attempts should be clearly labeled (prefix with "FAIL-")
4. The final report should note if retries were needed

## Impact on Platform Hardening

These findings add to the existing Gitea issues:
- **Existing:** Persistence failure — /etc/gitea/app.ini not on PVC (Fix 4 in hardening)
- **NEW:** Post-install 404 redirect — Gitea needs initialization delay after setup
- **NEW:** Test framework reliability — silent retries mask real failures

## Action Items for Claude Code

1. When testing Gitea deployment after the multi-PVC fix (hardening Fix 4):
   - After install wizard submission, wait 3-5 seconds before navigating
   - Verify the landing page loads before attempting login
   - If 404, retry navigation up to 3 times with 2s delay

2. Update the E2E test helper (sre-e2e.mjs) to:
   - Log all attempts, not just the final success
   - Include attempt number in screenshot filenames
   - Report retries explicitly in the test results

3. Consider adding a startup probe or readiness delay to the Gitea Helm values
   so Kubernetes doesn't route traffic to Gitea before it's fully initialized
   after first-run setup.
