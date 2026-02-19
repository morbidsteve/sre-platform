variable "environment" {
  type        = string
  description = "Deployment environment name (e.g., dev, staging, production)."

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC."
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid CIDR block."
  }
}

variable "availability_zones" {
  type        = list(string)
  description = "List of AWS availability zones to deploy subnets into."

  validation {
    condition     = length(var.availability_zones) >= 1 && length(var.availability_zones) <= 4
    error_message = "Must specify between 1 and 4 availability zones."
  }
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets (one per AZ). Used for NAT gateways and load balancers."

  validation {
    condition     = length(var.public_subnet_cidrs) >= 1
    error_message = "At least one public subnet CIDR is required."
  }
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets (one per AZ). Used for RKE2 nodes."

  validation {
    condition     = length(var.private_subnet_cidrs) >= 1
    error_message = "At least one private subnet CIDR is required."
  }
}

variable "enable_flow_logs" {
  type        = bool
  description = "Enable VPC flow logs for network audit (NIST AU-12). Recommended for all environments."
  default     = true
}

variable "flow_log_retention_days" {
  type        = number
  description = "Number of days to retain VPC flow logs in CloudWatch."
  default     = 90

  validation {
    condition     = var.flow_log_retention_days >= 30
    error_message = "Flow log retention must be at least 30 days for compliance."
  }
}

variable "enable_dns_hostnames" {
  type        = bool
  description = "Enable DNS hostnames in the VPC."
  default     = true
}

variable "enable_dns_support" {
  type        = bool
  description = "Enable DNS support in the VPC."
  default     = true
}

variable "common_tags" {
  type        = map(string)
  description = "Common tags applied to all resources for compliance and cost tracking."
  default     = {}
}
