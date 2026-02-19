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
  description = "ID of the VPC where the load balancer will be created."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "List of public subnet IDs for load balancer placement."

  validation {
    condition     = length(var.public_subnet_ids) >= 1
    error_message = "At least one public subnet ID is required."
  }
}

variable "enable_api_lb" {
  type        = bool
  description = "Create the K8s API load balancer (port 6443)."
  default     = true
}

variable "enable_ingress_lb" {
  type        = bool
  description = "Create the Istio ingress load balancer (ports 80/443)."
  default     = true
}

variable "api_lb_internal" {
  type        = bool
  description = "Make the K8s API LB internal (not internet-facing). Set true for production."
  default     = false
}

variable "enable_access_logs" {
  type        = bool
  description = "Enable NLB access logging to S3 (NIST AU-2)."
  default     = true
}

variable "access_log_bucket" {
  type        = string
  description = "S3 bucket name for NLB access logs. Required if enable_access_logs is true."
  default     = ""
}

variable "health_check_path" {
  type        = string
  description = "Health check path for the ingress target group."
  default     = "/healthz/ready"
}

variable "common_tags" {
  type        = map(string)
  description = "Common tags applied to all resources for compliance and cost tracking."
  default     = {}
}
