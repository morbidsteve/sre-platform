variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "ami_id" {
  type        = string
  description = "AMI ID for the pre-hardened Rocky Linux 9 image (built by Packer)."

  validation {
    condition     = can(regex("^ami-[a-f0-9]{8,17}$", var.ami_id))
    error_message = "ami_id must be a valid AWS AMI ID (ami-xxxxxxxxx)."
  }
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key for RKE2 node access. Set via TF_VAR_ssh_public_key."
  sensitive   = true
}

variable "cost_center" {
  type        = string
  description = "Cost center tag for billing allocation."
  default     = "platform-engineering"
}
