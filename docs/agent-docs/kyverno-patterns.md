# Kyverno Policy Patterns for SRE

Read this before creating or modifying anything in `policies/`.

## Directory Structure

```
policies/
├── baseline/              # Pod Security Standards baseline (applied cluster-wide)
│   ├── disallow-privileged.yaml
│   ├── disallow-host-namespaces.yaml
│   ├── disallow-host-ports.yaml
│   └── restrict-sysctls.yaml
├── restricted/            # Pod Security Standards restricted (applied to tenant namespaces)
│   ├── require-run-as-nonroot.yaml
│   ├── require-drop-all-capabilities.yaml
│   ├── restrict-volume-types.yaml
│   └── disallow-privilege-escalation.yaml
├── custom/                # SRE-specific policies
│   ├── require-labels.yaml
│   ├── require-resource-limits.yaml
│   ├── restrict-image-registries.yaml
│   ├── verify-image-signatures.yaml
│   ├── disallow-default-namespace.yaml
│   ├── disallow-latest-tag.yaml
│   ├── require-network-policies.yaml
│   └── require-probes.yaml
└── tests/                 # Test cases for every policy
    ├── require-labels/
    │   ├── policy.yaml
    │   ├── resource-pass.yaml
    │   ├── resource-fail.yaml
    │   └── kyverno-test.yaml
    └── ...
```

## Policy Template

Every policy follows this structure:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: <descriptive-kebab-case-name>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-category: <baseline|restricted|custom>
  annotations:
    policies.kyverno.io/title: <Human Readable Title>
    policies.kyverno.io/description: >-
      Brief description of what this policy enforces and why.
    policies.kyverno.io/category: <Pod Security Standards Baseline|Best Practices|Supply Chain>
    policies.kyverno.io/severity: <critical|high|medium|low>
    sre.io/nist-controls: "AC-6, CM-7"  # Map to NIST 800-53 control IDs
spec:
  validationFailureAction: Enforce    # Use Audit in dev environments
  background: true
  rules:
    - name: <rule-name>
      match:
        any:
          - resources:
              kinds:
                - Pod
      validate:
        message: "Clear message explaining why this was denied and how to fix it."
        pattern:
          spec:
            # ... validation pattern
```

## Key Design Rules

- **ClusterPolicy** for cluster-wide rules, **Policy** for namespace-scoped
- `validationFailureAction: Enforce` in production, `Audit` in dev — use Flux value overlays for this
- Always include the `sre.io/nist-controls` annotation linking to NIST 800-53 controls
- Always include a clear, actionable `message` — developers need to know HOW to fix it, not just that it failed
- Set `background: true` so policies also report on existing non-compliant resources
- Use `exclude` blocks to exempt platform namespaces (kube-system, istio-system, flux-system) where needed

## Image Verification with Cosign

This is a critical supply chain security policy:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
  annotations:
    sre.io/nist-controls: "SA-10, SI-7"
spec:
  validationFailureAction: Enforce
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "harbor.sre.internal/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      REPLACE_ME_WITH_COSIGN_PUBLIC_KEY
                      -----END PUBLIC KEY-----
```

## Mutation Policies

Use mutation for injecting defaults, not for security enforcement:

```yaml
spec:
  rules:
    - name: add-default-labels
      match:
        any:
          - resources:
              kinds:
                - Pod
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              sre.io/managed: "true"
```

## Writing Tests

EVERY policy MUST have tests. No exceptions.

### Test directory structure

```
policies/tests/<policy-name>/
├── policy.yaml          # Copy of the policy (or symlink)
├── resource-pass.yaml   # Resource that SHOULD be allowed
├── resource-fail.yaml   # Resource that SHOULD be denied
└── kyverno-test.yaml    # Test definition
```

### kyverno-test.yaml template

```yaml
apiVersion: cli.kyverno.io/v1alpha1
kind: Test
metadata:
  name: <policy-name>-test
policies:
  - policy.yaml
resources:
  - resource-pass.yaml
  - resource-fail.yaml
results:
  - policy: <policy-name>
    rule: <rule-name>
    resource: <passing-resource-name>
    kind: Pod
    result: pass
  - policy: <policy-name>
    rule: <rule-name>
    resource: <failing-resource-name>
    kind: Pod
    result: fail
```

### Running tests

```bash
# Test a single policy
kyverno test policies/tests/<policy-name>/

# Test all policies
kyverno test policies/tests/

# Also run via task
task validate
```

## Kyverno Reporter

Kyverno Reporter sends policy violation metrics to Prometheus. It is deployed alongside Kyverno and integrated with Grafana dashboards.

Policy reports are queryable:

```bash
kubectl get policyreport -A          # Namespace-scoped reports
kubectl get clusterpolicyreport      # Cluster-scoped reports
```

## Common Mistakes

- Forgetting to exclude platform namespaces — kube-system pods will fail restricted policies
- Writing validation messages that say WHAT failed but not HOW to fix it
- Not setting `background: true` — misses reporting on existing non-compliant resources
- Writing a policy without tests — this is not optional
- Using `Enforce` in dev — use `Audit` and check reports instead
- Missing the NIST control annotation — needed for compliance mapping
