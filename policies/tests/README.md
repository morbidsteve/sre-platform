# Kyverno Policy Tests

Test suites for every Kyverno policy. Every policy in `baseline/`, `restricted/`, and `custom/` must have a corresponding test directory here.

## Test Structure

```
tests/<policy-name>/
├── policy.yaml          # Copy of the policy being tested
├── resource-pass.yaml   # Resource that SHOULD be allowed
├── resource-fail.yaml   # Resource that SHOULD be denied
└── kyverno-test.yaml    # Test definition linking policy, resources, and expected results
```

## Running Tests

```bash
# Test all policies
kyverno test policies/tests/

# Test a single policy
kyverno test policies/tests/<policy-name>/

# Via task runner
task validate
```
