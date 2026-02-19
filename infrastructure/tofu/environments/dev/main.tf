# -----------------------------------------------------------------------------
# SRE Platform — Dev Environment
# Composes VPC, Compute, and Load Balancer modules for the dev cluster.
# -----------------------------------------------------------------------------

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  environment = "dev"

  common_tags = {
    Project     = "sre-platform"
    Environment = local.environment
    ManagedBy   = "opentofu"
    Owner       = "platform-team"
    CostCenter  = var.cost_center
    Compliance  = "nist-800-53"
  }
}

# -----------------------------------------------------------------------------
# VPC — Networking foundation
# -----------------------------------------------------------------------------

module "vpc" {
  source = "../../modules/vpc"

  environment          = local.environment
  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"]
  enable_flow_logs     = true

  common_tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Load Balancers — K8s API and Istio Ingress
# Created before compute so target group ARNs can be passed to instances.
# -----------------------------------------------------------------------------

module "load_balancer" {
  source = "../../modules/load-balancer"

  environment       = local.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids

  enable_access_logs = false # Disabled in dev (no access log bucket)
  api_lb_internal    = false

  common_tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Compute — RKE2 server and agent nodes
# Dev uses minimal node counts: 1 server, 2 agents
# -----------------------------------------------------------------------------

module "compute" {
  source = "../../modules/compute"

  environment        = local.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids

  server_count         = 1
  agent_count          = 2
  server_instance_type = "m5.xlarge"
  agent_instance_type  = "m5.xlarge"
  ami_id               = var.ami_id
  ssh_public_key       = var.ssh_public_key
  root_volume_size_gb  = 100

  api_lb_target_group_arn     = module.load_balancer.api_target_group_arn
  ingress_lb_target_group_arn = module.load_balancer.ingress_https_target_group_arn

  common_tags = local.common_tags
}
