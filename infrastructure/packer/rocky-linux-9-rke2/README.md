# Rocky Linux 9 RKE2 Image

Extends the base hardened Rocky Linux 9 image with RKE2 binaries and container images pre-staged for air-gap deployment. This image is used for both RKE2 server (control plane) and agent (worker) nodes.

## What This Builds

- Starts from the `sre-rocky9-base` hardened image
- RKE2 binary installed (not started — configured at boot by Ansible)
- Air-gap container images pre-pulled (core + Canal CNI)
- SELinux policy for RKE2 installed
- Kernel modules pre-configured (br_netfilter, overlay)

## Supported Builders

| Builder | Source | Output |
|---------|--------|--------|
| `amazon-ebs` | Base hardened AMI (`sre-rocky9-base-*`) | Encrypted AMI with RKE2 |
| `vsphere-clone` | Base hardened vSphere template | vSphere VM template with RKE2 |

## Prerequisites

- The base image must be built first: `packer build rocky-linux-9-base/`
- Packer >= 1.10.0
- For AWS: the base AMI must exist in the target region
- For vSphere: the base template must exist in the target vCenter

## Usage

### AWS

```bash
# Initialize plugins
packer init rocky-linux-9-rke2/

# Build (automatically finds the latest base AMI)
packer build -only='*.amazon-ebs.*' \
  -var 'aws_region=us-east-1' \
  -var 'image_version=1.0.0' \
  -var 'rke2_version=v1.28.6+rke2r1' \
  rocky-linux-9-rke2/
```

### vSphere

```bash
packer build -only='*.vsphere-clone.*' \
  -var 'vsphere_server=vcenter.example.com' \
  -var 'vsphere_username=admin@vsphere.local' \
  -var 'vsphere_password=REPLACE_ME' \
  -var 'vsphere_datacenter=DC1' \
  -var 'vsphere_cluster=Cluster1' \
  -var 'vsphere_datastore=datastore1' \
  -var 'vsphere_network=VM Network' \
  -var 'vsphere_source_template=sre-rocky9-base-1.0.0-...' \
  -var 'image_version=1.0.0' \
  -var 'rke2_version=v1.28.6+rke2r1' \
  rocky-linux-9-rke2/
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `image_name` | `sre-rocky9-rke2` | Output image name prefix |
| `image_version` | `1.0.0` | Semantic version for the image |
| `rke2_version` | `v1.28.6+rke2r1` | RKE2 version to pre-install |
| `rke2_channel` | `stable` | RKE2 release channel |
| `aws_source_ami_name` | `sre-rocky9-base-*` | Filter for the base AMI |
| `aws_source_ami_owners` | `["self"]` | AMI owner (self = same account) |

See `variables.pkr.hcl` for the full list.

## Air-Gap Support

The build pre-downloads RKE2 container image tarballs to `/var/lib/rancher/rke2/agent/images/`. When RKE2 starts, it automatically loads images from this directory, eliminating the need for internet access at runtime.

Pre-staged images:
- `rke2-images-core` — Core Kubernetes components
- `rke2-images-canal` — Canal CNI (the FIPS-validated CNI option)

To add custom images for air-gap, use the `airgap_images` variable or add an additional provisioner step.

## Build Order

```
rocky-linux-9-base (OS hardening)
        ↓
rocky-linux-9-rke2 (RKE2 pre-staged)
        ↓
    Deploy VM
        ↓
  Ansible configures RKE2 (server or agent role)
        ↓
  Flux deploys platform services
```

## NIST Controls Addressed

Inherits all controls from the base image, plus:

| Control | Implementation |
|---------|---------------|
| CM-2 | Immutable base image with known-good RKE2 version |
| CM-8 | Pre-staged images provide a verifiable inventory |
| SI-7 | Image contents verified at build time |
| SC-13 | RKE2 FIPS mode uses BoringCrypto |
