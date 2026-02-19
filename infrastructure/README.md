# Infrastructure

This directory contains all infrastructure-as-code for provisioning and configuring the SRE platform's underlying compute, networking, and OS layers.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `tofu/` | OpenTofu (Terraform-compatible) modules and environment configs for cloud infrastructure |
| `ansible/` | Ansible playbooks and roles for OS hardening and RKE2 installation |
| `packer/` | Packer templates for building pre-hardened VM images |

## Workflow

1. **Build images** with Packer (`infrastructure/packer/`) — produces hardened Rocky Linux 9 AMIs/templates
2. **Provision infrastructure** with OpenTofu (`infrastructure/tofu/`) — creates VMs, networking, load balancers
3. **Configure nodes** with Ansible (`infrastructure/ansible/`) — applies STIG hardening and installs RKE2

After infrastructure is provisioned, Flux CD takes over for all Kubernetes-level configuration (see `platform/`).
