# Rocky Linux 9 Base Image — Variables
# Shared variables for both AWS and vSphere builders.

# ── Build Metadata ──

variable "image_name" {
  type        = string
  description = "Name for the output image/template."
  default     = "sre-rocky9-base"
}

variable "image_version" {
  type        = string
  description = "Semantic version appended to the image name."
  default     = "1.0.0"
}

variable "image_description" {
  type        = string
  description = "Description embedded in the image metadata."
  default     = "Rocky Linux 9 — DISA STIG hardened, FIPS enabled, CIS Level 2"
}

# ── AWS Builder Variables ──

variable "aws_region" {
  type        = string
  description = "AWS region for building and registering the AMI."
  default     = "us-east-1"
}

variable "aws_source_ami_filter_name" {
  type        = string
  description = "Name filter for the Rocky Linux 9 source AMI."
  default     = "Rocky-9-EC2-Base-9.3-*"
}

variable "aws_source_ami_owners" {
  type        = list(string)
  description = "AWS account IDs that own the source AMI."
  default     = ["792107900819"] # Rocky Linux official
}

variable "aws_instance_type" {
  type        = string
  description = "EC2 instance type used during the build."
  default     = "m5.large"
}

variable "aws_vpc_id" {
  type        = string
  description = "VPC ID for the build instance. Empty uses the default VPC."
  default     = ""
}

variable "aws_subnet_id" {
  type        = string
  description = "Subnet ID for the build instance. Empty uses the default subnet."
  default     = ""
}

variable "aws_ami_regions" {
  type        = list(string)
  description = "Additional regions to copy the AMI to after build."
  default     = []
}

variable "aws_encrypt_boot" {
  type        = bool
  description = "Encrypt the AMI root volume with the default EBS key."
  default     = true
}

# ── vSphere Builder Variables ──

variable "vsphere_server" {
  type        = string
  description = "vCenter Server FQDN or IP address."
  default     = ""
}

variable "vsphere_username" {
  type        = string
  description = "vCenter SSO username."
  default     = ""
  sensitive   = true
}

variable "vsphere_password" {
  type        = string
  description = "vCenter SSO password."
  default     = ""
  sensitive   = true
}

variable "vsphere_datacenter" {
  type        = string
  description = "vSphere datacenter name."
  default     = ""
}

variable "vsphere_cluster" {
  type        = string
  description = "vSphere compute cluster name."
  default     = ""
}

variable "vsphere_datastore" {
  type        = string
  description = "vSphere datastore for the VM template."
  default     = ""
}

variable "vsphere_network" {
  type        = string
  description = "vSphere port group / network name."
  default     = ""
}

variable "vsphere_folder" {
  type        = string
  description = "vSphere VM folder for the template."
  default     = "Templates/SRE"
}

variable "vsphere_iso_path" {
  type        = string
  description = "Datastore path to the Rocky Linux 9 ISO."
  default     = ""
}

variable "vsphere_vm_cpus" {
  type        = number
  description = "Number of vCPUs for the build VM."
  default     = 2
}

variable "vsphere_vm_memory" {
  type        = number
  description = "Memory in MB for the build VM."
  default     = 4096
}

variable "vsphere_vm_disk_size" {
  type        = number
  description = "Root disk size in MB for the build VM."
  default     = 40960
}

# ── SSH / Provisioner Variables ──

variable "ssh_username" {
  type        = string
  description = "SSH user created by the kickstart / cloud-init for provisioning."
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
  description = "Tags applied to all output images for compliance and cost tracking."
  default = {
    Project    = "sre-platform"
    ManagedBy  = "packer"
    Compliance = "nist-800-53"
    Hardening  = "disa-stig-rhel9"
    OS         = "rocky-linux-9"
  }
}
