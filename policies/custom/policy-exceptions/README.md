# Kyverno Policy Exceptions

This directory contains approved policy exceptions for the SRE platform. Every exception must go through the formal request and approval process described below.

## What Is a Policy Exception?

A Kyverno `PolicyException` allows specific workloads to bypass one or more policy rules. This is used when a legitimate workload cannot comply with a platform policy due to technical constraints (e.g., a security scanner that requires privileged access, or a legacy application that must run as root during migration).

Exceptions do NOT disable the policy cluster-wide. They only exempt the specific resources defined in the `match` block.

## How to Request an Exception

1. **Copy the template**: Copy `policies/custom/policy-exception-template.yaml` to this directory with a descriptive filename:
   ```
   policies/custom/policy-exceptions/<team>-<reason>.yaml
   ```
   Example: `team-alpha-privileged-scanner.yaml`

2. **Fill in all fields**:
   - `metadata.name`: Use the pattern `<team>-<reason>` (e.g., `team-alpha-privileged-scanner`)
   - `metadata.namespace`: Your team namespace
   - `sre.io/exception-reason`: Clear technical justification for why the policy cannot be met
   - `sre.io/exception-expiry`: Expiration date (maximum 90 days from request)
   - `sre.io/ticket`: Link to the tracking ticket (JIRA, GitHub issue, etc.)
   - `spec.exceptions[].policyName`: The exact ClusterPolicy name being exempted
   - `spec.exceptions[].ruleNames`: The specific rule(s) within that policy
   - `spec.match`: Scope the exception as narrowly as possible (specific pod names, not entire namespaces)

3. **Submit a pull request**: Create a PR from a branch named `exception/<team>-<reason>`. The PR description must include:
   - What the workload does and why it needs the exception
   - What compensating controls are in place (e.g., "NeuVector runtime monitoring is enabled for this pod")
   - The planned remediation to eliminate the exception before expiry

4. **Platform team review**: A member of the platform team reviews the PR. They verify:
   - The exception is scoped as narrowly as possible
   - Compensating controls are adequate
   - The expiry date is within the 90-day maximum
   - The tracking ticket exists and is linked

5. **Approval**: The platform team reviewer fills in the `sre.io/exception-approver` annotation with their name and approves the PR.

## Required Annotations

| Annotation | Required | Description |
|---|---|---|
| `sre.io/exception-reason` | Yes | Technical justification for the exception |
| `sre.io/exception-approver` | Yes | Name of the platform team member who approved |
| `sre.io/exception-expiry` | Yes | ISO 8601 date (YYYY-MM-DD), max 90 days from request |
| `sre.io/ticket` | Yes | Link to JIRA ticket or GitHub issue tracking this exception |

## Expiry Policy

- All exceptions have a **maximum lifetime of 90 days**.
- Teams must submit a new exception request before the current one expires if the exception is still needed.
- Renewal requests require updated justification explaining why the exception has not been remediated.
- Expired exceptions are removed during weekly compliance sweeps. If the workload still violates the policy after the exception is removed, Kyverno will block new pod creation (for Enforce-mode policies) or flag violations in policy reports (for Audit-mode policies).

## Auditing Exceptions

Active exceptions are audited through multiple mechanisms:

1. **Kyverno Policy Reports**: `kubectl get policyreport -A` shows all policy violations and exceptions. Exceptions appear as `skip` results in the report.

2. **Prometheus Metrics**: Kyverno exports metrics on policy exceptions. The SRE Grafana dashboard under "Kyverno Policy Compliance" shows active exceptions by namespace and policy.

3. **Git History**: Every exception is tracked in Git with full PR review history. Run `git log --oneline -- policies/custom/policy-exceptions/` to see the audit trail.

4. **Weekly Compliance Report**: The `scripts/compliance-report.sh` script includes a section listing all active PolicyExceptions and their expiry dates.

## Scope Best Practices

Always scope exceptions as narrowly as possible:

```yaml
# GOOD: Specific pod name pattern in a specific namespace
spec:
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - team-alpha
          names:
            - "security-scanner-*"

# BAD: All pods in a namespace (too broad)
spec:
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - team-alpha
```

## Common Exceptions

| Policy | Typical Reason | Compensating Control |
|---|---|---|
| `disallow-privileged-containers` | Security scanner (NeuVector, kube-bench) | Runtime monitoring via NeuVector, limited to scanning namespace |
| `require-run-as-nonroot` | Legacy app migration in progress | Network policy isolation, scheduled migration deadline |
| `restrict-image-registries` | Third-party vendor image not yet mirrored | Trivy scan of external image, replication to Harbor in progress |
| `require-resource-limits` | Performance testing requiring burst capacity | Time-boxed to test window, auto-cleanup after test completes |
