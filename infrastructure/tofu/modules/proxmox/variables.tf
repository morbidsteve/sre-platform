# Proxmox Module — Input Variables
# All variables include type, description, and validation where applicable.
# NIST Controls: CM-6 (configuration settings), AC-6 (least privilege)

# ── Environment ──

variable "environment" {
  type        = string
  description = "Deployment environment name used for resource naming and tagging."
  default     = "lab"

  validation {
    condition     = contains(["lab", "dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: lab, dev, staging, production."
  }
}

# ── Proxmox Target ──

variable "proxmox_node" {
  type        = string
  description = "Proxmox VE node name where VMs will be created."

  validation {
    condition     = length(var.proxmox_node) > 0
    error_message = "Proxmox node name must not be empty."
  }
}

variable "template_name" {
  type        = string
  description = "Name of the Packer-built VM template to clone (from rocky-linux-9-proxmox build)."

  validation {
    condition     = length(var.template_name) > 0
    error_message = "Template name must not be empty."
  }
}

# ── Storage ──

variable "storage_pool" {
  type        = string
  description = "Proxmox storage pool for VM disks (e.g., local-lvm, ceph-pool). No default — must be set explicitly."

  validation {
    condition     = length(var.storage_pool) > 0
    error_message = "Storage pool must not be empty. Specify your Proxmox storage pool name."
  }
}

# ── Server (Control Plane) Nodes ──

variable "server_count" {
  type        = number
  description = "Number of RKE2 server (control plane) nodes. Must be an odd number for etcd quorum."
  default     = 1

  validation {
    condition     = var.server_count >= 1 && var.server_count <= 7 && var.server_count % 2 == 1
    error_message = "Server count must be an odd number between 1 and 7 for etcd quorum."
  }
}

variable "server_cores" {
  type        = number
  description = "Number of CPU cores per server node."
  default     = 4

  validation {
    condition     = var.server_cores >= 2 && var.server_cores <= 32
    error_message = "Server cores must be between 2 and 32."
  }
}

variable "server_memory" {
  type        = number
  description = "Memory in MB per server node. Minimum 4096 for RKE2 control plane."
  default     = 8192

  validation {
    condition     = var.server_memory >= 4096 && var.server_memory <= 131072
    error_message = "Server memory must be between 4096 and 131072 MB."
  }
}

variable "server_disk_size" {
  type        = number
  description = "Root disk size in GB per server node."
  default     = 50

  validation {
    condition     = var.server_disk_size >= 40 && var.server_disk_size <= 500
    error_message = "Server disk size must be between 40 and 500 GB."
  }
}

# ── Agent (Worker) Nodes ──

variable "agent_count" {
  type        = number
  description = "Number of RKE2 agent (worker) nodes."
  default     = 2

  validation {
    condition     = var.agent_count >= 1 && var.agent_count <= 20
    error_message = "Agent count must be between 1 and 20."
  }
}

variable "agent_cores" {
  type        = number
  description = "Number of CPU cores per agent node."
  default     = 4

  validation {
    condition     = var.agent_cores >= 2 && var.agent_cores <= 32
    error_message = "Agent cores must be between 2 and 32."
  }
}

variable "agent_memory" {
  type        = number
  description = "Memory in MB per agent node. Minimum 4096 for workloads."
  default     = 8192

  validation {
    condition     = var.agent_memory >= 4096 && var.agent_memory <= 131072
    error_message = "Agent memory must be between 4096 and 131072 MB."
  }
}

variable "agent_disk_size" {
  type        = number
  description = "Root disk size in GB per agent node."
  default     = 50

  validation {
    condition     = var.agent_disk_size >= 40 && var.agent_disk_size <= 500
    error_message = "Agent disk size must be between 40 and 500 GB."
  }
}

# ── Networking ──

variable "network_bridge" {
  type        = string
  description = "Proxmox network bridge for VM NICs."
  default     = "vmbr0"
}

variable "vlan_tag" {
  type        = number
  description = "VLAN tag for VM NICs. Set to -1 for no VLAN tagging."
  default     = -1

  validation {
    condition     = var.vlan_tag == -1 || (var.vlan_tag >= 1 && var.vlan_tag <= 4094)
    error_message = "VLAN tag must be -1 (disabled) or between 1 and 4094."
  }
}

variable "ip_config" {
  type        = string
  description = "IP configuration for cloud-init. Use 'dhcp' or a CIDR with gateway (e.g., '10.0.1.0/24,gw=10.0.1.1'). When set to a CIDR, VMs get sequential IPs starting from server_ip_start and agent_ip_start."
  default     = "dhcp"
}

variable "server_ip_start" {
  type        = string
  description = "Starting IP address for server nodes when using static IP config (e.g., '10.0.1.10'). Only used when ip_config is not 'dhcp'."
  default     = ""
}

variable "agent_ip_start" {
  type        = string
  description = "Starting IP address for agent nodes when using static IP config (e.g., '10.0.1.20'). Only used when ip_config is not 'dhcp'."
  default     = ""
}

variable "nameserver" {
  type        = string
  description = "DNS nameserver for cloud-init. Only used when ip_config is not 'dhcp'."
  default     = ""
}

variable "search_domain" {
  type        = string
  description = "DNS search domain for cloud-init. Only used when ip_config is not 'dhcp'."
  default     = ""
}

# ── SSH ──

variable "ssh_public_key" {
  type        = string
  description = "SSH public key injected via cloud-init for the sre-admin user."
  sensitive   = true

  validation {
    condition     = can(regex("^ssh-(rsa|ed25519|ecdsa)", var.ssh_public_key))
    error_message = "SSH public key must start with ssh-rsa, ssh-ed25519, or ssh-ecdsa."
  }
}

# ── Tags ──

variable "common_tags" {
  type        = list(string)
  description = "Proxmox tags applied to all VMs for identification and filtering."
  default     = ["sre-platform", "opentofu-managed", "nist-800-53"]
}
