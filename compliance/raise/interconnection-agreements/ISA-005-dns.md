# Interconnection Security Agreement (ISA)

## ISA-005: DNS Resolution Services

| Field | Value |
|-------|-------|
| **ISA ID** | ISA-005 |
| **Connected System** | DNS resolvers (upstream DNS servers) |
| **System Owner** | Cloud provider DNS / ISP DNS / DoD DNS (environment-dependent) |
| **Connection Purpose** | Domain name resolution for external service access (registries, ACME, telemetry endpoints) |
| **Classification** | Unclassified |
| **Effective Date** | 2025-06-15 |
| **Review Date** | 2026-06-15 |
| **Status** | Active |

---

## 1. Connection Description

The SRE Platform requires DNS resolution for:

1. **Container image pulls**: Resolving registry hostnames (harbor.apps.sre.example.com, registry-1.docker.io).
2. **Certificate issuance**: Resolving ACME endpoints (acme-v02.api.letsencrypt.org).
3. **GitOps**: Resolving GitHub API endpoints (github.com, api.github.com).
4. **Internal services**: CoreDNS provides cluster-internal DNS resolution for Kubernetes Services.
5. **Node DNS**: DaemonSet-managed /etc/hosts on bare metal nodes maps *.apps.sre.example.com to the Istio gateway LoadBalancer IP.

### DNS Architecture

```
Pod DNS query
  -> CoreDNS (cluster-internal, *.cluster.local)
    -> Node DNS (/etc/hosts for *.apps.sre.example.com)
      -> Upstream DNS resolver (external domains)
```

## 2. Connection Details

| Parameter | Value |
|-----------|-------|
| **Protocol** | DNS over UDP/TCP (port 53); DoT (port 853) where supported |
| **Direction** | Outbound (CoreDNS to upstream resolvers) |
| **Internal DNS** | CoreDNS (deployed by RKE2) |
| **Upstream Resolvers** | Cloud provider DNS or configured resolvers |
| **Caching** | CoreDNS TTL-based caching reduces upstream queries |

### Resolver Configuration by Environment

| Environment | Upstream DNS | Notes |
|-------------|-------------|-------|
| Proxmox Lab | Node /etc/resolv.conf + hosts DaemonSet | Local resolution via DaemonSet |
| AWS | VPC DNS (AmazonProvidedDNS) | Automatic with VPC |
| Azure | Azure DNS | Automatic with VNet |
| Air-gapped | Local DNS server | No external resolution |

## 3. Data Transmitted

| Data Type | Direction | Classification | Description |
|-----------|-----------|---------------|-------------|
| DNS queries | Node -> Resolver | Unclassified | Domain name lookup requests |
| DNS responses | Resolver -> Node | Unclassified | IP address responses with TTL |

**Data NOT transmitted:**
- No cluster topology or internal service names leak externally (CoreDNS handles *.cluster.local internally)
- No authentication data
- No PII or CUI

## 4. Security Controls

| Control | Implementation |
|---------|---------------|
| **Internal DNS Isolation** | CoreDNS handles all cluster.local queries internally; no external leakage (SC-3) |
| **DNS Caching** | CoreDNS caches responses to reduce external query volume (SC-7) |
| **NetworkPolicy** | CoreDNS pods restricted to kube-system namespace (AC-4) |
| **DNS Monitoring** | CoreDNS metrics exported to Prometheus; anomaly alerts configured (SI-4) |
| **Node DNS Management** | DaemonSet manages /etc/hosts entries on bare metal nodes (CM-6) |
| **Egress Restriction** | Kyverno policies restrict pod egress DNS to CoreDNS only (AC-4) |
| **DNSSEC** | Upstream resolvers validate DNSSEC where supported (SC-8) |

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DNS poisoning delivers wrong IP for registry | Very Low | High | DNSSEC validation; TLS certificate verification on HTTPS connections |
| DNS outage prevents external service resolution | Low | Medium | CoreDNS caching; retries with exponential backoff |
| DNS tunneling for data exfiltration | Low | High | NeuVector network DLP; CoreDNS query logging; egress NetworkPolicies |
| Internal service names leak via DNS queries | Very Low | Low | CoreDNS resolves cluster.local internally; external queries use FQDNs only |

## 6. Residual Risk

**Accepted Risk:** Standard DNS (port 53) is unencrypted. DNS queries for external services (github.com, registry hostnames) are visible to network observers. Mitigated by: (1) all subsequent connections use TLS, so DNS knowledge alone is insufficient for attack, (2) DNS-over-TLS available for supported upstream resolvers.

## 7. NIST Control Mapping

- **AC-4**: Network policies restrict DNS traffic flow; CoreDNS isolates internal from external DNS
- **SC-3**: Cluster-internal DNS resolution isolated from external via CoreDNS
- **SC-7**: DNS queries restricted to approved upstream resolvers
- **SC-8**: DNSSEC validation where available; DNS-over-TLS supported
- **SI-4**: CoreDNS metrics monitored via Prometheus; query logging for audit

## 8. Points of Contact

| Role | Name | Organization |
|------|------|-------------|
| DNS Admin | Platform Team Lead | SRE Platform Team |
| Network Security | Security Engineer | SRE Security Team |

---

*Last reviewed: 2025-06-15*
*Next review due: 2026-06-15*
