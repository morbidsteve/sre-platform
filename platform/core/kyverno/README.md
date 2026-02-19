# Kyverno Policy Engine

Kubernetes-native policy enforcement using YAML-based policies. Kyverno validates, mutates, and generates resources based on ClusterPolicy definitions.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | Kyverno Helm chart (v3.1.4) |
| `namespace.yaml` | Kyverno namespace (no Istio injection) |
| `network-policies/` | Default deny + explicit allows |

## Policies

Policies are defined in the `policies/` directory at the repo root:

| Policy | Category | Severity | NIST |
|--------|----------|----------|------|
| `require-labels` | Best Practices | medium | CM-8 |
| `require-security-context` | Pod Security Restricted | high | AC-6, CM-7 |
| `restrict-image-registries` | Supply Chain | critical | CM-11, SI-7 |
| `disallow-latest-tag` | Best Practices | medium | CM-2 |
| `require-network-policies` | Best Practices | high | SC-7, AC-4 |
| `verify-image-signatures` | Supply Chain | critical | SA-10, SI-7 |
| `require-istio-sidecar` | Best Practices | high | SC-8, AC-4 |

All policies use `validationFailureAction: Audit` in production. Override to `Enforce` per-environment via Flux value overlays.

## Testing

Every policy has a test suite in `policies/tests/<policy-name>/`:

```bash
# Test all policies
kyverno test policies/tests/

# Test a single policy
kyverno test policies/tests/require-labels/
```

## Dependencies

- Depends on: Istio, cert-manager

## NIST Controls

| Control | Implementation |
|---------|---------------|
| AC-6 | Restricts container capabilities and privilege escalation |
| CM-7 | Blocks unnecessary host access and volumes |
| CM-8 | Enforces resource labeling for inventory |
| CM-11 | Restricts image sources to approved registry |
| SI-7 | Verifies image signatures before admission |
| SC-7 | Requires NetworkPolicies in all namespaces |

## Troubleshooting

```bash
# Check policy status
kubectl get clusterpolicies

# View policy reports
kubectl get policyreport -A
kubectl get clusterpolicyreport

# Check Kyverno logs
kubectl logs -n kyverno -l app.kubernetes.io/component=admission-controller
```

See [Kyverno patterns](../../../docs/agent-docs/kyverno-patterns.md) for policy conventions.
