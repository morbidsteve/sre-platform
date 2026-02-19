# VPC Module

Creates the VPC networking foundation for the SRE platform on AWS. Provisions public and private subnets across multiple availability zones, NAT gateways for outbound internet, and VPC flow logs for network audit compliance.

## NIST Controls

- **SC-7** (Boundary Protection) — Private subnets isolate RKE2 nodes from direct internet access
- **AU-12** (Audit Generation) — VPC flow logs capture all network traffic
- **AU-3** (Content of Audit Records) — Flow logs include source, destination, port, protocol, action

## Resources Created

- VPC with DNS support enabled
- Public subnets (one per AZ) for load balancers and NAT gateways
- Private subnets (one per AZ) for RKE2 nodes
- Internet gateway for public subnet routing
- NAT gateway(s) — single for dev, one per AZ for production
- Route tables for public (internet) and private (NAT) routing
- VPC flow logs to CloudWatch with configurable retention
- IAM role and policy for flow log delivery

## Usage

```hcl
module "vpc" {
  source = "../../modules/vpc"

  environment          = "dev"
  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"]
  enable_flow_logs     = true

  common_tags = {
    Project     = "sre-platform"
    Environment = "dev"
    ManagedBy   = "opentofu"
  }
}
```

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `environment` | string | — | Deployment environment (dev, staging, production) |
| `vpc_cidr` | string | `10.0.0.0/16` | VPC CIDR block |
| `availability_zones` | list(string) | — | AZs for subnet placement |
| `public_subnet_cidrs` | list(string) | — | CIDRs for public subnets |
| `private_subnet_cidrs` | list(string) | — | CIDRs for private subnets |
| `enable_flow_logs` | bool | `true` | Enable VPC flow logs |
| `flow_log_retention_days` | number | `90` | Flow log retention in days |
| `common_tags` | map(string) | `{}` | Tags for all resources |

## Outputs

| Name | Description |
|------|-------------|
| `vpc_id` | VPC ID |
| `public_subnet_ids` | Public subnet IDs |
| `private_subnet_ids` | Private subnet IDs |
| `nat_gateway_public_ips` | NAT gateway public IPs |
