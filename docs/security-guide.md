# Security Architecture Guide

This document describes the security architecture of the Secure Runtime Environment (SRE) platform. It covers the defense-in-depth model, zero-trust network architecture, workload hardening, supply chain security, identity management, secrets handling, cryptographic controls, audit and monitoring, incident response procedures, and threat modeling.

All security controls are mapped to NIST 800-53 Rev 5 control identifiers. For the complete control-to-component crosswalk, see `docs/agent-docs/compliance-mapping.md`.

---

## Table of Contents

1. [Security Architecture Overview](#1-security-architecture-overview)
2. [Network Security](#2-network-security)
3. [Workload Security](#3-workload-security)
4. [Supply Chain Security](#4-supply-chain-security)
5. [Identity and Access Management](#5-identity-and-access-management)
6. [Secrets Management](#6-secrets-management)
7. [Cryptography](#7-cryptography)
8. [Audit and Monitoring](#8-audit-and-monitoring)
9. [Incident Response](#9-incident-response)
10. [Threat Model](#10-threat-model)
11. [Security Exceptions](#11-security-exceptions)
12. [References](#12-references)

---

## 1. Security Architecture Overview

### 1.1 Defense-in-Depth Model

SRE implements defense-in-depth through four reinforcing security layers. A compromise at one layer is contained by the controls at adjacent layers. No single component is a single point of failure for platform security.

```
+-----------------------------------------------------------------------+
|  Layer 1: Infrastructure Foundation                                    |
|  Rocky Linux 9 (DISA STIG) + FIPS 140-2 + SELinux Enforcing          |
|  RKE2 (CIS Benchmark + DISA STIG) + etcd encryption at rest          |
+-----------------------------------------------------------------------+
|  Layer 2: Network Security                                            |
|  Istio mTLS STRICT + NetworkPolicies (default deny)                   |
|  AuthorizationPolicies + NeuVector network segmentation               |
+-----------------------------------------------------------------------+
|  Layer 3: Workload Security                                           |
|  Kyverno admission control + Pod Security Contexts                    |
|  NeuVector runtime protection + process/file monitoring               |
+-----------------------------------------------------------------------+
|  Layer 4: Supply Chain Security                                       |
|  Harbor + Trivy scanning + Cosign signing + SBOM generation           |
|  Kyverno image verification + registry restriction                    |
+-----------------------------------------------------------------------+
|  Cross-Cutting: Identity, Secrets, Audit, Monitoring                  |
|  Keycloak SSO/MFA + OpenBao + Loki/Prometheus/Grafana                 |
+-----------------------------------------------------------------------+
```

Each layer operates independently so that:

- A container escape is limited by SELinux, seccomp, and dropped capabilities (Layer 3) plus network segmentation (Layer 2).
- A compromised image is blocked at admission by Kyverno signature verification (Layer 4) and detected at runtime by NeuVector (Layer 3).
- Lateral movement is restricted by Istio mTLS identity verification and AuthorizationPolicies (Layer 2) plus NetworkPolicies at the CNI level (Layer 2).
- Credential theft is mitigated by short-lived dynamic secrets (OpenBao), automatic rotation, and ServiceAccount isolation (Cross-Cutting).

### 1.2 Zero-Trust Architecture

SRE follows zero-trust principles as defined in NIST SP 800-207:

- **Never trust, always verify.** Every service-to-service call is authenticated via Istio mTLS with SPIFFE identity. There is no implicit trust based on network location (NIST AC-14, SC-8).
- **Least-privilege access.** RBAC is scoped to the narrowest required permissions at every layer: Kubernetes RBAC, Istio AuthorizationPolicy, Kyverno namespace isolation, and OpenBao secret policies (NIST AC-6).
- **Assume breach.** NeuVector monitors all runtime behavior. Kyverno PolicyReports continuously audit cluster state. All actions are logged to Loki for forensic analysis (NIST SI-4, AU-2).
- **Explicit verification at every boundary.** The Istio ingress gateway terminates TLS and validates JWT tokens. Internal services authenticate via mTLS. Admission control validates every resource mutation. Image signatures are verified before pod creation.

### 1.3 Compliance Alignment

The security architecture is designed to satisfy:

| Framework | Coverage |
|---|---|
| NIST 800-53 Rev 5 | AC, AU, CA, CM, IA, IR, MP, RA, SA, SC, SI control families |
| CMMC 2.0 Level 2 | All 110 practices (mapped from NIST 800-171 r2) |
| FedRAMP Moderate | Inherited from NIST 800-53 coverage |
| DISA STIGs | RKE2 Kubernetes STIG, RHEL 9 STIG (Rocky Linux 9), Istio STIG |
| CIS Benchmarks | Kubernetes CIS 1.23 (RKE2 default), Rocky Linux 9 CIS Level 2 |

---

## 2. Network Security

Network security is enforced at three independent layers: the CNI (Kubernetes NetworkPolicies), the service mesh (Istio mTLS and AuthorizationPolicies), and the runtime security engine (NeuVector network segmentation). These layers are complementary, not redundant -- each operates at a different abstraction level and catches different classes of attack.

### 2.1 Istio Mutual TLS -- STRICT Mode

**NIST Controls:** SC-8 (Transmission Confidentiality and Integrity), SC-13 (Cryptographic Protection), IA-3 (Device Identification and Authentication), AC-14 (Permitted Actions Without Identification)

All pod-to-pod communication within the cluster is encrypted and mutually authenticated using Istio's STRICT mTLS mode. This is enforced by a cluster-wide `PeerAuthentication` resource deployed to `istio-system`:

```yaml
# platform/core/istio/peer-authentication.yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT
```

Key properties of STRICT mTLS enforcement:

- **No plaintext service-to-service traffic.** Any pod without a valid Istio-issued mTLS certificate is rejected. There is no "permissive" fallback.
- **SPIFFE identity.** Each workload receives a SPIFFE identity (`spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>`) via the Istio sidecar. This identity is used for both authentication and authorization.
- **Automatic certificate rotation.** Istio's Citadel component issues short-lived certificates (24h default TTL) to all sidecars and rotates them automatically. No manual certificate management is required for in-mesh communication.
- **Outbound traffic policy.** Istiod is configured with `outboundTrafficPolicy.mode: REGISTRY_ONLY`, meaning workloads can only communicate with services explicitly registered in the mesh. This prevents unexpected egress to unknown endpoints.

### 2.2 Kubernetes NetworkPolicies

**NIST Controls:** AC-4 (Information Flow Enforcement), SC-7 (Boundary Protection)

Every namespace in the platform starts with a default-deny NetworkPolicy that blocks all ingress and egress traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: <namespace>
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Explicit allow rules are then added for each required communication path. This is enforced for all platform namespaces (`istio-system`, `kyverno`, `monitoring`, `logging`, `neuvector`, `cert-manager`, `openbao`, `harbor`) and all tenant namespaces.

Standard allow patterns for tenant namespaces:

| Direction | Source/Destination | Purpose |
|---|---|---|
| Ingress | `istio-system` | Istio sidecar injection and gateway traffic |
| Ingress | `monitoring` | Prometheus metric scraping |
| Egress | `kube-system` (port 53) | DNS resolution |
| Egress | `istio-system` | Mesh control plane communication |
| Egress | Service-specific targets | Application dependencies (explicitly listed) |

NetworkPolicies operate at the CNI layer (Layer 3/4) and are enforced independently of Istio. Even if the Istio sidecar is bypassed or misconfigured, the CNI-level deny rules remain active.

### 2.3 Istio AuthorizationPolicies

**NIST Controls:** AC-3 (Access Enforcement), AC-4 (Information Flow Enforcement), AC-6 (Least Privilege)

Istio AuthorizationPolicies provide Layer 7 access control for service-to-service communication. They operate on top of mTLS -- once a connection is authenticated, the AuthorizationPolicy determines whether the specific request (method, path, headers) is permitted.

The default posture is deny-all. Each namespace receives a deny-all `AuthorizationPolicy`, and explicit `ALLOW` rules are added for each required communication path:

```yaml
# Deny all traffic by default
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: istio-system
spec:
  {}
```

```yaml
# Explicitly allow specific traffic
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-ingress-gateway
  namespace: istio-system
spec:
  selector:
    matchLabels:
      istio: gateway
  action: ALLOW
  rules:
    - from:
        - source:
            ipBlocks:
              - "0.0.0.0/0"
```

AuthorizationPolicies support matching on:

- **Source identity** (`source.principals`) -- verified via mTLS certificate (SPIFFE ID)
- **Source namespace** (`source.namespaces`)
- **HTTP method, path, and headers** (`to.operation`)
- **Request authentication claims** (JWT via `RequestAuthentication`)

This allows fine-grained rules such as "only the `frontend` service in the `team-alpha` namespace may call `GET /api/v1/users` on the `user-service`."

### 2.4 NeuVector Network Segmentation

**NIST Controls:** SC-7 (Boundary Protection), SI-4 (System Monitoring)

NeuVector provides an additional network security layer with Layer 7 deep packet inspection, DLP (Data Loss Prevention), and WAF (Web Application Firewall) capabilities.

Key features:

- **Behavioral learning.** NeuVector observes normal network traffic patterns during a learning period and automatically generates baseline network rules. These baselines can be promoted to enforcement rules.
- **Network DLP.** Detects sensitive data patterns (PII, credit card numbers, SSNs) in network traffic and can alert or block exfiltration attempts.
- **Network visualization.** Provides a real-time map of all service-to-service communication, making it possible to identify unexpected traffic flows.
- **Protocol-aware inspection.** Understands HTTP, gRPC, SQL, and other protocols for deep inspection beyond IP/port matching.

NeuVector network rules complement (not replace) Kubernetes NetworkPolicies and Istio AuthorizationPolicies. NetworkPolicies enforce at Layer 3/4, Istio at Layer 7 with identity, and NeuVector at Layer 7 with content inspection.

### 2.5 Boundary Protection

**NIST Controls:** SC-7 (Boundary Protection)

All external (north-south) traffic enters the cluster through a single controlled ingress point: the Istio ingress gateway.

```yaml
# platform/core/istio/gateway.yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: main
  namespace: istio-system
spec:
  selector:
    istio: gateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: sre-wildcard-tls
      hosts:
        - "*.apps.sre.example.com"
    - port:
        number: 80
        name: http
        protocol: HTTP
      tls:
        httpsRedirect: true
      hosts:
        - "*.apps.sre.example.com"
```

Properties of the ingress boundary:

- **HTTPS only.** All HTTP traffic is redirected to HTTPS. No plaintext ingress is permitted.
- **TLS termination.** TLS is terminated at the gateway using certificates managed by cert-manager. Internal traffic continues over mTLS.
- **Single entry point.** There is no other path into the cluster. NodePort services and LoadBalancer services are restricted by Kyverno policies.
- **Egress control.** Istio's `REGISTRY_ONLY` outbound traffic policy prevents pods from making requests to services not registered in the mesh. Explicit `ServiceEntry` resources are required for any external dependency.

---

## 3. Workload Security

### 3.1 Pod Security Contexts

**NIST Controls:** AC-6 (Least Privilege), CM-7 (Least Functionality), AC-6(10) (Prohibit Non-Privileged Users from Executing Privileged Functions)

Every workload deployed to SRE must run with a restricted security context. The following settings are mandatory and enforced by Kyverno admission control:

```yaml
spec:
  template:
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop:
                - ALL
```

| Setting | Purpose | NIST Control |
|---|---|---|
| `runAsNonRoot: true` | Prevents containers from running as UID 0 | AC-6 |
| `allowPrivilegeEscalation: false` | Blocks `setuid`/`setgid` binaries and `no_new_privs` | AC-6(10) |
| `readOnlyRootFilesystem: true` | Prevents runtime modification of the container filesystem | CM-7 |
| `capabilities.drop: [ALL]` | Removes all Linux capabilities (NET_RAW, SYS_ADMIN, etc.) | AC-6 |
| `seccompProfile.type: RuntimeDefault` | Applies the container runtime's default seccomp profile, blocking dangerous syscalls | CM-7 |
| `automountServiceAccountToken: false` | Prevents automatic mounting of the ServiceAccount token, reducing credential exposure | AC-6 |

### 3.2 Kyverno Policy Enforcement

**NIST Controls:** AC-3 (Access Enforcement), CM-6 (Configuration Settings), CM-7 (Least Functionality), SI-7 (Software Integrity)

Kyverno operates as a Kubernetes admission controller, intercepting every API request to validate and optionally mutate resources before they are persisted to etcd. Kyverno is deployed with 3 admission controller replicas for high availability.

The platform enforces three tiers of policies:

**Baseline Policies** (cluster-wide, applied to all namespaces):

| Policy | What It Blocks | NIST Controls |
|---|---|---|
| `disallow-privileged-containers` | `securityContext.privileged: true` | AC-6(10), CM-7 |
| `disallow-host-namespaces` | `hostNetwork`, `hostPID`, `hostIPC` | AC-6, CM-7 |
| `disallow-host-ports` | `hostPort` bindings | SC-7 |
| `restrict-sysctls` | Unsafe sysctl settings | CM-7 |

**Restricted Policies** (applied to tenant namespaces):

| Policy | What It Enforces | NIST Controls |
|---|---|---|
| `require-run-as-nonroot` | `runAsNonRoot: true` on all pods | AC-6 |
| `require-drop-all-capabilities` | `capabilities.drop: [ALL]` on all containers | AC-6, CM-7 |
| `restrict-volume-types` | Only `configMap`, `emptyDir`, `secret`, `persistentVolumeClaim`, `projected` | CM-7 |
| `disallow-privilege-escalation` | `allowPrivilegeEscalation: false` | AC-6(10) |

**Custom SRE Policies** (platform-specific enforcement):

| Policy | What It Enforces | NIST Controls |
|---|---|---|
| `require-labels` | Standard labels (`app.kubernetes.io/name`, `sre.io/team`, etc.) | CM-8 |
| `require-resource-limits` | CPU and memory requests/limits on all containers | SC-5 |
| `restrict-image-registries` | Only `harbor.sre.internal/*` images permitted | CM-11, SI-7 |
| `verify-image-signatures` | Cosign signature verification on all images | SA-10, SI-7 |
| `disallow-default-namespace` | No workloads in the `default` namespace | CM-7 |
| `disallow-latest-tag` | No `:latest` image tags | CM-2 |
| `require-network-policies` | Every namespace must have a default-deny NetworkPolicy | AC-4, SC-7 |
| `require-probes` | Liveness and readiness probes required | SI-4 |

All policies run in `Audit` mode in development environments and `Enforce` mode in production. This is controlled via Flux value overlays. Policies in `background: true` mode continuously scan existing resources and generate `PolicyReport` CRDs, feeding compliance dashboards in Grafana.

Platform namespaces (`kube-system`, `istio-system`, `flux-system`, `kyverno`, `cert-manager`) are excluded from restricted and custom policies via `exclude` blocks to prevent self-denial scenarios.

### 3.3 NeuVector Runtime Protection

**NIST Controls:** SI-3 (Malicious Code Protection), SI-4 (System Monitoring), CM-7 (Least Functionality), IR-4 (Incident Handling)

NeuVector provides runtime security through three enforcement mechanisms:

**Process monitoring.** NeuVector maintains a process profile for every container. In Discover mode, it learns the expected process tree. When promoted to Monitor or Protect mode, any process not in the baseline triggers an alert (Monitor) or is terminated (Protect).

**File system monitoring.** NeuVector monitors file access patterns within containers. Unauthorized writes to sensitive paths (e.g., `/etc/passwd`, `/usr/bin/`, container entrypoint modifications) trigger alerts or blocking actions.

**CIS benchmark scanning.** NeuVector continuously evaluates running containers and the host node against CIS benchmarks, reporting deviations through its API and to the monitoring stack via Prometheus metrics.

NeuVector operates as a privileged DaemonSet (`neuvector-enforcer`) on every node. This is a documented security exception -- the enforcer requires privileged access to inspect container runtime state, network traffic, and host processes. See [Section 11: Security Exceptions](#11-security-exceptions).

The NeuVector admission control webhook operates in the admission chain alongside Kyverno:

```
API Server --> Kyverno (mutate/validate) --> NeuVector admission --> Pod created --> Istio sidecar injected
```

NeuVector admission control can reject pods based on:
- Image vulnerability severity thresholds (e.g., reject if CRITICAL CVEs present)
- Compliance check failures
- Process profile violations from previous runs

---

## 4. Supply Chain Security

### 4.1 Image Pipeline

**NIST Controls:** SA-10 (Developer Configuration Management), SI-7 (Software Integrity), RA-5 (Vulnerability Scanning), CM-11 (User-Installed Software)

The SRE image pipeline ensures that only trusted, scanned, signed, and catalogued images reach the cluster:

```
Developer Dockerfile
  |
  v
CI Pipeline (GitHub Actions / GitLab CI)
  |-- Build container image
  |-- Scan with Trivy (FAIL on CRITICAL/HIGH)
  |-- Generate SBOM with Syft (SPDX + CycloneDX)
  |-- Sign image with Cosign
  |-- Push to Harbor
  |-- Attach SBOM as OCI artifact
  v
Harbor (harbor.sre.internal)
  |-- Trivy scan on push (second scan gate)
  |-- Store Cosign signature
  |-- Store SBOM
  v
Deployment via Flux (GitOps image tag bump)
  |-- Kyverno: verify image is from harbor.sre.internal
  |-- Kyverno: verify Cosign signature
  |-- NeuVector: check vulnerability threshold
  v
Pod created with verified, scanned, signed image
```

### 4.2 Image Scanning with Harbor and Trivy

**NIST Controls:** RA-5 (Vulnerability Scanning), SI-2 (Flaw Remediation)

Harbor runs Trivy as its integrated vulnerability scanner. Every image pushed to Harbor is automatically scanned. The scanning pipeline enforces:

- **Severity-based gating.** Images with CRITICAL-severity CVEs are flagged and can be prevented from being pulled via Harbor's vulnerability policy.
- **Continuous rescanning.** Harbor periodically rescans stored images against updated CVE databases, catching newly disclosed vulnerabilities in previously-clean images.
- **Per-project policies.** Each Harbor project (mapped to a team) can have its own vulnerability threshold and retention rules.

### 4.3 Image Signing with Cosign

**NIST Controls:** SI-7 (Software Integrity), SA-10 (Developer Configuration Management)

All images are signed with Cosign during the CI pipeline using a private key stored in OpenBao. The corresponding public key is embedded in the Kyverno `verify-image-signatures` ClusterPolicy:

```yaml
# policies/custom/verify-image-signatures.yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
  annotations:
    sre.io/nist-controls: "SA-10, SI-7"
spec:
  validationFailureAction: Audit  # Enforce in production
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-cosign-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            - "harbor.sre.internal/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      REPLACE_ME_WITH_COSIGN_PUBLIC_KEY
                      -----END PUBLIC KEY-----
```

This policy verifies that:

- The image was signed by the expected private key (proving it came from the CI pipeline).
- The image digest has not been tampered with since signing.
- The signature is valid and not expired.

In production, `validationFailureAction` is set to `Enforce`, causing any unsigned or incorrectly signed image to be rejected at admission.

### 4.4 Registry Restriction

**NIST Controls:** CM-11 (User-Installed Software), SI-7 (Software Integrity)

The `restrict-image-registries` Kyverno ClusterPolicy ensures that only images from `harbor.sre.internal/*` are permitted in the cluster. This applies to both `containers` and `initContainers`:

```yaml
# policies/custom/restrict-image-registries.yaml
spec:
  rules:
    - name: validate-image-registry
      validate:
        message: >-
          All container images must be from the approved registry
          harbor.sre.internal/. Push your image to Harbor first.
        pattern:
          spec:
            containers:
              - image: "harbor.sre.internal/*"
```

This ensures:

- No images are pulled directly from Docker Hub, GitHub Container Registry, or other public registries.
- All images have passed through Harbor's Trivy scan gate.
- All images are subject to Harbor's project-level RBAC and retention policies.
- For government deployments, Iron Bank (registry1.dso.mil) images are replicated into Harbor first, then consumed from the internal registry.

### 4.5 Software Bill of Materials (SBOM)

**NIST Controls:** CM-8 (Information System Component Inventory), SA-11 (Developer Testing)

SBOMs are generated during the CI pipeline using Syft in two formats:

- **SPDX** -- for government and regulatory compliance
- **CycloneDX** -- for VEX (Vulnerability Exploitability eXchange) integration

SBOMs are attached to images as OCI artifacts in Harbor and signed with Cosign attestation. This enables:

- **CVE response queries.** When a new vulnerability is disclosed (e.g., log4j), operators can query Harbor to identify every image and deployment affected.
- **Dependency auditing.** Assessors can inspect the full dependency tree of any deployed application without requiring access to source code.
- **Continuous compliance.** Automated tools can verify that no prohibited libraries or licenses are present in deployed applications.

---

## 5. Identity and Access Management

### 5.1 Keycloak SSO with Multi-Factor Authentication

**NIST Controls:** IA-2 (Identification and Authentication), AC-2 (Account Management), AC-17 (Remote Access)

Keycloak is the centralized identity provider for all platform management interfaces. All UIs require authentication through Keycloak before access is granted:

| Service | Authentication Method |
|---|---|
| Grafana | OIDC via Keycloak |
| Harbor | OIDC via Keycloak |
| NeuVector Manager | OIDC via Keycloak |
| Kiali | OIDC via Keycloak |
| Backstage (optional) | OIDC via Keycloak |
| Kubernetes API | OIDC via Keycloak (or client certificate) |

Keycloak enforces:

- **Multi-factor authentication (MFA).** All accounts require a second factor (TOTP, WebAuthn, or hardware security key). This is mandatory, not optional.
- **Password policies.** Minimum length, complexity requirements, history, and expiration aligned with NIST SP 800-63B guidelines.
- **Session management.** Configurable session timeouts, idle timeouts, and concurrent session limits.
- **Federation.** SAML 2.0 and LDAP federation for integration with Active Directory, LDAP directories, and DoD identity providers.

### 5.2 Kubernetes RBAC

**NIST Controls:** AC-3 (Access Enforcement), AC-6 (Least Privilege), AC-6(1) (Authorize Access to Security Functions)

Kubernetes RBAC is configured with the principle of least privilege:

**Platform administrators** have access to platform namespaces via ClusterRoles mapped to the `platform-admins` Keycloak group. Even administrators do not have unrestricted `cluster-admin` access -- they receive only the permissions needed for platform operations.

**Tenant teams** receive namespace-scoped Roles bound to their Keycloak group. A team member in the `team-alpha` Keycloak group receives permissions only within the `team-alpha` namespace.

**Flux service account** is the only identity with write access to platform-managed namespaces. Direct `kubectl apply` against platform resources is restricted by Kyverno policies that validate the requesting identity.

**ServiceAccount isolation.** Each workload gets its own ServiceAccount with `automountServiceAccountToken: false` by default. Tokens are mounted explicitly only when Kubernetes API access is required.

### 5.3 Istio Service Identity

**NIST Controls:** IA-3 (Device Identification and Authentication), AC-14 (Permitted Actions Without Identification)

Every workload in the mesh receives a SPIFFE identity:

```
spiffe://sre.example.com/ns/<namespace>/sa/<service-account>
```

This identity is:

- **Automatically provisioned.** Istio's Citadel issues an X.509 SVID (SPIFFE Verifiable Identity Document) to every sidecar at pod startup.
- **Short-lived.** Certificates have a 24-hour TTL and are automatically rotated.
- **Used for authorization.** Istio AuthorizationPolicies reference SPIFFE identities in their `source.principals` fields, enabling identity-based (not just network-based) access control.
- **Mutually verified.** Both sides of every connection verify the other's identity. There is no way to make an unauthenticated service call within the mesh.

---

## 6. Secrets Management

### 6.1 OpenBao Architecture

**NIST Controls:** IA-5 (Authenticator Management), SC-12 (Cryptographic Key Establishment), SC-28 (Protection of Information at Rest)

OpenBao (the open-source fork of HashiCorp Vault, fully API-compatible) is deployed in HA mode with Raft storage for secrets management.

**Encryption at rest.** All data stored in OpenBao's Raft backend is encrypted using AES-256-GCM. The master encryption key is itself encrypted by the unseal key.

**Auto-unseal.** In production, OpenBao uses cloud KMS (AWS KMS or Azure Key Vault) for automatic unsealing, eliminating the need for manual unseal operations after a restart. In development, a transit-based unseal mechanism is used.

**Secrets engines configured:**

| Engine | Path | Purpose |
|---|---|---|
| KV v2 | `sre/` | Static secrets for applications (database URLs, API keys) |
| PKI | `pki/` | Internal CA for service certificates |
| Database | `database/` | Dynamic database credentials with automatic rotation |
| Transit | `transit/` | Encryption-as-a-service for applications |

**Audit logging.** Every access to OpenBao is logged. Audit logs are forwarded to Loki via Alloy for centralized retention and analysis. This satisfies NIST AU-2 (Audit Events) for secrets access.

### 6.2 External Secrets Operator (ESO) Sync Pattern

**NIST Controls:** SC-28 (Protection of Information at Rest), CM-3 (Configuration Change Control)

The External Secrets Operator bridges OpenBao and Kubernetes. Instead of storing secrets in Git or passing them through the CI pipeline, ESO pulls secrets from OpenBao and creates native Kubernetes Secrets:

```
OpenBao (source of truth)
  |
  v
ExternalSecret CRD (in Git, no secret values)
  |
  v
ESO controller (syncs on interval)
  |
  v
Kubernetes Secret (native, consumed by pods)
```

Key properties:

- **No secrets in Git.** The `ExternalSecret` CRD contains only the reference path (e.g., `sre/team-alpha/database-url`), never the secret value.
- **Automatic sync.** ESO polls OpenBao at a configurable interval (default: 1 hour) and updates the Kubernetes Secret if the source has changed.
- **ClusterSecretStore.** A single `ClusterSecretStore` configures the connection from ESO to OpenBao using Kubernetes auth. Tenants create `ExternalSecret` resources referencing this store.
- **No application changes required.** Applications consume standard Kubernetes Secrets via environment variables or volume mounts. They do not need an OpenBao SDK or sidecar.

### 6.3 Secret Rotation

**NIST Controls:** IA-5 (Authenticator Management), SC-12 (Cryptographic Key Establishment)

Secret rotation is enforced at multiple levels:

- **Dynamic database credentials.** OpenBao's database secrets engine issues credentials with a configurable TTL (e.g., 1 hour). When the TTL expires, the credentials are revoked and new ones are issued automatically.
- **PKI certificates.** OpenBao's PKI engine and cert-manager both issue short-lived certificates with automatic renewal.
- **Static secrets.** For secrets that cannot be dynamically generated (e.g., third-party API keys), OpenBao's KV v2 engine tracks versions. Operators rotate values in OpenBao, and ESO syncs the updated value to Kubernetes.
- **Cosign signing keys.** Image signing keys are stored in OpenBao and can be rotated by updating the key and the corresponding Kyverno policy's public key.

---

## 7. Cryptography

### 7.1 FIPS 140-2 Mode

**NIST Controls:** SC-13 (Cryptographic Protection)

FIPS 140-2 compliance is enforced at two levels:

**Operating system.** Rocky Linux 9 is configured with the FIPS crypto policy via Ansible:

```bash
# Applied during OS hardening
fips-mode-setup --enable
update-crypto-policies --set FIPS
```

This restricts the OS to using only FIPS 140-2 validated cryptographic modules for all operations, including SSH, TLS, and disk encryption.

**Kubernetes.** RKE2 is compiled with the GoBoring Go compiler, which links against BoringCrypto -- a FIPS 140-2 validated cryptographic module. All Kubernetes control plane communications (API server, etcd, scheduler, controller-manager) use FIPS-validated TLS.

The combination ensures that all cryptographic operations -- from SSH access to the node, to Kubernetes API calls, to etcd data encryption, to Istio mTLS -- use FIPS 140-2 validated algorithms.

### 7.2 TLS Everywhere

**NIST Controls:** SC-8 (Transmission Confidentiality and Integrity), SC-12 (Cryptographic Key Establishment)

TLS is used for every communication path:

| Path | TLS Method | Certificate Source |
|---|---|---|
| Client to Istio gateway | TLS 1.2+ (SIMPLE mode) | cert-manager (Let's Encrypt or internal CA) |
| Gateway to backend pods | Istio mTLS | Istio Citadel (automatic) |
| Pod to pod (in mesh) | Istio mTLS (STRICT) | Istio Citadel (automatic) |
| Kubernetes API server | TLS 1.2+ | RKE2 internal CA |
| etcd cluster | TLS 1.2+ | RKE2 internal CA |
| OpenBao API | TLS 1.2+ | cert-manager |
| Harbor registry | TLS 1.2+ | cert-manager |
| Grafana, Kiali, NeuVector UIs | TLS 1.2+ via Istio gateway | cert-manager |

cert-manager automates certificate lifecycle management:

- **Let's Encrypt** ClusterIssuer for publicly accessible services (dev/staging).
- **Internal CA** ClusterIssuer (self-signed root, intermediate) for internal services and government environments where Let's Encrypt is not available.
- **Automatic renewal.** cert-manager renews certificates before expiration (default: 30 days before expiry).
- **DoD PKI support.** For government deployments, cert-manager can be configured with DoD-issued CA certificates for CAC/PIV authentication.

### 7.3 Encryption at Rest

**NIST Controls:** SC-28 (Protection of Information at Rest), MP-2 (Media Access)

Data at rest is encrypted at multiple levels:

- **Kubernetes Secrets.** RKE2 encrypts Secrets in etcd at rest by default using AES-CBC with a key managed by the Kubernetes API server.
- **OpenBao storage.** OpenBao's Raft backend encrypts all data using AES-256-GCM. The master key is protected by the auto-unseal mechanism.
- **Loki log storage.** Logs stored in S3-compatible object storage (MinIO or AWS S3) are encrypted using server-side encryption (SSE-S3 or SSE-KMS).
- **Persistent volumes.** Cloud provider block storage encryption is configured via OpenTofu (AWS EBS encryption, Azure Disk encryption).

---

## 8. Audit and Monitoring

### 8.1 Kubernetes API Audit Logging

**NIST Controls:** AU-2 (Audit Events), AU-3 (Content of Audit Records), AU-12 (Audit Generation)

RKE2 is configured with a Kubernetes audit policy that captures:

- All authentication events (success and failure)
- All create, update, patch, and delete operations on all resources
- All access to Secrets and ConfigMaps
- All RBAC-related operations (role bindings, cluster role bindings)
- All admission webhook decisions

Audit logs are written in structured JSON format with the following fields (per NIST AU-3 requirements):

- Timestamp (UTC)
- User identity (authenticated principal)
- Source IP address
- HTTP method and URI
- Resource type, name, and namespace
- Response code
- Request and response bodies (at Metadata or Request level, configurable)

Audit logs are collected by Alloy and forwarded to Loki for centralized storage and querying.

### 8.2 Istio Access Logs

**NIST Controls:** AU-2 (Audit Events), AU-3 (Content of Audit Records)

Istio is configured to emit JSON-formatted access logs for every request passing through the mesh:

```yaml
# From platform/core/istio/helmrelease-istiod.yaml
meshConfig:
  accessLogFile: "/dev/stdout"
  accessLogEncoding: "JSON"
```

Every Istio sidecar proxy logs:

- Source and destination service identities (SPIFFE IDs)
- HTTP method, path, response code, and latency
- Request and response sizes
- TLS version and cipher suite used
- Upstream cluster and host information

These logs are collected by Alloy alongside application logs and stored in Loki with the same retention policies.

### 8.3 Centralized Logging with Loki

**NIST Controls:** AU-4 (Audit Storage Capacity), AU-6 (Audit Review and Reporting), AU-9 (Protection of Audit Information)

Grafana Loki is the centralized log aggregation system. Alloy (Grafana's collector, replacing Promtail) runs as a DaemonSet on every node and collects:

- Container stdout/stderr logs from all pods
- Kubernetes API audit logs
- Node journal logs (systemd, kernel, auditd)
- Istio access logs

Retention policies:

| Log Type | Retention Period | Rationale |
|---|---|---|
| Application logs | 30 days | Operational troubleshooting |
| Audit logs | 90 days minimum | Compliance requirement (NIST AU-4) |
| Security events | 90 days minimum | Incident investigation window |

Log storage is encrypted at rest (see Section 7.3) and access is restricted via Grafana RBAC integrated with Keycloak. Only members of the `audit-team` Keycloak group have access to audit log datasources.

### 8.4 NeuVector Security Events

**NIST Controls:** SI-4 (System Monitoring), IR-5 (Incident Monitoring)

NeuVector generates security events for:

- Process profile violations (unexpected process execution)
- File system integrity violations (unauthorized file modifications)
- Network policy violations (unexpected connections)
- Vulnerability scan results (new CVEs in running containers)
- CIS benchmark deviations
- DLP/WAF detections (sensitive data in network traffic)

NeuVector events are exported via SYSLOG to Alloy, which forwards them to Loki. Prometheus metrics from NeuVector's exporter (port 8068) feed Grafana dashboards and AlertManager rules.

### 8.5 Kyverno PolicyReport Violations

**NIST Controls:** CA-7 (Continuous Monitoring), SI-6 (Security Function Verification)

Kyverno generates `PolicyReport` and `ClusterPolicyReport` CRDs that record:

- Every policy evaluation result (pass, fail, warn, error, skip)
- The resource that was evaluated
- The policy and rule that matched
- A human-readable message describing the result

Kyverno Reporter exports these results as Prometheus metrics, enabling:

- **Compliance dashboards.** Grafana dashboards showing policy compliance rates by namespace, team, and policy category.
- **Alerting.** AlertManager rules that fire when compliance drops below a threshold or when critical policy violations are detected.
- **Trend analysis.** Historical compliance data showing improvement or regression over time.

### 8.6 Prometheus and Grafana

**NIST Controls:** SI-4 (System Monitoring), SI-5 (Security Alerts), CA-7 (Continuous Monitoring)

The kube-prometheus-stack provides real-time monitoring with pre-built dashboards for:

- Cluster health (node CPU, memory, disk, network)
- Namespace resource usage and quota consumption
- Istio traffic metrics (request rates, latency, error rates)
- Kyverno policy compliance rates
- NeuVector security event counts and severity
- Flux reconciliation status and failures
- cert-manager certificate expiration timelines

AlertManager is configured with escalation rules for security-relevant events:

| Alert | Severity | Destination |
|---|---|---|
| Kyverno policy violation (critical) | Critical | PagerDuty + Slack |
| NeuVector process profile violation | High | Slack + Email |
| Certificate expiring within 7 days | Warning | Slack |
| Flux reconciliation failure | Warning | Slack |
| Pod running as root detected | Critical | PagerDuty + Slack |
| Image from unapproved registry | Critical | PagerDuty + Slack |
| Loki ingestion failure | High | Slack + Email |

---

## 9. Incident Response

### 9.1 Detection

**NIST Controls:** IR-4 (Incident Handling), IR-5 (Incident Monitoring)

Security incidents are detected through multiple independent channels:

| Detection Source | Event Types | Response Time |
|---|---|---|
| NeuVector alerts | Runtime anomalies, process violations, DLP triggers, network violations | Real-time (seconds) |
| Kyverno PolicyReports | Policy violations on new or existing resources | Near real-time (admission) or periodic (background scan) |
| Prometheus AlertManager | Metric-based anomalies (CPU spikes, unusual traffic patterns, certificate issues) | Configurable (default 5m evaluation) |
| Kubernetes audit logs | Unauthorized API access attempts, privilege escalation, RBAC violations | Near real-time via Loki alerting rules |
| Harbor Trivy scans | New CVEs in deployed images (rescan) | Periodic (configurable scan interval) |

### 9.2 Response Procedures

When a security incident is detected, follow this procedure:

**Phase 1: Triage (0-15 minutes)**

1. Acknowledge the alert in the alerting system (PagerDuty/Slack).
2. Identify the affected namespace, pod, node, and service using Grafana dashboards.
3. Determine the severity level based on the classification table below.

| Severity | Criteria | Response SLA |
|---|---|---|
| Critical | Active data exfiltration, container escape, cluster-level compromise | Immediate (24/7 on-call) |
| High | Unauthorized process execution, policy violation in production, credential exposure | 1 hour |
| Medium | Failed admission attempts, anomalous traffic patterns, non-critical CVE in running image | 4 hours |
| Low | Background policy report failures, development environment violations | Next business day |

**Phase 2: Containment (15-60 minutes)**

1. **Isolate the workload.** Apply a NetworkPolicy that blocks all ingress and egress for the affected pod or namespace:
   ```bash
   kubectl apply -f - <<EOF
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: incident-isolation
     namespace: <affected-namespace>
   spec:
     podSelector:
       matchLabels:
         app: <affected-app>
     policyTypes:
       - Ingress
       - Egress
   EOF
   ```
2. **Preserve evidence.** Capture pod logs, describe output, and NeuVector forensic data before any remediation:
   ```bash
   kubectl logs <pod> -n <namespace> --all-containers > incident-logs.txt
   kubectl describe pod <pod> -n <namespace> > incident-describe.txt
   kubectl get events -n <namespace> --sort-by='.lastTimestamp' > incident-events.txt
   ```
3. **Scale down if necessary.** If the compromise is active, scale the affected Deployment to zero replicas to stop the workload while preserving the Deployment resource for investigation.
4. **Revoke credentials.** If credential theft is suspected, rotate the affected secrets in OpenBao immediately. ESO will sync new values to Kubernetes.

**Phase 3: Investigation (1-24 hours)**

1. Query Loki for all logs from the affected workload during the incident window.
2. Query Istio access logs for network activity to/from the affected workload.
3. Review NeuVector's network visualization for unexpected connections.
4. Check Kyverno PolicyReports for any related policy violations.
5. Review Kubernetes audit logs for API actions taken by the workload's ServiceAccount.
6. Check Harbor for the image's Trivy scan results and SBOM to identify potential vulnerability exploits.

**Phase 4: Remediation (24-72 hours)**

1. Patch the vulnerability or misconfiguration that caused the incident.
2. Rebuild and rescan affected container images.
3. Update Kyverno policies if the incident revealed a gap in admission control.
4. Update NeuVector process profiles if legitimate behavior was incorrectly baselined.
5. Deploy fixes via the standard GitOps workflow (PR, review, merge, Flux reconcile).

**Phase 5: Post-Incident Review (within 1 week)**

1. Conduct a blameless post-incident review with all involved parties.
2. Document the incident timeline, root cause, and remediation actions.
3. Identify improvements to detection, containment, and response procedures.
4. Update runbooks, alert rules, and policies based on lessons learned.
5. File the incident report in the compliance record for auditors (NIST IR-6).

### 9.3 Disaster Recovery

**NIST Controls:** CP-9 (System Backup), CP-10 (System Recovery)

Velero provides cluster backup and restore capabilities:

- **Scheduled backups.** Daily (retain 7), weekly (retain 4), monthly (retain 3).
- **Scope.** All namespaces except `kube-system` and `flux-system` (these are rebuilt from Git).
- **Storage.** S3-compatible object storage with encryption at rest.
- **Restore testing.** Automated CronJob that periodically restores to a test namespace, validates key resources, and cleans up.

For full cluster recovery, the procedure is:

1. Provision new infrastructure using OpenTofu.
2. Harden the OS using Ansible.
3. Install RKE2.
4. Bootstrap Flux CD (which reconciles the entire platform from Git).
5. Restore application data from Velero backups.

Because the entire platform configuration is stored in Git, the cluster can be rebuilt from scratch in under 2 hours (infrastructure provisioning time is the bottleneck).

---

## 10. Threat Model

This section identifies key threats to the SRE platform and the specific mitigations in place for each.

### 10.1 Supply Chain Attacks

**Threat:** An attacker compromises an upstream container image, base image, or dependency to inject malicious code into the platform.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Image source | Only images from `harbor.sre.internal` are permitted | Kyverno `restrict-image-registries` policy (CM-11) |
| Image integrity | All images must be signed with Cosign | Kyverno `verify-image-signatures` policy (SI-7) |
| Vulnerability scanning | Trivy scans on push and periodic rescan | Harbor + Trivy (RA-5) |
| Dependency tracking | SBOM generated for every image | Syft + Harbor OCI artifacts (CM-8) |
| Base image minimization | Chainguard, distroless, or Alpine base images | CI pipeline templates (CM-7) |
| Runtime detection | Process and file system monitoring | NeuVector enforcer (SI-3) |

**Residual risk:** If a zero-day vulnerability exists in a dependency and has no CVE entry, Trivy will not detect it. NeuVector's behavioral monitoring is the last line of defense in this scenario.

### 10.2 Lateral Movement

**Threat:** An attacker who compromises one workload moves laterally to other services, escalating access within the cluster.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Network isolation | Default-deny NetworkPolicies in every namespace | CNI enforcement (AC-4, SC-7) |
| Service identity | mTLS STRICT with SPIFFE identity verification | Istio PeerAuthentication (SC-8, IA-3) |
| Service authorization | Deny-all AuthorizationPolicies with explicit allows | Istio AuthorizationPolicy (AC-3) |
| Egress control | `REGISTRY_ONLY` outbound traffic policy | Istio meshConfig (SC-7) |
| Runtime segmentation | Layer 7 network microsegmentation | NeuVector (SC-7) |
| Credential isolation | Per-workload ServiceAccount, no auto-mounted tokens | Kubernetes RBAC (AC-6) |

**Residual risk:** Lateral movement within a single namespace between pods of the same application is more difficult to detect. NeuVector behavioral baselines and Istio telemetry provide visibility here.

### 10.3 Data Exfiltration

**Threat:** An attacker extracts sensitive data from the cluster to an external destination.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Egress control | Default-deny egress NetworkPolicies | CNI enforcement (AC-4) |
| Egress control | `REGISTRY_ONLY` -- only registered external services permitted | Istio outbound policy (SC-7) |
| DLP | Deep packet inspection for sensitive data patterns | NeuVector DLP sensors (SI-4) |
| DNS control | Only `kube-system` DNS is reachable from pods | NetworkPolicy egress rules |
| Audit trail | All egress connections logged | Istio access logs (AU-2) |

**Residual risk:** Exfiltration through permitted egress channels (e.g., encoding data in legitimate HTTPS requests to an allowed service) is difficult to detect at the platform level. NeuVector's DLP sensors provide partial coverage, but application-level controls may be needed for high-sensitivity data.

### 10.4 Privilege Escalation

**Threat:** An attacker escalates from a non-root container process to root, or from container to node, to gain higher privileges.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Container runtime | `runAsNonRoot: true`, `allowPrivilegeEscalation: false` | Kyverno `require-security-context` policy (AC-6) |
| Capabilities | `capabilities.drop: [ALL]` on all containers | Kyverno policy (CM-7) |
| Seccomp | `RuntimeDefault` seccomp profile (blocks dangerous syscalls) | Pod security context |
| Filesystem | `readOnlyRootFilesystem: true` | Pod security context (CM-7) |
| OS hardening | SELinux enforcing mode, STIG-hardened kernel | Ansible `os-hardening` role (CM-6) |
| Admission control | No privileged containers, no host namespaces, no host path mounts | Kyverno baseline policies (AC-6(10)) |
| Runtime monitoring | Unexpected process execution detected and blocked | NeuVector enforcer (SI-3) |

**Residual risk:** Kernel-level vulnerabilities (container escape via kernel exploit) are mitigated by SELinux and seccomp but cannot be fully prevented at the application layer. Timely kernel patching via the OS hardening pipeline is essential.

### 10.5 Credential Theft

**Threat:** An attacker steals credentials (ServiceAccount tokens, database passwords, API keys) to impersonate legitimate services or access protected resources.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Token exposure | `automountServiceAccountToken: false` by default | Pod security context (AC-6) |
| Dynamic secrets | Short-lived database credentials (1h TTL) | OpenBao database engine (IA-5) |
| Secret rotation | Automatic rotation and revocation | OpenBao + ESO (SC-12) |
| Encryption at rest | Kubernetes Secrets encrypted in etcd | RKE2 default encryption (SC-28) |
| Secret access audit | All OpenBao access logged | OpenBao audit backend to Loki (AU-2) |
| mTLS identity | Service identity tied to X.509 certificates, not bearer tokens | Istio Citadel (IA-3) |
| Git hygiene | No secrets stored in Git -- only ExternalSecret references | ESO pattern (CM-3) |

**Residual risk:** If an attacker gains access to the Kubernetes API with sufficient RBAC permissions, they can read Kubernetes Secrets directly. This is mitigated by tight RBAC scoping and Kubernetes API audit logging.

### 10.6 Denial of Service

**Threat:** An attacker overwhelms platform services or tenant workloads with excessive traffic or resource consumption.

**Mitigations:**

| Layer | Control | Component |
|---|---|---|
| Resource limits | CPU and memory limits enforced on all pods | Kyverno `require-resource-limits` policy |
| Namespace quotas | ResourceQuota and LimitRange per tenant namespace | Tenant onboarding templates |
| Autoscaling | HPA on workloads with configurable min/max replicas | Helm chart templates |
| Rate limiting | Istio rate limiting at the gateway | Istio EnvoyFilter |
| PDB | PodDisruptionBudget prevents total pod eviction | Helm chart templates |
| Monitoring | Resource usage alerts and capacity planning dashboards | Prometheus + Grafana (SI-4) |

---

## 11. Security Exceptions

Certain platform components require elevated privileges to function. These are documented exceptions with compensating controls.

### NeuVector Enforcer DaemonSet

**Exception:** The NeuVector enforcer runs as a privileged DaemonSet with host network, host PID, and host filesystem access.

**Justification:** The enforcer must inspect container runtime state, monitor network traffic at the host level, and access the container runtime socket to perform runtime security scanning and enforcement.

**Compensating controls:**
- NeuVector runs in a dedicated `neuvector` namespace with its own RBAC.
- NetworkPolicies restrict NeuVector's network access to only required ports (controller cluster ports, Kubernetes API, DNS, metrics exporter).
- The NeuVector namespace is excluded from tenant Kyverno policies but covered by platform-level monitoring.
- All NeuVector actions are logged and forwarded to Loki.

### Velero Node Agent

**Exception:** The Velero node agent requires privileged access to read persistent volume data on nodes.

**Justification:** File-level backups of persistent volumes require host filesystem access.

**Compensating controls:**
- Velero runs in a dedicated `velero` namespace with restricted RBAC.
- NetworkPolicies limit Velero's network access to the S3 backup destination and the Kubernetes API.
- Backup operations are logged and monitored.

### Istio Init Containers

**Exception:** Istio's `istio-init` init container runs with `NET_ADMIN` and `NET_RAW` capabilities to configure iptables rules for traffic interception.

**Justification:** The init container must modify the pod's network namespace to redirect traffic through the sidecar proxy.

**Compensating controls:**
- The init container runs for a brief period and exits before the main application starts.
- The main sidecar container runs without elevated privileges.
- The init container image is from the pinned Istio release and verified by Harbor's scan pipeline.

---

## 12. References

| Document | Location |
|---|---|
| Architecture Overview | `docs/architecture.md` |
| Architecture Decision Records | `docs/decisions.md` |
| Compliance Mapping (NIST 800-53) | `docs/agent-docs/compliance-mapping.md` |
| Kyverno Policy Patterns | `docs/agent-docs/kyverno-patterns.md` |
| Flux CD Patterns | `docs/agent-docs/flux-patterns.md` |
| Helm Chart Conventions | `docs/agent-docs/helm-conventions.md` |
| Ansible Patterns | `docs/agent-docs/ansible-patterns.md` |
| OpenTofu Patterns | `docs/agent-docs/tofu-patterns.md` |

### External Standards

| Standard | Reference |
|---|---|
| NIST SP 800-53 Rev 5 | [https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) |
| NIST SP 800-207 (Zero Trust) | [https://csrc.nist.gov/publications/detail/sp/800-207/final](https://csrc.nist.gov/publications/detail/sp/800-207/final) |
| NIST SP 800-63B (Authentication) | [https://pages.nist.gov/800-63-3/sp800-63b.html](https://pages.nist.gov/800-63-3/sp800-63b.html) |
| DISA RKE2 STIG | [https://www.stigviewer.com/stig/rancher_government_solutions_rke2/](https://www.stigviewer.com/stig/rancher_government_solutions_rke2/) |
| DISA RHEL 9 STIG | [https://www.stigviewer.com/stig/red_hat_enterprise_linux_9/](https://www.stigviewer.com/stig/red_hat_enterprise_linux_9/) |
| CIS Kubernetes Benchmark | [https://www.cisecurity.org/benchmark/kubernetes](https://www.cisecurity.org/benchmark/kubernetes) |
| CMMC 2.0 | [https://dodcio.defense.gov/CMMC/](https://dodcio.defense.gov/CMMC/) |
| SPIFFE/SPIRE | [https://spiffe.io/](https://spiffe.io/) |
