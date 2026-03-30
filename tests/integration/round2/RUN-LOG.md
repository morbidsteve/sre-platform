# Integration Test Round 2 — Run Log

Started: 2026-03-30

## Phase 0: Round 1 Gap Closure
- **Status**: Complete
- PVC persistence added to all charts
- startupProbe support added
- command/args override in web-app and api-service
- Singleton worker mode added
- Deploy script: 13 new flags
- 3 documentation guides created
- Validation: uptime-kuma + wordpress deploy via script flags only

## Repo 1: Sock Shop (Microservices Demo)
- **Status**: Complete — 13 services, 0 failures
- See sock-shop/report.md

## Repo 2: NetBox (DCIM/IPAM)
- **Status**: Complete — 3 services, 0 failures
- See netbox/report.md

## Repo 3: n8n (Workflow Automation)
- **Status**: Complete — 2 services, 0 failures
- See n8n/report.md

## Repo 4: Gitea (Git Hosting)
- **Status**: Complete — 1 service (HTTP only), 0 failures
- See gitea/report.md

## Repo 5: Redash (Data Visualization)
- **Status**: Complete — 4 services, 0 failures
- See redash/report.md

## Synthesis
- SUMMARY.md — 16 issues across all 5 repos
- PLATFORM-MATURITY.md — 10 of 11 patterns ready
- FINAL-REPORT.md — 23/23 services deployed, 0 template failures
