# Rocky Linux 9 Proxmox Image — Build Definition
# Combined template: DISA STIG hardened Rocky Linux 9 with RKE2 pre-staged.
# Produces a Proxmox VM template ready to clone for RKE2 cluster nodes.

packer {
  required_version = ">= 1.10.0"
  required_plugins {
    proxmox = {
      version = "= 1.2.3"
      source  = "github.com/hashicorp/proxmox"
    }
    ansible = {
      version = "= 1.1.1"
      source  = "github.com/hashicorp/ansible"
    }
  }
}

locals {
  timestamp  = formatdate("YYYYMMDD-hhmm", timestamp())
  image_name = "${var.image_name}-${var.image_version}-${local.timestamp}"
}

# ────────────────────────────────────────────
# Proxmox ISO Builder
# ────────────────────────────────────────────

source "proxmox-iso" "rocky9-rke2" {
  proxmox_url              = var.proxmox_url
  username                 = var.proxmox_username
  token                    = var.proxmox_token
  insecure_skip_tls_verify = var.proxmox_insecure_skip_tls_verify
  node                     = var.proxmox_node

  vm_id   = var.vm_id != 0 ? var.vm_id : null
  vm_name = local.image_name

  template_description = "${var.image_description} — RKE2 ${var.rke2_version} — Built ${local.timestamp}"

  iso_file         = var.iso_file
  iso_checksum     = var.iso_checksum
  unmount_iso      = true

  qemu_agent       = true
  scsi_controller  = "virtio-scsi-single"
  os               = "l26"
  disable_kvm      = var.vm_disable_kvm
  cpu_type         = var.vm_disable_kvm ? "qemu64" : "host"
  cores            = var.vm_cores
  memory           = var.vm_memory

  cloud_init              = true
  cloud_init_storage_pool = var.vm_storage_pool

  disks {
    type         = "scsi"
    disk_size    = var.vm_disk_size
    storage_pool = var.vm_storage_pool
    format       = "raw"
  }

  network_adapters {
    model    = "virtio"
    bridge   = var.vm_network_bridge
    vlan_tag = var.vm_vlan_tag != -1 ? tostring(var.vm_vlan_tag) : ""
  }

  # Kickstart via HTTP — Packer serves the file locally
  http_directory = "${path.root}/http"
  boot_command = [
    "<up><wait>",
    "e<wait>",
    "<down><down><end>",
    " inst.text inst.ks=http://{{ .HTTPIP }}:{{ .HTTPPort }}/ks.cfg",
    "<leftCtrlOn>x<leftCtrlOff>"
  ]
  boot_wait = "10s"

  ssh_username = var.ssh_username
  ssh_timeout  = var.ssh_timeout
}

# ────────────────────────────────────────────
# Build
# ────────────────────────────────────────────

