# Proxmox Module — VM Resources
# Creates RKE2 server and agent VMs cloned from a Packer-built template.
# NIST Controls: CM-2 (baseline config), CM-6 (configuration settings),
#                SC-28 (protection of information at rest)

# ────────────────────────────────────────────
# Template Lookup
# ────────────────────────────────────────────

data "proxmox_virtual_environment_vms" "template" {
  node_name = var.proxmox_node

  filter {
    name   = "name"
    regex  = true
    values = [var.template_name]
  }
}

# ────────────────────────────────────────────
# RKE2 Server (Control Plane) Nodes
# ────────────────────────────────────────────

resource "proxmox_virtual_environment_vm" "server" {
  count = var.server_count

  name      = local.server_names[count.index]
  node_name = var.proxmox_node
  tags      = local.vm_tags
  on_boot   = true

  clone {
    vm_id = data.proxmox_virtual_environment_vms.template.vms[0].vm_id
    full  = true
  }

  agent {
    enabled = true
  }

  cpu {
    cores = var.server_cores
    type  = "host"
  }

  memory {
    dedicated = var.server_memory
  }

  disk {
    datastore_id = var.storage_pool
    interface    = "scsi0"
    size         = var.server_disk_size
  }

  network_device {
    bridge   = var.network_bridge
    model    = "virtio"
    vlan_id  = var.vlan_tag != -1 ? var.vlan_tag : null
  }

  initialization {
    user_data_file_id = proxmox_virtual_environment_file.cloud_init_user_data.id

    ip_config {
      ipv4 {
        address = local.use_dhcp ? "dhcp" : "${var.server_ip_start != "" ? cidrhost("${var.server_ip_start}${local.cidr_mask}", count.index) : "dhcp"}${local.use_dhcp ? "" : local.cidr_mask}"
        gateway = local.use_dhcp ? null : local.gateway
      }
    }

    dynamic "dns" {
      for_each = var.nameserver != "" ? [1] : []
      content {
        servers = [var.nameserver]
        domain  = var.search_domain
      }
    }
  }

  lifecycle {
    ignore_changes = [
      clone,
    ]
  }
}

# ────────────────────────────────────────────
# RKE2 Agent (Worker) Nodes
# ────────────────────────────────────────────

resource "proxmox_virtual_environment_vm" "agent" {
  count = var.agent_count

  name      = local.agent_names[count.index]
  node_name = var.proxmox_node
  tags      = local.vm_tags
  on_boot   = true

  clone {
    vm_id = data.proxmox_virtual_environment_vms.template.vms[0].vm_id
    full  = true
  }

  agent {
    enabled = true
  }

  cpu {
    cores = var.agent_cores
    type  = "host"
  }

  memory {
    dedicated = var.agent_memory
  }

  disk {
    datastore_id = var.storage_pool
    interface    = "scsi0"
    size         = var.agent_disk_size
  }

  network_device {
    bridge   = var.network_bridge
    model    = "virtio"
    vlan_id  = var.vlan_tag != -1 ? var.vlan_tag : null
  }

  initialization {
    user_data_file_id = proxmox_virtual_environment_file.cloud_init_user_data.id

    ip_config {
      ipv4 {
        address = local.use_dhcp ? "dhcp" : "${var.agent_ip_start != "" ? cidrhost("${var.agent_ip_start}${local.cidr_mask}", count.index) : "dhcp"}${local.use_dhcp ? "" : local.cidr_mask}"
        gateway = local.use_dhcp ? null : local.gateway
      }
    }

    dynamic "dns" {
      for_each = var.nameserver != "" ? [1] : []
      content {
        servers = [var.nameserver]
        domain  = var.search_domain
      }
    }
  }

  lifecycle {
    ignore_changes = [
      clone,
    ]
  }
}
