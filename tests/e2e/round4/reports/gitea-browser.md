# E2E Browser Test Report: gitea

**URL:** https://gitea.apps.sre.example.com
**Date:** 2026-03-31

## Test Results

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | Login to Gitea | ✅ PASS | sre-test user, dashboard loads |
| 2 | Create repository via UI | ✅ PASS | sre-e2e-test repo with README |
| 3 | Git clone via HTTPS | ✅ PASS | Cloned through Istio ingress |
| 4 | Git push via HTTPS | ✅ PASS | PLATFORM.md pushed to main |
| 5 | Pushed file visible in UI | ✅ PASS | PLATFORM.md in repo file list |
| 6 | API /version returns 200 | ✅ PASS | {"version":"1.22.6"} |
| 7 | Data persists after pod restart | ❌ FAIL | Config at /etc/gitea lost — need 2 PVCs |

## Persistence Bug

Gitea stores data at `/var/lib/gitea` (PVC mounted) but config at `/etc/gitea/app.ini` 
(not persisted). On pod restart, the app.ini is lost and Gitea reverts to install mode.

**Fix needed**: The deploy script should support multiple `--persist` flags, or the 
chart should support multiple PVC mounts.

## Screenshots

See screenshots/gitea/ for 21 screenshots covering the full E2E flow.
