# Kyverno Policies

Kubernetes admission policies enforced by Kyverno. Organized by security level.

## Structure

```
policies/
├── baseline/     # Pod Security Standards Baseline — applied cluster-wide
├── restricted/   # Pod Security Standards Restricted — applied to tenant namespaces
├── custom/       # SRE-specific policies (labels, registries, signatures)
└── tests/        # Test cases for every policy (mandatory)
```

## Policy Categories

### Baseline (cluster-wide)
Prevents known privilege escalations. Applied to all namespaces.
- Disallow privileged containers
- Disallow host namespaces (PID, IPC, network)
- Restrict host ports
- Restrict unsafe sysctls

### Restricted (tenant namespaces)
Enforces hardened security posture for application workloads.
- Require `runAsNonRoot`
- Require drop ALL capabilities
- Restrict volume types
- Disallow privilege escalation

### Custom (SRE-specific)
Platform-specific policies beyond Pod Security Standards.
- Require standard labels (app, team, environment)
- Require resource limits on all containers
- Restrict image registries to `harbor.sre.internal`
- Verify Cosign image signatures
- Disallow `:latest` image tags
- Require NetworkPolicy in every namespace

## Testing

Every policy MUST have tests. No exceptions.

```bash
# Run all policy tests
task validate

# Test a single policy
kyverno test policies/tests/<policy-name>/
```

See [Kyverno patterns](../docs/agent-docs/kyverno-patterns.md) for the full policy template.
