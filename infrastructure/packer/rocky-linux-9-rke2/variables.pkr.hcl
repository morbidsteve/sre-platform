# Rocky Linux 9 RKE2 Image — Variables
# Extends the base hardened image with RKE2 pre-staged for air-gap support.

# ── Build Metadata ──

variable "image_name" {
  type        = string
  description = "Name for the output image/template."
  default     = "sre-rocky9-rke2"
}

variable "image_version" {
  type        = string
  description = "Semantic version appended to the image name."
  default     = "1.0.0"
}

variable "image_description" {
  type        = string
  description = "Description embedded in the image metadata."
  default     = "Rocky Linux 9 — STIG hardened + RKE2 pre-staged for air-gap deployment"
}

# ── RKE2 Variables ──

variable "rke2_version" {
  type        = string
  description = "RKE2 version to pre-install. Must match the version used in Ansible roles."
  default     = "v1.28.6+rke2r1"
}

variable "rke2_channel" {
  type        = string
  description = "RKE2 release channel."
  default     = "stable"
}

# ── AWS Builder Variables ──

variable "aws_region" {
  type        = string
  description = "AWS region for building and registering the AMI."
  default     = "us-east-1"
}

variable "aws_source_ami_name" {
  type        = string
  description = "Name filter to find the base hardened AMI built by rocky-linux-9-base."
  default     = "sre-rocky9-base-*"
}

variable "aws_source_ami_owners" {
  type        = list(string)
  description = "AWS account IDs that own the base AMI. Use 'self' for same account."
  default     = ["self"]
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

variable "vsphere_source_template" {
  type        = string
  description = "vSphere template name of the base hardened image (from rocky-linux-9-base build)."
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

# ── SSH / Provisioner Variables ──

variable "ssh_username" {
  type        = string
  description = "SSH user for provisioning (inherited from the base image)."
  default     = "packer"
}

variable "ssh_timeout" {
  type        = string
  description = "Timeout waiting for SSH to become available."
  default     = "15m"
}

# ── Air-Gap Image Pre-Pull ──

variable "airgap_images" {
  type        = list(string)
  description = "Container images to pre-pull into the RKE2 image store for air-gap deployments."
  default     = []
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
    Role       = "rke2-node"
  }
}
