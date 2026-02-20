# Proxmox Module — Provider Requirements
# Pin exact versions for reproducible builds.

terraform {
  required_version = "= 1.7.2"

  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "= 0.66.3"
    }
  }
}
