# Istio AuthorizationPolicies for Zero-Trust Service Communication

## Overview

This directory contains Istio AuthorizationPolicies that enforce zero-trust
service-to-service communication within the SRE platform. These policies
implement NIST 800-53 controls AC-3 (Access Enforcement), AC-4 (Information
Flow Enforcement), and SC-7 (Boundary Protection).

## Directory Structure

```
authorization-policies/
├── tenants/              # ACTIVE policies for Istio-injected tenant namespaces
│   ├── default-deny.yaml
│   ├── allow-gateway-ingress.yaml
│   ├── allow-prometheus-scrape.yaml
│   ├── allow-same-namespace.yaml
│   └── allow-istio-control-plane.yaml
├── platform/             # REFERENCE policies for platform namespaces (NOT active)
│   ├── README.md
│   ├── default-deny.yaml
│   ├── allow-monitoring-scrape.yaml
│   ├── allow-grafana-ingress.yaml
│   ├── allow-prometheus-ingress.yaml
│   ├── allow-alertmanager-ingress.yaml
│   ├── allow-harbor-ingress.yaml
│   ├── allow-keycloak-ingress.yaml
│   ├── allow-neuvector-ingress.yaml
│   ├── allow-loki-ingestion.yaml
│   ├── allow-tempo-traces.yaml
│   ├── allow-openbao-access.yaml
│   ├── allow-harbor-internal.yaml
│   └── allow-keycloak-internal.yaml
├── kustomization.yaml
└── README.md              # This file
```

## How It Works

### Tenant Namespaces (Active)

Tenant namespaces (team-alpha, team-beta, and any future tenants) have
`istio-injection: enabled`, which means Istio sidecars are injected into every
pod. AuthorizationPolicies in these namespaces are actively enforced by the
sidecar proxies.

The tenant policies follow a default-deny model:
1. A `default-deny` policy blocks all traffic not explicitly allowed
2. Allow policies permit specific traffic flows:
   - Istio gateway to application pods (for external ingress)
   - Prometheus scraping from the monitoring namespace
   - Pod-to-pod communication within the same namespace
   - Sidecar-to-istiod control plane communication

### Platform Namespaces (Reference Only)

Platform namespaces (monitoring, logging, tempo, openbao, external-secrets,
harbor, keycloak, neuvector) have `istio-injection: disabled`. Without sidecars,
AuthorizationPolicies are no-ops in these namespaces.

The `platform/` subdirectory contains policies that document the intended
zero-trust posture and can be activated if Istio injection is enabled for
platform namespaces in the future. Network-level isolation for platform
namespaces is currently enforced via Kubernetes NetworkPolicies instead.

## Adding a New Tenant

When onboarding a new tenant namespace with `istio-injection: enabled`, the
tenant AuthorizationPolicies are written as templates that apply to any
namespace with the `sre.io/team` label. No additional AuthorizationPolicies
need to be created unless the tenant has custom service-to-service requirements.

For custom cross-namespace communication (e.g., team-alpha calling team-beta),
create a specific ALLOW policy in the target namespace permitting traffic from
the source namespace.

## Relationship to NetworkPolicies

AuthorizationPolicies and NetworkPolicies provide defense in depth:
- **NetworkPolicies** operate at L3/L4 (IP and port filtering)
- **AuthorizationPolicies** operate at L7 (identity-based, using mTLS certificates)

Both are applied. A request must pass both the NetworkPolicy and the
AuthorizationPolicy to succeed.

## NIST 800-53 Controls

| Control | Description | Implementation |
|---------|-------------|----------------|
| AC-3 | Access Enforcement | Default-deny policies require explicit ALLOW for each flow |
| AC-4 | Information Flow Enforcement | Policies restrict which services can communicate |
| AC-6 | Least Privilege | Only minimum required communication paths are allowed |
| SC-7 | Boundary Protection | Gateway ingress policies enforce single entry point |
| SC-8 | Transmission Confidentiality | mTLS via PeerAuthentication (separate resource) |
