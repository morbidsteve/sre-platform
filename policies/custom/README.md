# Custom SRE Policies

Platform-specific Kyverno policies that go beyond Pod Security Standards. These enforce SRE operational requirements.

## Policies

- `require-labels.yaml` — Require `app`, `team`, `environment`, `classification` labels
- `require-resource-limits.yaml` — All containers must specify CPU and memory limits
- `restrict-image-registries.yaml` — Only allow images from `harbor.sre.internal`
- `verify-image-signatures.yaml` — Cosign signature verification on all images
- `disallow-default-namespace.yaml` — Block deployments to the `default` namespace
- `disallow-latest-tag.yaml` — Block `:latest` or untagged images
- `require-network-policies.yaml` — Every namespace must have a default-deny NetworkPolicy
- `require-probes.yaml` — Require liveness and readiness probes on all containers
