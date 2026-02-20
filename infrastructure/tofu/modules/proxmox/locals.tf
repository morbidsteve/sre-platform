# Proxmox Module — Local Values
# Computed values for VM naming, tagging, and IP configuration.

locals {
  # VM naming convention: sre-{env}-rke2-{role}-{index}
  server_names = [
    for i in range(var.server_count) :
    "sre-${var.environment}-rke2-server-${i}"
  ]

  agent_names = [
    for i in range(var.agent_count) :
    "sre-${var.environment}-rke2-agent-${i}"
  ]

  # Tags applied to all VMs (Proxmox uses semicolon-separated tags)
  vm_tags = var.common_tags

  # IP configuration
  use_dhcp = var.ip_config == "dhcp"

  # Parse CIDR for static IP assignment
  # Expected format: "10.0.1.0/24,gw=10.0.1.1"
  ip_parts = local.use_dhcp ? [] : split(",", var.ip_config)
  gateway  = local.use_dhcp ? "" : (
    length(local.ip_parts) > 1 ? replace(local.ip_parts[1], "gw=", "") : ""
  )
  cidr_mask = local.use_dhcp ? "" : (
    length(local.ip_parts) > 0 ? "/${split("/", local.ip_parts[0])[1]}" : ""
  )
}
