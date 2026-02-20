# Rocky Linux 9 Proxmox Image — Variables
# Combined base hardening + RKE2 pre-staging for Proxmox VE environments.

# ── Build Metadata ──

variable "image_name" {
  type        = string
  description = "Name for the output VM template in Proxmox."
  default     = "sre-rocky9-rke2"
}

variable "image_version" {
  type        = string
  description = "Semantic version appended to the template name."
  default     = "1.0.0"
}

variable "image_description" {
  type        = string
  description = "Description embedded in the VM template notes."
  default     = "Rocky Linux 9 — DISA STIG hardened, FIPS enabled, RKE2 pre-staged for air-gap"
}

# ── Proxmox Connection ──

variable "proxmox_url" {
  type        = string
  description = "Proxmox VE API URL (e.g., https://pve.example.com:8006/api2/json)."
}

variable "proxmox_username" {
  type        = string
  description = "Proxmox API username (e.g., root@pam or packer@pve!packer-token)."
  sensitive   = true
}

variable "proxmox_token" {
  type        = string
  description = "Proxmox API token secret. Use an API token instead of password."
  sensitive   = true
}

variable "proxmox_node" {
  type        = string
  description = "Proxmox node name where the build VM will run."
}

variable "proxmox_insecure_skip_tls_verify" {
  type        = bool
  description = "Skip TLS verification for self-signed Proxmox certificates."
  default     = false
}

# ── VM Hardware ──

variable "vm_id" {
  type        = number
  description = "Proxmox VM ID for the template. Set to 0 for auto-assignment."
  default     = 0
}

variable "vm_cores" {
  type        = number
  description = "Number of CPU cores for the build VM."
  default     = 2
}

variable "vm_memory" {
  type        = number
  description = "Memory in MB for the build VM."
  default     = 4096
}

variable "vm_disk_size" {
  type        = string
  description = "Root disk size for the build VM (e.g., 40G)."
  default     = "40G"
}

variable "vm_storage_pool" {
  type        = string
  description = "Proxmox storage pool for the VM disk (e.g., local-lvm, ceph-pool)."
}

variable "vm_network_bridge" {
  type        = string
  description = "Proxmox network bridge for the VM NIC."
  default     = "vmbr0"
}

variable "vm_vlan_tag" {
  type        = number
  description = "VLAN tag for the VM NIC. Set to -1 for no VLAN."
  default     = -1
}

# ── ISO Configuration ──

variable "iso_file" {
  type        = string
  description = "Path to the Rocky Linux 9 ISO on Proxmox storage (e.g., local:iso/Rocky-9.3-x86_64-minimal.iso)."
}

variable "iso_checksum" {
  type        = string
  description = "SHA256 checksum of the ISO file. Use 'none' to skip verification."
  default     = "none"
}

# ── RKE2 Variables ──

variable "rke2_version" {
  type        = string
  description = "RKE2 version to pre-install. Must match the version used in Ansible roles."
  default     = "v1.28.6+rke2r1"
}

variable "rke2_channel" {
  type        = string
  description = "RKE2 release channel."
  default     = "stable"
}

# ── SSH / Provisioner Variables ──

variable "ssh_username" {
  type        = string
  description = "SSH user created by the kickstart for provisioning."
  default     = "packer"
}

variable "ssh_timeout" {
  type        = string
  description = "Timeout waiting for SSH to become available."
  default     = "30m"
}

# ── Common Tags ──

variable "common_tags" {
  type        = map(string)
  description = "Tags applied to the template for compliance and cost tracking."
  default = {
    Project    = "sre-platform"
    ManagedBy  = "packer"
    Compliance = "nist-800-53"
    Hardening  = "disa-stig-rhel9"
    OS         = "rocky-linux-9"
    Role       = "rke2-node"
  }
}
