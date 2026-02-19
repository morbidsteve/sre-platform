# Packer VM Image Builds

Packer templates for building pre-hardened, immutable VM images. These images serve as the base for all RKE2 cluster nodes, ensuring a consistent and auditable starting point.

## Templates

| Template | Purpose |
|----------|---------|
| `rocky-linux-9-base/` | Rocky Linux 9 with DISA STIG hardening, FIPS mode, CIS Level 2 |
| `rocky-linux-9-rke2/` | Extends base image with RKE2 binaries and container images pre-staged (air-gap ready) |

## Supported Builders

- **AWS** — Produces AMIs for EC2
- **vSphere** — Produces VM templates for on-prem VMware

## Usage

```bash
# Build the base hardened image
packer build -var-file=variables.auto.pkrvars.hcl rocky-linux-9-base/

# Build the RKE2-ready image (uses base as source)
packer build -var-file=variables.auto.pkrvars.hcl rocky-linux-9-rke2/
```

## Key Rules

- Pin all source image versions explicitly
- Run the `os-hardening` Ansible role as a provisioner step
- Validate the image with InSpec or `oscap` before publishing
