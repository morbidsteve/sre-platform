# Restricted Policies

Pod Security Standards Restricted policies applied to tenant namespaces. These enforce a hardened security posture for all application workloads.

## Policies

- `require-run-as-nonroot.yaml` — Containers must run as non-root
- `require-drop-all-capabilities.yaml` — Containers must drop ALL Linux capabilities
- `restrict-volume-types.yaml` — Only configMap, secret, emptyDir, PVC allowed
- `disallow-privilege-escalation.yaml` — `allowPrivilegeEscalation` must be false

## Scope

Applied as `ClusterPolicy` with `match` rules targeting tenant namespaces. Platform namespaces with documented security exceptions are excluded.
