# Packer VM Image Builds

Packer templates for building pre-hardened, immutable VM images. These images serve as the base for all RKE2 cluster nodes, ensuring a consistent and auditable starting point.

## Templates

| Template | Purpose | Source |
|----------|---------|--------|
| `rocky-linux-9-base/` | Rocky Linux 9 with DISA STIG hardening, FIPS mode, CIS Level 2 | Rocky Linux 9 official AMI / ISO |
| `rocky-linux-9-rke2/` | Extends base with RKE2 binaries and container images pre-staged (air-gap ready) | `sre-rocky9-base` image |

## Build Order

The RKE2 image depends on the base image. Always build in order:

```bash
# 1. Build the base hardened image
packer build rocky-linux-9-base/

# 2. Build the RKE2-ready image (uses base as source)
packer build rocky-linux-9-rke2/
```

## Supported Builders

- **AWS** (`amazon-ebs`) — Produces encrypted AMIs for EC2
- **vSphere** (`vsphere-iso` / `vsphere-clone`) — Produces VM templates for on-prem VMware

## Prerequisites

- Packer >= 1.10.0
- Ansible installed on the build host (used as a provisioner for OS hardening)
- Cloud credentials for the target builder (AWS or vSphere)

## Key Rules

- Pin all source image versions explicitly
- Run the `os-hardening` Ansible role as a provisioner step in the base image
- Validate the image with OpenSCAP before publishing
- Encrypt all output images (AMI encryption, VMDK encryption)
- Never commit credentials — use environment variables or `-var` flags
- Build manifests (`build-manifest.json`) are generated for audit trail

## NIST Controls

These images address NIST 800-53 controls: CM-2 (baseline configuration), CM-6 (configuration settings), SC-13 (FIPS cryptography), SI-7 (software integrity), AU-2 (audit events), AC-17 (remote access hardening).
