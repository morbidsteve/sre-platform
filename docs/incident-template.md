# Incident Report: [INCIDENT-YYYY-NNN] [Brief Title]

**Severity:** [SEV-1 / SEV-2 / SEV-3 / SEV-4]
**Status:** [Investigating / Identified / Monitoring / Resolved]
**Incident Commander:** [Name]
**Date Opened:** [YYYY-MM-DD HH:MM UTC]
**Date Resolved:** [YYYY-MM-DD HH:MM UTC]
**Duration:** [Xh Ym]

---

## Timeline

All times in UTC.

| Time | Action |
|------|--------|
| HH:MM | Alert fired / Issue reported: [description] |
| HH:MM | Incident declared, IC assigned |
| HH:MM | Root cause identified |
| HH:MM | Fix deployed / Mitigation applied |
| HH:MM | Service restored, monitoring |
| HH:MM | Incident resolved |

## Impact

- **Services affected:** [List services, e.g., dashboard, pipeline, Harbor]
- **Users affected:** [Number or scope, e.g., "all platform users", "team-alpha deployments"]
- **Data loss:** [Yes/No — describe if yes]
- **SLA impact:** [Was any SLA breached? Which one?]
- **Security impact:** [Any security implications? Unauthorized access? Data exposure?]

### Impact metrics

| Metric | Value |
|--------|-------|
| Duration of user-facing impact | [Xh Ym] |
| Number of affected deployments | [N] |
| Failed pipeline runs | [N] |
| Error rate during incident | [X%] |

## Root Cause

[Describe the root cause clearly and specifically. What broke and why? Include the chain of events that led to the failure.]

### Contributing factors

- [Factor 1: e.g., "Missing resource limits on pod allowed OOM"]
- [Factor 2: e.g., "Alert threshold too high, delayed detection"]
- [Factor 3: e.g., "Runbook was outdated"]

## Resolution

[What was done to fix the issue? Include specific commands, commits, or config changes.]

```
# Example commands or config changes applied
kubectl rollout restart deployment/affected-service -n namespace
```

**Commit/PR:** [Link to fix commit or PR]

## Action Items

Each action item should have an owner and a due date.

| Priority | Action | Owner | Due Date | Status |
|----------|--------|-------|----------|--------|
| P1 | [Immediate fix or guard rail] | [Name] | [Date] | [ ] |
| P2 | [Prevent recurrence] | [Name] | [Date] | [ ] |
| P2 | [Improve detection] | [Name] | [Date] | [ ] |
| P3 | [Process improvement] | [Name] | [Date] | [ ] |

## Lessons Learned

### What went well

- [e.g., "Alert fired within 2 minutes of the issue"]
- [e.g., "Runbook was accurate and easy to follow"]
- [e.g., "Team assembled quickly"]

### What went poorly

- [e.g., "Took 30 minutes to identify root cause"]
- [e.g., "No runbook existed for this scenario"]
- [e.g., "Communication was unclear during the incident"]

### Where we got lucky

- [e.g., "Low traffic period minimized user impact"]
- [e.g., "Recent backup was available"]

---

## NIST 800-53 Controls Referenced

- **IR-4**: Incident Handling
- **IR-5**: Incident Monitoring
- **IR-6**: Incident Reporting
- **IR-8**: Incident Response Plan

## Appendix

### Related alerts

- [Alert name and link to Grafana dashboard]

### Relevant logs

```
[Paste key log entries here]
```

### Grafana dashboard links

- [Link to relevant dashboard during incident timeframe]
