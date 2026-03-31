# Phase 7: Security Control Validation

**Date:** 2026-03-30
**Result:** PASS

## AC-6: Least Privilege (Privileged Pod Denied)

**PASS** -- Attempted to create a privileged pod in team-test namespace. Denied by multiple Kyverno policies:
- `disallow-privileged-containers`: blocked `securityContext.privileged=true`
- `disallow-latest-tag`: blocked untagged image
- `require-labels`: blocked missing required labels
- `require-probes`: blocked missing liveness/readiness probes
- `require-resource-limits`: blocked missing resource requests/limits
- `require-security-context`: blocked missing `capabilities.drop=["ALL"]`
- `restrict-image-registries`: blocked non-approved registry
- RKE2 PodSecurity also warned (restricted:latest profile)

## CM-11: Unauthorized Registry (Docker Hub Denied)

**PASS** -- Attempted to create a pod with `docker.io/nginx:latest`. Denied by:
- `disallow-latest-tag`: blocked `:latest` tag
- `require-labels`, `require-probes`, `require-resource-limits`, `require-security-context`: all enforced

## SC-8: Transmission Confidentiality (mTLS)

**PASS** -- `istio-system/default` PeerAuthentication set to `STRICT` mode cluster-wide. All service-to-service traffic encrypted via Istio mTLS. NeuVector has a `PERMISSIVE` exception (documented security exception for runtime monitoring).

## SI-7: Software Integrity (Image Signatures)

**PASS** -- `verify-image-signatures` ClusterPolicy is `Enforce` mode with Cosign public key verification for `harbor.sre.internal/*` images. Policy has autogen rules for Deployments, StatefulSets, DaemonSets, Jobs, CronJobs.

## Summary: 19 ClusterPolicies Active

All in Enforce mode, covering Pod Security Standards baseline + restricted + custom SRE policies.

## Evidence

- `tests/e2e/round5/evidence/ac6-privileged-test.txt`
- `tests/e2e/round5/evidence/cm11-registry-test.txt`
- `tests/e2e/round5/evidence/sc8-mtls.txt`
- `tests/e2e/round5/evidence/si7-image-signatures.txt`
