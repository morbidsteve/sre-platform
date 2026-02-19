# Rocky Linux 9 RKE2 Image — Build Definition
# Extends the base hardened image with RKE2 binaries and container images
# pre-staged for air-gap deployment support.

packer {
  required_version = ">= 1.10.0"
  required_plugins {
    amazon = {
      version = "= 1.3.3"
      source  = "github.com/hashicorp/amazon"
    }
    vsphere = {
      version = "= 1.3.0"
      source  = "github.com/hashicorp/vsphere"
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

  aws_tags = merge(var.common_tags, {
    Name         = local.image_name
    ImageVersion = var.image_version
    BuildDate    = local.timestamp
    RKE2Version  = var.rke2_version
    SourceAMI    = "{{ .SourceAMI }}"
  })
}

# ────────────────────────────────────────────
# AWS AMI Builder — from base hardened AMI
# ────────────────────────────────────────────

source "amazon-ebs" "rocky9-rke2" {
  region        = var.aws_region
  instance_type = var.aws_instance_type

  source_ami_filter {
    filters = {
      name                = var.aws_source_ami_name
      root-device-type    = "ebs"
      virtualization-type = "hvm"
      architecture        = "x86_64"
    }
    most_recent = true
    owners      = var.aws_source_ami_owners
  }

  vpc_id    = var.aws_vpc_id != "" ? var.aws_vpc_id : null
  subnet_id = var.aws_subnet_id != "" ? var.aws_subnet_id : null

  ami_name        = local.image_name
  ami_description = var.image_description
  ami_regions     = var.aws_ami_regions
  encrypt_boot    = var.aws_encrypt_boot

  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 60
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = var.aws_encrypt_boot
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  ssh_username = var.ssh_username
  ssh_timeout  = var.ssh_timeout

  tags = local.aws_tags
  run_tags = merge(var.common_tags, {
    Name = "packer-build-${local.image_name}"
  })
}

# ────────────────────────────────────────────
# vSphere Template Builder — from base template
# ────────────────────────────────────────────

source "vsphere-clone" "rocky9-rke2" {
  vcenter_server      = var.vsphere_server
  username            = var.vsphere_username
  password            = var.vsphere_password
  insecure_connection = false

  datacenter = var.vsphere_datacenter
  cluster    = var.vsphere_cluster
  datastore  = var.vsphere_datastore
  folder     = var.vsphere_folder

  template = var.vsphere_source_template
  vm_name  = local.image_name

  CPUs = var.vsphere_vm_cpus
  RAM  = var.vsphere_vm_memory

  network_adapters {
    network      = var.vsphere_network
    network_card = "vmxnet3"
  }

  ssh_username = var.ssh_username
  ssh_timeout  = var.ssh_timeout

  convert_to_template = true

  notes = "${var.image_description} — RKE2 ${var.rke2_version} — Built ${local.timestamp}"
}

# ────────────────────────────────────────────
# Build
# ────────────────────────────────────────────

build {
  name = "sre-rocky9-rke2"

  sources = [
    "source.amazon-ebs.rocky9-rke2",
    "source.vsphere-clone.rocky9-rke2"
  ]

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

  # Pre-install RKE2 SELinux policy package
  provisioner "shell" {
    inline = [
      "echo '=== Installing RKE2 SELinux policy ==='",
      "sudo dnf install -y container-selinux",
      "sudo dnf install -y rke2-selinux || echo 'WARN: rke2-selinux not available via dnf, will be installed at first RKE2 start'"
    ]
  }

  # Install prerequisite kernel modules config
  provisioner "shell" {
    inline = [
      "echo '=== Configuring kernel modules for RKE2 ==='",
      "sudo tee /etc/modules-load.d/rke2.conf > /dev/null <<MODEOF",
      "br_netfilter",
      "overlay",
      "MODEOF",
      "echo '=== Kernel module config written ==='"
    ]
  }

  # Clean up for image creation
  provisioner "shell" {
    inline = [
      "echo '=== Cleaning up for image snapshot ==='",
      "sudo dnf clean all",
      "sudo rm -rf /var/cache/dnf /tmp/* /var/tmp/*",
      "sudo truncate -s 0 /var/log/messages /var/log/secure /var/log/audit/audit.log || true",
      "sudo rm -f /etc/ssh/ssh_host_*",
      "sudo rm -f /root/.bash_history /home/${var.ssh_username}/.bash_history",
      "sudo cloud-init clean --logs --seed 2>/dev/null || true",
      "# Remove any RKE2 runtime state (binary stays, config stays, no node identity)",
      "sudo rm -rf /var/lib/rancher/rke2/server /var/lib/rancher/rke2/agent/pod-manifests",
      "sudo rm -f /etc/rancher/rke2/rke2.yaml",
      "echo '=== Image cleanup complete ==='"
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
    }
  }
}
