# E2E Browser Test Report: go-httpbin

**URL:** https://go-httpbin.apps.sre.example.com
**Date:** 2026-03-31T15:02:59.848Z
**Result:** 6/6 passed, 0 failed

## Test Results

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | App UI loads | ✅ PASS | httpbin content visible |
| 2 | GET /get returns 200 | ✅ PASS | Status: 200 |
| 3 | GET /headers returns 200 | ✅ PASS | Status: 200 |
| 4 | GET /status/418 returns 418 | ✅ PASS | Status: 418 |
| 5 | POST /post returns 200 | ✅ PASS | Status: 200 |
| 6 | GET /get renders JSON in browser | ✅ PASS |  |

## Screenshots

![01-initial-load.png](../screenshots/go-httpbin/01-initial-load.png)

![02-app-loaded.png](../screenshots/go-httpbin/02-app-loaded.png)

![03-get-endpoint-browser.png](../screenshots/go-httpbin/03-get-endpoint-browser.png)

![04-tests-complete.png](../screenshots/go-httpbin/04-tests-complete.png)

