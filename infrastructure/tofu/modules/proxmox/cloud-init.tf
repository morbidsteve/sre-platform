# Proxmox Module — Cloud-Init Configuration
# Generates cloud-init snippets for VM initialization.
# NIST Controls: IA-5 (authenticator management), AC-17 (remote access)

# Cloud-init user-data snippet for all VMs
resource "proxmox_virtual_environment_file" "cloud_init_user_data" {
  content_type = "snippets"
  datastore_id = "local"
  node_name    = var.proxmox_node

  source_raw {
    data = <<-USERDATA
      #cloud-config
      users:
        - name: sre-admin
          groups: wheel
          sudo: ALL=(ALL) NOPASSWD:ALL
          shell: /bin/bash
          lock_passwd: true
          ssh_authorized_keys:
            - ${var.ssh_public_key}
      package_update: false
      package_upgrade: false
      runcmd:
        - systemctl enable --now qemu-guest-agent
    USERDATA

    file_name = "sre-${var.environment}-cloud-init-user.yml"
  }
}
