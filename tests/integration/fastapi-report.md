# Integration Test Report: fastapi full-stack (backend only)

## App Summary

| Field | Value |
|-------|-------|
| Name | [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) |
| Language | Python (FastAPI + uvicorn) |
| Complexity | Medium — multi-container template (backend deployed, frontend/worker skipped) |
| Port | 8000 |
| Health Endpoint | `GET /api/v1/health-check/` |
| Image UID | 0 (root) |
| Notes | Full template has backend + frontend + celery worker + PostgreSQL |

## Issues Found

| # | Issue | Severity | Who Hits This | Fixed? |
|---|-------|----------|---------------|--------|
| 1 | Runs as root — needs security override | Medium | Same as uptime-kuma | Known — needs contract `securityContext` support |
| 2 | Port 8000 not in common presets but accepted | None | FastAPI/Django apps | Works — contract accepts any port 1-65535 |
| 3 | Multi-container pattern not documented | Medium | Docker Compose projects | Gap: need compose→SRE mapping guide |
| 4 | Database requires separate deployment | Low | Apps with PostgreSQL | Platform has CNPG — contract supports database.enabled |
| 5 | Custom health path `/api/v1/health-check/` works | None | | Contract probes field handled it |

## Verdict

**Backend deploys cleanly** with the api-service chart type. The App Contract handles non-standard ports (8000) and custom health paths. Main gap is the lack of documentation for mapping multi-container Docker Compose projects to SRE's chart types. The root-user issue is a known gap from repo 2.
