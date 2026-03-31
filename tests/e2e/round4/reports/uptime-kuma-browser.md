# E2E Browser Test Report: uptime-kuma

**URL:** https://uptime-kuma.apps.sre.example.com
**Date:** 2026-03-31T15:04:10.816Z
**Result:** 5/5 passed, 0 failed

## Test Results

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | First-run setup completed | ✅ PASS | Admin account created |
| 2 | Dashboard loads | ✅ PASS |  |
| 3 | Monitor created | ✅ PASS | go-httpbin health monitor |
| 4 | Monitor shows status | ✅ PASS | UP |
| 5 | WebSocket (real-time dashboard) | ✅ PASS | Dashboard shows live data |

## Screenshots

![01-initial-load.png](../screenshots/uptime-kuma/01-initial-load.png)

![02-setup-wizard.png](../screenshots/uptime-kuma/02-setup-wizard.png)

![03-setup-filled.png](../screenshots/uptime-kuma/03-setup-filled.png)

![04-setup-submitted.png](../screenshots/uptime-kuma/04-setup-submitted.png)

![05-dashboard.png](../screenshots/uptime-kuma/05-dashboard.png)

![06-add-monitor-form.png](../screenshots/uptime-kuma/06-add-monitor-form.png)

![07-monitor-filled.png](../screenshots/uptime-kuma/07-monitor-filled.png)

![08-monitor-saved.png](../screenshots/uptime-kuma/08-monitor-saved.png)

![09-monitor-status.png](../screenshots/uptime-kuma/09-monitor-status.png)

![10-tests-complete.png](../screenshots/uptime-kuma/10-tests-complete.png)

