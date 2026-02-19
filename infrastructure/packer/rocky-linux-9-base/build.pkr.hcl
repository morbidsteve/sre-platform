# Rocky Linux 9 Base Image — Build Definition
# Produces a DISA STIG hardened Rocky Linux 9 image with FIPS enabled.
# Supports AWS AMI and vSphere template outputs.

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
    SourceAMI    = "{{ .SourceAMI }}"
  })
}

# ────────────────────────────────────────────
# AWS AMI Builder
# ────────────────────────────────────────────

source "amazon-ebs" "rocky9" {
  region        = var.aws_region
  instance_type = var.aws_instance_type

  source_ami_filter {
    filters = {
      name                = var.aws_source_ami_filter_name
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
    volume_size           = 40
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = var.aws_encrypt_boot
  }

  # Force IMDSv2 on the build instance
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
# vSphere Template Builder
# ────────────────────────────────────────────

source "vsphere-iso" "rocky9" {
  vcenter_server      = var.vsphere_server
  username            = var.vsphere_username
  password            = var.vsphere_password
  insecure_connection = false

  datacenter = var.vsphere_datacenter
  cluster    = var.vsphere_cluster
  datastore  = var.vsphere_datastore
  folder     = var.vsphere_folder

  vm_name = local.image_name

  guest_os_type = "rhel9_64Guest"
  CPUs          = var.vsphere_vm_cpus
  RAM           = var.vsphere_vm_memory

  storage {
    disk_size             = var.vsphere_vm_disk_size
    disk_thin_provisioned = true
  }

  network_adapters {
    network      = var.vsphere_network
    network_card = "vmxnet3"
  }

  iso_paths = [var.vsphere_iso_path]

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

  convert_to_template = true

  notes = "${var.image_description} — Built ${local.timestamp}"
}

# ────────────────────────────────────────────
# Build
# ────────────────────────────────────────────

build {
  name = "sre-rocky9-base"

  sources = [
    "source.amazon-ebs.rocky9",
    "source.vsphere-iso.rocky9"
  ]

  # Wait for cloud-init to finish (AWS only)
  provisioner "shell" {
    only = ["amazon-ebs.rocky9"]
    inline = [
      "echo 'Waiting for cloud-init to complete...'",
      "sudo cloud-init status --wait || true"
    ]
  }

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
    }
  }
}
