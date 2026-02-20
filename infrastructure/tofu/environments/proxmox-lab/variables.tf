# Proxmox Lab Environment — Input Variables
# Provider connection variables and resource configuration overrides.

# ── Proxmox Provider Connection ──

variable "proxmox_endpoint" {
  type        = string
  description = "Proxmox VE API endpoint URL (e.g., https://pve.example.com:8006)."

  validation {
    condition     = can(regex("^https?://", var.proxmox_endpoint))
    error_message = "Proxmox endpoint must start with http:// or https://."
  }
}

variable "proxmox_api_token" {
  type        = string
  description = "Proxmox API token in 'USER@REALM!TOKENID=SECRET' format. Inject via TF_VAR_proxmox_api_token."
  sensitive   = true

  validation {
    condition     = length(var.proxmox_api_token) > 0
    error_message = "Proxmox API token must not be empty."
  }
}

variable "proxmox_insecure" {
  type        = bool
  description = "Skip TLS verification for self-signed Proxmox certificates."
  default     = false
}

variable "proxmox_ssh_username" {
  type        = string
  description = "SSH username for Proxmox node access (used by provider for file uploads)."
  default     = "root"
}

# ── Cluster Configuration ──

variable "proxmox_node" {
  type        = string
  description = "Proxmox VE node name where VMs will be created."
}

variable "template_name" {
  type        = string
  description = "Name of the Packer-built VM template to clone."
  default     = "sre-rocky9-rke2"
}

variable "storage_pool" {
  type        = string
  description = "Proxmox storage pool for VM disks."
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key for the sre-admin user. Inject via TF_VAR_ssh_public_key."
  sensitive   = true
}

# ── Optional Overrides ──

variable "server_count" {
  type        = number
  description = "Number of control plane nodes."
  default     = 1
}

variable "agent_count" {
  type        = number
  description = "Number of worker nodes."
  default     = 2
}

variable "server_cores" {
  type        = number
  description = "CPU cores per server node."
  default     = 4
}

variable "server_memory" {
  type        = number
  description = "Memory in MB per server node."
  default     = 8192
}

variable "agent_cores" {
  type        = number
  description = "CPU cores per agent node."
  default     = 4
}

variable "agent_memory" {
  type        = number
  description = "Memory in MB per agent node."
  default     = 8192
}

variable "network_bridge" {
  type        = string
  description = "Proxmox network bridge for VM NICs."
  default     = "vmbr0"
}

variable "ip_config" {
  type        = string
  description = "IP configuration: 'dhcp' or 'CIDR,gw=GATEWAY'."
  default     = "dhcp"
}
