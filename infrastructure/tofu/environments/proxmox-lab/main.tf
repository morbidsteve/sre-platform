# Proxmox Lab Environment — Main Configuration
# Composes the Proxmox module with lab-appropriate defaults.
# Minimal cluster: 1 control plane + 2 workers.

# ────────────────────────────────────────────
# Provider Configuration
# ────────────────────────────────────────────

provider "proxmox" {
  endpoint  = var.proxmox_endpoint
  api_token = var.proxmox_api_token
  insecure  = var.proxmox_insecure

  ssh {
    agent    = true
    username = var.proxmox_ssh_username
  }
}

# ────────────────────────────────────────────
# Local Values
# ────────────────────────────────────────────

locals {
  environment = "lab"
}

# ────────────────────────────────────────────
# Proxmox Cluster
# ────────────────────────────────────────────

module "proxmox_cluster" {
  source = "../../modules/proxmox"

  environment   = local.environment
  proxmox_node  = var.proxmox_node
  template_name = var.template_name
  storage_pool  = var.storage_pool

  # Control plane — minimal for lab
  server_count  = var.server_count
  server_cores  = var.server_cores
  server_memory = var.server_memory

  # Workers
  agent_count  = var.agent_count
  agent_cores  = var.agent_cores
  agent_memory = var.agent_memory

  # Networking
  network_bridge = var.network_bridge
  ip_config      = var.ip_config

  # SSH access
  ssh_public_key = var.ssh_public_key
}
