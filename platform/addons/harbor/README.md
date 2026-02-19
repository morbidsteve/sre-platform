# Harbor Container Registry (Addon)

Internal container registry with integrated vulnerability scanning, image signing, and SBOM storage.

## What It Does

- Trivy vulnerability scanning on every image push
- Cosign signature verification on pull
- Image replication from upstream registries (Docker Hub, GHCR, Chainguard)
- SBOM storage in SPDX and CycloneDX formats
- Robot accounts for CI/CD pipeline automation
- Project-based RBAC for multi-tenant isolation

## NIST Controls

- RA-5 (Vulnerability Scanning) — Trivy scans all images on push
- SI-7 (Software Integrity) — Cosign signature verification
- SA-11 (Developer Testing) — Scan gates block vulnerable images
- CM-8 (Component Inventory) — SBOM tracking for all images

## Dependencies

- Depends on: Istio, cert-manager, Monitoring
