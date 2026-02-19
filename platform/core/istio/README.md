# Istio Service Mesh

Istio provides zero-trust networking for all workloads in the SRE platform. It is the first component in the dependency chain — all other platform services depend on Istio being operational.

## What It Does

- **mTLS STRICT** — All pod-to-pod communication is encrypted and authenticated via mutual TLS
- **Ingress Gateway** — Single entry point for all north-south traffic with TLS termination
- **Authorization Policies** — Fine-grained service-to-service access control
- **Observability** — Automatic metrics, traces, and access logs for all mesh traffic
- **Outbound Policy** — REGISTRY_ONLY mode blocks traffic to unknown services

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease-base.yaml` | Istio CRDs and cluster-wide resources |
| `helmrelease-istiod.yaml` | Istiod control plane (Pilot, Citadel) |
| `helmrelease-gateway.yaml` | Ingress gateway (LoadBalancer service) |
| `peer-authentication.yaml` | Cluster-wide STRICT mTLS |
| `gateway.yaml` | Gateway resource for `*.apps.sre.example.com` |
| `authorization-policy-default.yaml` | Default deny + explicit allows |
| `network-policies/` | Kubernetes NetworkPolicies for defense in depth |

## Helm Chart Versions

All Istio charts are pinned to version `1.21.1`.

## Configuration

### mTLS

mTLS is enforced cluster-wide via the PeerAuthentication resource in `istio-system`. Individual namespaces cannot downgrade to PERMISSIVE mode.

### Gateway

The main gateway accepts HTTPS on port 443 and redirects HTTP to HTTPS. TLS is terminated at the gateway using a certificate stored in the `sre-wildcard-tls` secret (managed by cert-manager).

### Outbound Traffic

`outboundTrafficPolicy` is set to `REGISTRY_ONLY`, meaning pods can only communicate with services that have a ServiceEntry or are part of the mesh. This prevents data exfiltration.

### Access Logging

All mesh traffic generates JSON-formatted access logs sent to stdout, where Alloy collects them for Loki.

## NIST Controls

| Control | Implementation |
|---------|---------------|
| SC-8 | mTLS STRICT encrypts all in-cluster traffic |
| SC-13 | FIPS-compliant TLS via Istio's crypto implementation |
| AC-4 | AuthorizationPolicy restricts service communication |
| SC-7 | Single ingress gateway, REGISTRY_ONLY outbound |
| AU-2 | JSON access logs for all mesh traffic |

## Troubleshooting

```bash
# Check mesh status
istioctl analyze -A

# Verify mTLS is STRICT
kubectl get peerauthentication -A

# Check proxy status
istioctl proxy-status

# Debug a specific pod's proxy
istioctl proxy-config all <pod-name> -n <namespace>
```
