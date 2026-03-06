# Platform Namespace AuthorizationPolicies (Reference Only)

These AuthorizationPolicies are NOT currently active. They serve as
documentation and templates for the zero-trust posture that would be
enforced if Istio sidecar injection were enabled for platform namespaces.

## Why These Are Inactive

Platform namespaces (monitoring, logging, tempo, openbao, external-secrets,
harbor, keycloak, neuvector) have `istio-injection: disabled` because:

1. Some platform services (NeuVector, Velero) require privileged access
   that conflicts with Istio sidecar injection
2. Platform services must remain operational even if the mesh is degraded
3. Istio sidecars add latency and resource overhead to monitoring and
   logging pipelines that process high volumes of data

## Current Isolation

Network-level isolation for platform namespaces is enforced via Kubernetes
NetworkPolicies, which operate at L3/L4 without requiring sidecars.

## Activating These Policies

To activate these policies for a specific platform namespace:

1. Set `istio-injection: enabled` on the namespace
2. Restart all pods to inject sidecars
3. Move the relevant policies from this directory to the active
   kustomization
4. Test thoroughly -- platform service disruption affects the entire cluster
