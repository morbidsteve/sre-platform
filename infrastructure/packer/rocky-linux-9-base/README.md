# Rocky Linux 9 Base Image

Pre-hardened Rocky Linux 9 image with DISA STIG compliance, FIPS 140-2 mode enabled, and CIS Level 2 benchmarks applied. This image serves as the foundation for all SRE platform nodes.

## What This Builds

- Rocky Linux 9 minimal server installation
- DISA STIG hardening applied via the `os-hardening` Ansible role
- FIPS 140-2 cryptographic policy enabled
- SELinux in enforcing mode
- Auditd configured for NIST AU-family controls
- SSH hardened per DISA STIG requirements
- OpenSCAP validation run during build (results in build manifest)

## Supported Builders

| Builder | Source | Output |
|---------|--------|--------|
| `amazon-ebs` | Rocky Linux 9 official AMI | Encrypted AMI |
| `vsphere-iso` | Rocky Linux 9 ISO via kickstart | vSphere VM template |

## Prerequisites

- Packer >= 1.10.0
- Ansible installed on the build host
- For AWS: valid AWS credentials with EC2/AMI permissions
- For vSphere: vCenter credentials and a Rocky Linux 9 ISO uploaded to a datastore

## Usage

### AWS

```bash
# Initialize plugins
packer init rocky-linux-9-base/

# Validate
packer validate -only='*.amazon-ebs.*' rocky-linux-9-base/

# Build
packer build -only='*.amazon-ebs.*' \
  -var 'aws_region=us-east-1' \
  -var 'image_version=1.0.0' \
  rocky-linux-9-base/
```

### vSphere

```bash
packer build -only='*.vsphere-iso.*' \
  -var 'vsphere_server=vcenter.example.com' \
  -var 'vsphere_username=admin@vsphere.local' \
  -var 'vsphere_password=REPLACE_ME' \
  -var 'vsphere_datacenter=DC1' \
  -var 'vsphere_cluster=Cluster1' \
  -var 'vsphere_datastore=datastore1' \
  -var 'vsphere_network=VM Network' \
  -var 'vsphere_iso_path=[datastore1] ISO/Rocky-9.3-x86_64-minimal.iso' \
  -var 'image_version=1.0.0' \
  rocky-linux-9-base/
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `image_name` | `sre-rocky9-base` | Output image name prefix |
| `image_version` | `1.0.0` | Semantic version for the image |
| `aws_region` | `us-east-1` | AWS build region |
| `aws_encrypt_boot` | `true` | Encrypt the AMI volume |
| `ssh_username` | `packer` | SSH user for provisioning |

See `variables.pkr.hcl` for the full list.

## Build Artifacts

After a successful build, `build-manifest.json` contains metadata including the output image ID, version, and build timestamp.

## NIST Controls Addressed

| Control | Implementation |
|---------|---------------|
| CM-6 | DISA STIG configuration baseline applied |
| SC-13 | FIPS 140-2 cryptographic policy enabled |
| SI-7 | AIDE file integrity monitoring configured |
| AU-2 | Auditd rules for security-relevant events |
| AC-17 | SSH hardened per DISA STIG |
| IA-5 | PAM password quality and lockout policies |
