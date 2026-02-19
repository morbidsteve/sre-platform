# Istio Service Mesh

Istio provides zero-trust networking for all workloads in the SRE platform.

## What It Does

- **mTLS STRICT** — All pod-to-pod communication is encrypted and authenticated
- **Ingress Gateway** — Single entry point for all north-south traffic with TLS termination
- **Authorization Policies** — Fine-grained service-to-service access control
- **Observability** — Automatic metrics, traces, and access logs for all mesh traffic

## NIST Controls

- SC-8 (Transmission Confidentiality) — mTLS encrypts all in-cluster traffic
- AC-4 (Information Flow Enforcement) — AuthorizationPolicy restricts service communication
- AU-2 (Audit Events) — Istio access logs capture all service-to-service calls

## Configuration

Istio is the first component in the dependency chain — nothing depends on it being absent.

Key settings:
- PeerAuthentication: STRICT (cluster-wide)
- Gateway: Single ingress gateway in `istio-system` namespace
- Sidecar injection: Enabled via namespace label `istio-injection: enabled`
