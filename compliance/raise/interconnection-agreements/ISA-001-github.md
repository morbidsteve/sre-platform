# Interconnection Security Agreement (ISA)

## ISA-001: GitHub (GitOps and CI/CD)

| Field | Value |
|-------|-------|
| **ISA ID** | ISA-001 |
| **Connected System** | GitHub (github.com) |
| **System Owner** | GitHub, Inc. (Microsoft) |
| **Connection Purpose** | GitOps source of truth for platform configuration; CI/CD pipeline execution |
| **Classification** | CUI / Unclassified |
| **Effective Date** | 2025-06-15 |
| **Review Date** | 2026-06-15 |
| **Status** | Active |

---

## 1. Connection Description

The SRE Platform connects to GitHub for two primary functions:

1. **GitOps Source of Truth**: Flux CD polls the GitHub repository (`github.com/morbidsteve/sre-platform`) over HTTPS to reconcile cluster state against the Git-committed configuration. All platform manifests, Helm values, Kyverno policies, and tenant configurations are stored in Git.

2. **CI/CD Pipeline Execution**: GitHub Actions runs CI pipelines on push/PR events. Pipelines execute linting, policy tests, compliance validation, container image builds, and security scans.

## 2. Connection Details

| Parameter | Value |
|-----------|-------|
| **Protocol** | HTTPS (TLS 1.2+) |
| **Port** | 443 |
| **Direction** | Outbound (cluster to GitHub) |
| **Authentication** | SSH key or deploy token (read-only for Flux); GitHub PAT for CI push |
| **IP Ranges** | GitHub API: documented at api.github.com/meta |
| **Bandwidth** | Minimal (Git pulls < 10 MB/poll, 10-minute interval) |
| **Availability** | GitHub SLA: 99.9% uptime |

## 3. Data Transmitted

| Data Type | Direction | Classification | Description |
|-----------|-----------|---------------|-------------|
| Platform manifests | GitHub -> Cluster | CUI | Kubernetes YAML, Helm values, Kyverno policies |
| CI pipeline results | Cluster -> GitHub | CUI | Lint/test/scan results, status checks |
| Git metadata | Bidirectional | Unclassified | Commit SHAs, branch names, timestamps |
| Container image tags | Cluster -> GitHub | CUI | Image version updates via Git push |

**Data NOT transmitted:**
- Secrets, credentials, or tokens (stored in OpenBao, never in Git)
- Kubernetes cluster state or runtime data
- PII or classified information

## 4. Security Controls

| Control | Implementation |
|---------|---------------|
| **Encryption in Transit** | TLS 1.2+ for all HTTPS connections (SC-8) |
| **Authentication** | Deploy keys with read-only scope; PATs with minimal permissions (IA-2) |
| **Authorization** | Branch protection rules; required reviewers; signed commits (AC-3) |
| **Audit Logging** | GitHub audit log; Flux reconciliation events logged to Loki (AU-2) |
| **Secret Protection** | GitHub Secrets for CI; never stored in repository files (SC-28) |
| **Integrity** | Git commit signatures; Flux verifies Git SHA before applying (SI-7) |
| **Availability** | Flux caches last-known-good state; cluster operates independently during GitHub outage (CP-2) |

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GitHub outage prevents GitOps reconciliation | Low | Low | Flux caches state; cluster continues operating on last-known-good config |
| Compromised GitHub account pushes malicious config | Low | High | Branch protection, required reviews, Kyverno policy enforcement blocks invalid manifests |
| Man-in-the-middle on HTTPS connection | Very Low | High | TLS certificate pinning; Git SHA verification by Flux |
| GitHub Actions runner compromise | Low | Medium | Minimal CI permissions; no cluster credentials in CI; Flux pulls (not pushes) |

## 6. Residual Risk

**Accepted Risk:** The platform depends on GitHub availability for configuration updates. During a GitHub outage, the cluster continues operating with its current configuration but cannot receive updates. This is accepted because Flux's pull-based model ensures the cluster never depends on GitHub for runtime operation.

## 7. NIST Control Mapping

- **AC-4**: Information flow restricted to Git protocol data only
- **AC-17**: Remote access via authenticated HTTPS with deploy keys
- **AU-2**: All Git operations logged in GitHub audit log and Flux events
- **CM-2**: Git repository serves as the authoritative baseline configuration
- **SA-10**: All configuration changes tracked via Git with full attribution
- **SC-8**: TLS 1.2+ encryption for all data in transit

## 8. Points of Contact

| Role | Name | Organization |
|------|------|-------------|
| System Owner (SRE) | Platform Team Lead | SRE Platform Team |
| GitHub Admin | Repository Owner | Organization Admin |
| Security POC | Security Engineer | SRE Security Team |

---

*Last reviewed: 2025-06-15*
*Next review due: 2026-06-15*
