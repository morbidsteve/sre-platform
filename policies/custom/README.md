# Custom SRE Policies

Platform-specific Kyverno policies that go beyond Pod Security Standards. These enforce SRE operational requirements.

## Policies

| Policy | Severity | NIST Controls | Description |
|--------|----------|---------------|-------------|
| `require-labels.yaml` | medium | CM-8 | Require `app.kubernetes.io/name`, `app.kubernetes.io/part-of`, `sre.io/team` labels |
| `require-resource-limits.yaml` | medium | SC-6, CM-6 | All containers must specify CPU and memory requests and limits |
| `require-probes.yaml` | medium | SI-4, SC-5 | Require liveness and readiness probes on all containers |
| `require-security-context.yaml` | high | AC-6, CM-7 | Require runAsNonRoot, drop ALL capabilities, no privilege escalation |
| `require-security-categorization.yaml` | high | RA-2, SC-2 | Require FIPS 199 security categorization label on tenant namespaces |
| `require-istio-sidecar.yaml` | high | SC-8, AC-4 | Require Istio sidecar injection on tenant namespaces |
| `require-network-policies.yaml` | high | SC-7, AC-4 | Every namespace must have a default-deny NetworkPolicy |
| `restrict-image-registries.yaml` | critical | CM-11, SI-7 | Only allow images from approved registries |
| `verify-image-signatures.yaml` | critical | SA-10, SI-7 | Cosign signature verification on all images (Enforce) |
| `disallow-latest-tag.yaml` | medium | CM-2 | Block `:latest` or untagged images |
