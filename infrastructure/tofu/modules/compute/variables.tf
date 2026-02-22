variable "environment" {
  type        = string
  description = "Deployment environment name (e.g., dev, staging, production)."

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "vpc_id" {
  type        = string
  description = "ID of the VPC where instances will be launched."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "List of private subnet IDs for instance placement."

  validation {
    condition     = length(var.private_subnet_ids) >= 1
    error_message = "At least one private subnet ID is required."
  }
}

variable "server_count" {
  type        = number
  description = "Number of RKE2 server (control plane) nodes. Must be odd for etcd quorum."
  default     = 3

  validation {
    condition     = var.server_count >= 1 && var.server_count <= 7 && var.server_count % 2 == 1
    error_message = "Server count must be an odd number between 1 and 7."
  }
}

variable "agent_count" {
  type        = number
  description = "Number of RKE2 agent (worker) nodes."
  default     = 3

  validation {
    condition     = var.agent_count >= 0 && var.agent_count <= 20
    error_message = "Agent count must be between 0 and 20."
  }
}

variable "server_instance_type" {
  type        = string
  description = "EC2 instance type for RKE2 server nodes. Must meet minimum requirements for control plane."
  default     = "m5.xlarge"

  validation {
    condition     = can(regex("^(m5|m6i|r5|r6i)\\.(x|2x|4x)large$", var.server_instance_type))
    error_message = "Server instance type must be m5/m6i/r5/r6i family, xlarge or larger."
  }
}

variable "agent_instance_type" {
  type        = string
  description = "EC2 instance type for RKE2 agent nodes. Must meet minimum requirements for worker workloads."
  default     = "m5.2xlarge"

  validation {
    condition     = can(regex("^(m5|m6i|r5|r6i)\\.(x|2x|4x)large$", var.agent_instance_type))
    error_message = "Agent instance type must be m5/m6i/r5/r6i family, xlarge or larger."
  }
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
  description = "SSH public key for node access. Injected via TF_VAR_ssh_public_key."
  sensitive   = true
}

variable "root_volume_size_gb" {
  type        = number
  description = "Root EBS volume size in GB for all nodes."
  default     = 100

  validation {
    condition     = var.root_volume_size_gb >= 50 && var.root_volume_size_gb <= 500
    error_message = "Root volume size must be between 50 and 500 GB."
  }
}

variable "root_volume_type" {
  type        = string
  description = "EBS volume type for root volumes."
  default     = "gp3"

  validation {
    condition     = contains(["gp3", "io1", "io2"], var.root_volume_type)
    error_message = "Volume type must be gp3, io1, or io2."
  }
}

variable "api_lb_target_group_arn" {
  type        = string
  description = "ARN of the K8s API load balancer target group for server node registration."
  default     = ""
}

variable "ingress_lb_target_group_arn" {
  type        = string
  description = "ARN of the Istio ingress load balancer target group for agent node registration."
  default     = ""
}

variable "common_tags" {
  type        = map(string)
  description = "Common tags applied to all resources for compliance and cost tracking."
  default     = {}
}
