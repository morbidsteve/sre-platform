# Baseline Policies

Pod Security Standards Baseline policies applied cluster-wide. These prevent known privilege escalation vectors and are the minimum security requirement for all workloads.

## Policies

- `disallow-privileged.yaml` — Block privileged containers
- `disallow-host-namespaces.yaml` — Block hostPID, hostIPC, hostNetwork
- `disallow-host-ports.yaml` — Block hostPort usage
- `restrict-sysctls.yaml` — Allow only safe sysctls

## Scope

Applied as `ClusterPolicy` resources — enforced in all namespaces except explicitly excluded platform namespaces (kube-system, istio-system, flux-system).
