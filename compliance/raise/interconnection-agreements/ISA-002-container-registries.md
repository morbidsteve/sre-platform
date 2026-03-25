# Interconnection Security Agreement (ISA)

## ISA-002: Upstream Container Registries (Image Mirroring)

| Field | Value |
|-------|-------|
| **ISA ID** | ISA-002 |
| **Connected Systems** | Docker Hub (hub.docker.com), GitHub Container Registry (ghcr.io), Quay.io (quay.io) |
| **System Owners** | Docker Inc., GitHub/Microsoft, Red Hat/IBM |
| **Connection Purpose** | Mirror upstream container images into Harbor for vulnerability scanning and internal distribution |
| **Classification** | CUI / Unclassified |
| **Effective Date** | 2025-06-15 |
| **Review Date** | 2026-06-15 |
| **Status** | Active |

---

## 1. Connection Description

The SRE Platform runs an internal Harbor container registry that mirrors images from upstream public registries. This provides:

1. **Supply chain control**: All images pass through Harbor's Trivy vulnerability scanner before they can be deployed to the cluster.
2. **Air-gap readiness**: Mirrored images enable operation without external registry access.
3. **Performance**: Local image pulls avoid external network dependencies during pod scheduling.

Harbor replication rules pull images from upstream registries on a scheduled basis or on-demand.

## 2. Connection Details

| Parameter | Value |
|-----------|-------|
| **Protocol** | HTTPS (TLS 1.2+) |
| **Port** | 443 |
| **Direction** | Outbound (Harbor to upstream registries) |
| **Authentication** | Docker Hub: optional token; ghcr.io: optional PAT; Quay.io: unauthenticated |
| **Bandwidth** | Variable (initial mirror: GB; incremental: MB) |
| **Schedule** | Daily replication sync or manual trigger |

### Registry Endpoints

| Registry | Endpoint | Rate Limits |
|----------|----------|-------------|
| Docker Hub | registry-1.docker.io | 100 pulls/6h (anonymous), 200/6h (authenticated) |
| GitHub CR | ghcr.io | 5000 requests/hour (authenticated) |
| Quay.io | quay.io | No published limits |

## 3. Data Transmitted

| Data Type | Direction | Classification | Description |
|-----------|-----------|---------------|-------------|
| Container image layers | Upstream -> Harbor | Unclassified | OCI image blobs (application code, base OS layers) |
| Image manifests | Upstream -> Harbor | Unclassified | Image metadata, layer references, platform info |
| Image tags | Upstream -> Harbor | Unclassified | Version tags (pinned, never :latest) |
| Authentication tokens | Harbor -> Upstream | CUI | Registry auth tokens (short-lived) |

**Data NOT transmitted:**
- No cluster data, secrets, or configuration sent to upstream registries
- No internally-built images pushed upstream
- No PII or classified data

## 4. Security Controls

| Control | Implementation |
|---------|---------------|
| **Vulnerability Scanning** | Trivy scans every mirrored image on pull; CRITICAL/HIGH blocks deployment (RA-5) |
| **Image Signing** | Cosign signatures applied after scan pass; Kyverno verifies signatures (SI-7) |
| **Registry Restriction** | Kyverno policy restricts pods to harbor.sre.internal only (CM-11) |
| **Encryption in Transit** | TLS 1.2+ for all registry connections (SC-8) |
| **Tag Pinning** | Only specific version tags mirrored; :latest never replicated (CM-2) |
| **SBOM Generation** | Syft generates SBOM for all mirrored images (SA-11) |
| **Audit Logging** | Harbor audit log tracks all replication events (AU-2) |
| **Quota Management** | Harbor project quotas limit storage per team (CM-8) |

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Upstream registry compromised; malicious image served | Very Low | Critical | Trivy scanning blocks known CVEs; Cosign signatures verify provenance |
| Supply chain attack via dependency confusion | Low | High | Specific image names and versions pinned; no wildcard replication |
| Rate limiting blocks critical image pull | Low | Medium | Authenticated pulls increase limits; images cached locally in Harbor |
| Upstream registry outage | Medium | Low | All images cached in Harbor; cluster operates from local cache |
| Image with zero-day vulnerability mirrored | Medium | High | NeuVector runtime scanning detects post-deployment; continuous re-scanning |

## 6. Residual Risk

**Accepted Risk:** Upstream container images may contain vulnerabilities not yet in CVE databases (zero-days). Mitigated by NeuVector runtime behavioral monitoring and continuous Trivy re-scanning of all Harbor images.

## 7. NIST Control Mapping

- **CM-11**: Kyverno restricts image sources to Harbor only
- **RA-5**: Trivy vulnerability scanning on all mirrored images
- **SA-11**: SBOM generation for supply chain transparency
- **SC-8**: TLS encryption for all registry communications
- **SI-7**: Cosign image signatures verified by Kyverno admission control

## 8. Points of Contact

| Role | Name | Organization |
|------|------|-------------|
| Harbor Admin | Platform Team Lead | SRE Platform Team |
| Supply Chain Security | Security Engineer | SRE Security Team |

---

*Last reviewed: 2025-06-15*
*Next review due: 2026-06-15*
