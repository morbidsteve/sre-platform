# Rocky Linux 9 Proxmox Image

Combined DISA STIG hardened Rocky Linux 9 image with RKE2 pre-staged for air-gap deployment on Proxmox VE. This is a single-build template that produces a ready-to-clone Proxmox VM template for both RKE2 server (control plane) and agent (worker) nodes.

## What This Builds

- Rocky Linux 9 minimal server via kickstart
- QEMU guest agent installed and enabled (required for Proxmox cloud-init and IP reporting)
- DISA STIG hardening applied via the `os-hardening` Ansible role
- FIPS 140-2 cryptographic policy enabled
- SELinux in enforcing mode
- OpenSCAP STIG validation run during build
- RKE2 binary installed (not started — configured at boot by Ansible)
- Air-gap container images pre-pulled (core + Canal CNI)
- `sre-admin` user created for post-deploy Ansible provisioning
- cloud-init configured for Proxmox nocloud datasource

## Prerequisites

- Proxmox VE 8.x with API access
- Packer >= 1.10.0
- Ansible installed on the build host
- Rocky Linux 9 minimal ISO uploaded to Proxmox storage (e.g., `local:iso/Rocky-9.3-x86_64-minimal.iso`)
- API token with VM creation permissions (recommended: create a `packer@pve` user with `PVEVMAdmin` role)

### Creating a Proxmox API Token

```bash
# On the Proxmox host or via the web UI:
pveum user add packer@pve
pveum aclmod / -user packer@pve -role PVEVMAdmin
pveum user token add packer@pve packer-token --privsep=0
# Save the displayed token value — it cannot be retrieved later
```

## Usage

```bash
# Initialize plugins
packer init rocky-linux-9-proxmox/

# Validate
packer validate \
  -var 'proxmox_url=https://pve.example.com:8006/api2/json' \
  -var 'proxmox_username=packer@pve!packer-token' \
  -var 'proxmox_token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \
  -var 'proxmox_node=pve' \
  -var 'iso_file=local:iso/Rocky-9.3-x86_64-minimal.iso' \
  -var 'vm_storage_pool=local-lvm' \
  rocky-linux-9-proxmox/

# Build
packer build \
  -var 'proxmox_url=https://pve.example.com:8006/api2/json' \
  -var 'proxmox_username=packer@pve!packer-token' \
  -var 'proxmox_token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \
  -var 'proxmox_node=pve' \
  -var 'iso_file=local:iso/Rocky-9.3-x86_64-minimal.iso' \
  -var 'vm_storage_pool=local-lvm' \
  -var 'rke2_version=v1.28.6+rke2r1' \
  -var 'image_version=1.0.0' \
  rocky-linux-9-proxmox/
```

### With Self-Signed Certificates

```bash
packer build \
  -var 'proxmox_insecure_skip_tls_verify=true' \
  # ... other vars ...
  rocky-linux-9-proxmox/
```

### With VLAN Tagging

```bash
packer build \
  -var 'vm_vlan_tag=100' \
  # ... other vars ...
  rocky-linux-9-proxmox/
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `image_name` | `sre-rocky9-rke2` | Output template name prefix |
| `image_version` | `1.0.0` | Semantic version for the image |
| `proxmox_url` | *(required)* | Proxmox API URL |
| `proxmox_username` | *(required)* | API user (e.g., `packer@pve!packer-token`) |
| `proxmox_token` | *(required)* | API token secret |
| `proxmox_node` | *(required)* | Target Proxmox node name |
| `proxmox_insecure_skip_tls_verify` | `false` | Skip TLS verification |
| `vm_id` | `0` (auto) | VM ID for the template |
| `vm_cores` | `2` | CPU cores for the build VM |
| `vm_memory` | `4096` | Memory in MB |
| `vm_disk_size` | `40G` | Root disk size |
| `vm_storage_pool` | *(required)* | Proxmox storage pool |
| `vm_network_bridge` | `vmbr0` | Network bridge |
| `vm_vlan_tag` | `-1` (none) | VLAN tag |
| `iso_file` | *(required)* | Rocky Linux 9 ISO path on Proxmox storage |
| `rke2_version` | `v1.28.6+rke2r1` | RKE2 version to pre-install |

See `variables.pkr.hcl` for the full list.

## Build Artifacts

After a successful build, `build-manifest.json` contains metadata including the template name, version, RKE2 version, and build timestamp.

## Build Pipeline

```
Packer builds template (this step)
        |
    Clone VMs via OpenTofu (infrastructure/tofu/modules/proxmox/)
        |
    Ansible configures RKE2 (server or agent role)
        |
    Flux deploys platform services
```

## NIST Controls Addressed

| Control | Implementation |
|---------|---------------|
| CM-2 | Immutable base image with known-good OS + RKE2 version |
| CM-6 | DISA STIG configuration baseline applied |
| CM-8 | Pre-staged images provide a verifiable inventory |
| SC-13 | FIPS 140-2 cryptographic policy enabled |
| SI-7 | AIDE file integrity monitoring + image contents verified at build time |
| AU-2 | Auditd rules for security-relevant events |
| AC-17 | SSH hardened per DISA STIG |
| IA-5 | PAM password quality and lockout policies |
