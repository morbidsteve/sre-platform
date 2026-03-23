# Tenant Base Configuration

This directory contains the shared Kustomize base for all tenant namespaces on the SRE platform.

## Purpose

Every tenant namespace requires the same foundational resources: a namespace with Istio injection, RBAC bindings mapped to Keycloak groups, resource quotas, limit ranges, and a default-deny network policy set. Rather than duplicating these files across every tenant, they are defined once here and consumed as a Kustomize base.

## What's Included

| Resource | File | Description |
|----------|------|-------------|
| Namespace | `namespace.yaml` | Namespace with Istio injection, PSS labels, SRE labels |
| ResourceQuota | `resource-quota.yaml` | CPU/memory/pod/service/PVC limits |
| LimitRange | `limit-range.yaml` | Default and max/min container resource constraints |
| RBAC | `rbac.yaml` | Developer (edit) and viewer (view) RoleBindings mapped to Keycloak groups |
| NetworkPolicy | `network-policies/default-deny.yaml` | Default deny-all ingress and egress |
| NetworkPolicy | `network-policies/allow-base.yaml` | DNS, monitoring, Istio gateway, same-namespace, Istio control plane, HTTPS egress |

## How Tenants Use This Base

Each tenant directory contains a thin `kustomization.yaml` overlay that references this base and uses JSON patches to replace the placeholder `TENANT_NAME` with the actual team name across all resources. The patches update:

- `metadata.name` on the Namespace, ResourceQuota, LimitRange, and RoleBindings
- `metadata.namespace` on all namespaced resources
- `metadata.labels.sre.io/team` on the Namespace
- `subjects[].name` on RoleBindings (Keycloak group names)

Example tenant overlay (`apps/tenants/team-example/kustomization.yaml`):

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../_base
  - apps/

patches:
  - target:
      kind: Namespace
      name: TENANT_NAME
    patch: |
      - op: replace
        path: /metadata/name
        value: team-example
      - op: replace
        path: /metadata/labels/sre.io~1team
        value: team-example
  - target:
      kind: ResourceQuota
      name: tenant-quota
    patch: |
      - op: replace
        path: /metadata/name
        value: team-example-quota
      - op: replace
        path: /metadata/namespace
        value: team-example
  # ... (similar patches for LimitRange, RoleBindings, NetworkPolicies)
```

## Adding a New Tenant

1. Create `apps/tenants/team-<name>/`
2. Copy `kustomization.yaml` from an existing tenant (e.g., team-alpha)
3. Find-and-replace the old team name with `team-<name>` in all patch values
4. Create `apps/tenants/team-<name>/apps/kustomization.yaml` with an empty resources list
5. Add the tenant to `apps/tenants/kustomization.yaml`
6. Validate with `kubectl kustomize apps/tenants/team-<name>/`

## Default Resource Quotas

| Resource | Limit |
|----------|-------|
| CPU requests | 4 cores |
| Memory requests | 8Gi |
| CPU limits | 8 cores |
| Memory limits | 16Gi |
| Pods | 20 |
| Services | 10 |
| PersistentVolumeClaims | 10 |

To override these defaults for a specific tenant, add a strategic merge patch in the tenant overlay.

## Default Container Limits

| Setting | CPU | Memory |
|---------|-----|--------|
| Default request | 100m | 128Mi |
| Default limit | 500m | 512Mi |
| Maximum allowed | 2 cores | 4Gi |
| Minimum allowed | 50m | 64Mi |

## Network Policy Baseline

All tenants start with default-deny and these explicit allows:

- **DNS** -- Egress to kube-system on port 53 (UDP/TCP)
- **Monitoring** -- Ingress from the monitoring namespace for Prometheus scraping
- **Istio Gateway** -- Ingress from istio-system gateway pods
- **Same Namespace** -- Ingress and egress between pods within the tenant namespace
- **Istio Control Plane** -- Egress to istiod on ports 15012 and 15014
- **HTTPS Egress** -- Egress to any destination on port 443