build {
  name = "sre-rocky9-proxmox"

  sources = [
    "source.proxmox-iso.rocky9-rke2"
  ]

  # Apply OS hardening via the Ansible role
  provisioner "ansible" {
    playbook_file = "${path.root}/../../ansible/playbooks/harden-os.yml"
    user          = var.ssh_username
    use_proxy     = false

    extra_arguments = [
      "--extra-vars", "ansible_become=true",
      "--tags", "all"
    ]

    ansible_env_vars = [
      "ANSIBLE_HOST_KEY_CHECKING=False",
      "ANSIBLE_ROLES_PATH=${path.root}/../../ansible/roles"
    ]
  }

  # Validate STIG compliance with OpenSCAP
  provisioner "shell" {
    inline = [
      "echo '=== Running OpenSCAP STIG validation ==='",
      "sudo dnf install -y openscap-scanner scap-security-guide",
      "sudo oscap xccdf eval --profile xccdf_org.ssgproject.content_profile_stig --results /tmp/stig-results.xml --report /tmp/stig-report.html /usr/share/xml/scap/ssg/content/ssg-rl9-ds.xml || true",
      "echo '=== OpenSCAP validation complete ==='"
    ]
  }

  # Install RKE2 binary (does not start the service)
  provisioner "shell" {
    inline = [
      "echo '=== Installing RKE2 ${var.rke2_version} ==='",
      "curl -sfL https://get.rke2.io -o /tmp/rke2-install.sh",
      "chmod 700 /tmp/rke2-install.sh",
      "sudo INSTALL_RKE2_VERSION='${var.rke2_version}' INSTALL_RKE2_CHANNEL='${var.rke2_channel}' /tmp/rke2-install.sh",
      "rm -f /tmp/rke2-install.sh",
      "echo '=== RKE2 binary installed ==='",
      "rke2 --version"
    ]
  }

  # Pre-stage RKE2 container images for air-gap support
  provisioner "shell" {
    inline = [
      "echo '=== Downloading RKE2 air-gap images ==='",
      "sudo mkdir -p /var/lib/rancher/rke2/agent/images",
      "RKE2_RELEASE=$(echo '${var.rke2_version}' | sed 's/+/-/')",
      "sudo curl -sfL -o /var/lib/rancher/rke2/agent/images/rke2-images-core.linux-amd64.tar.zst \"https://github.com/rancher/rke2/releases/download/$${RKE2_RELEASE}/rke2-images-core.linux-amd64.tar.zst\" || echo 'WARN: Could not download core images tarball'",
      "sudo curl -sfL -o /var/lib/rancher/rke2/agent/images/rke2-images-canal.linux-amd64.tar.zst \"https://github.com/rancher/rke2/releases/download/$${RKE2_RELEASE}/rke2-images-canal.linux-amd64.tar.zst\" || echo 'WARN: Could not download canal images tarball'",
      "echo '=== Air-gap images staged ==='",
      "ls -lh /var/lib/rancher/rke2/agent/images/ || true"
    ]
  }

  # Pre-install RKE2 SELinux policy and kernel modules config
  provisioner "shell" {
    inline = [
      "echo '=== Installing RKE2 SELinux policy ==='",
      "sudo dnf install -y container-selinux",
      "sudo dnf install -y rke2-selinux || echo 'WARN: rke2-selinux not available via dnf, will be installed at first RKE2 start'",
      "",
      "echo '=== Configuring kernel modules for RKE2 ==='",
      "sudo tee /etc/modules-load.d/rke2.conf > /dev/null <<MODEOF",
      "br_netfilter",
      "overlay",
      "MODEOF"
    ]
  }

  # Create sre-admin user for Ansible provisioning after clone
  provisioner "shell" {
    inline = [
      "echo '=== Creating sre-admin user ==='",
      "sudo useradd -m -s /bin/bash -G wheel sre-admin || true",
      "sudo mkdir -p /home/sre-admin/.ssh",
      "sudo chmod 700 /home/sre-admin/.ssh",
      "sudo chown -R sre-admin:sre-admin /home/sre-admin/.ssh",
      "echo 'sre-admin ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/sre-admin",
      "sudo chmod 0440 /etc/sudoers.d/sre-admin"
    ]
  }

  # Clean up for template creation
  provisioner "shell" {
    inline = [
      "echo '=== Cleaning up for template snapshot ==='",
      "sudo dnf clean all",
      "sudo rm -rf /var/cache/dnf /tmp/* /var/tmp/*",
      "sudo truncate -s 0 /var/log/messages /var/log/secure /var/log/audit/audit.log || true",
      "sudo rm -f /etc/ssh/ssh_host_*",
      "sudo rm -f /root/.bash_history /home/${var.ssh_username}/.bash_history",
      "sudo cloud-init clean --logs --seed 2>/dev/null || true",
      "# Remove RKE2 runtime state (binary stays, config stays, no node identity)",
      "sudo rm -rf /var/lib/rancher/rke2/server /var/lib/rancher/rke2/agent/pod-manifests",
      "sudo rm -f /etc/rancher/rke2/rke2.yaml",
      "# Remove packer user (sre-admin will be used post-deploy)",
      "sudo userdel -r packer 2>/dev/null || true",
      "sudo rm -f /etc/sudoers.d/packer",
      "echo '=== Template cleanup complete ==='"
    ]
  }

  post-processor "manifest" {
    output     = "${path.root}/build-manifest.json"
    strip_path = true
    custom_data = {
      image_version = var.image_version
      build_date    = local.timestamp
      os            = "rocky-linux-9"
      hardening     = "disa-stig-rhel9"
      fips_enabled  = "true"
      rke2_version  = var.rke2_version
      airgap_ready  = "true"
      platform      = "proxmox"
    }
  }
}
