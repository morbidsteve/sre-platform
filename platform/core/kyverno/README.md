# Kyverno Policy Engine

Kubernetes-native policy enforcement using YAML-based policies.

## What It Does

- Validates resources against Pod Security Standards (Baseline + Restricted)
- Enforces image registry restrictions (only `harbor.sre.internal`)
- Verifies container image signatures via Cosign
- Mutates resources to inject default labels and security contexts
- Reports policy violations via PolicyReport CRDs

## NIST Controls

- AC-6 (Least Privilege) — Restricts container capabilities and privilege
- CM-7 (Least Functionality) — Blocks unnecessary host access and volumes
- SI-7 (Software Integrity) — Verifies image signatures before admission
- CM-11 (User-Installed Software) — Restricts image sources to approved registry

## Policies

Policies are defined in the `policies/` directory at the repo root:
- `policies/baseline/` — Pod Security Standards Baseline (cluster-wide)
- `policies/restricted/` — Pod Security Standards Restricted (tenant namespaces)
- `policies/custom/` — SRE-specific policies (labels, registries, signatures)

See [Kyverno patterns](../../../docs/agent-docs/kyverno-patterns.md) for policy conventions.

## Dependencies

- Depends on: Istio, cert-manager
