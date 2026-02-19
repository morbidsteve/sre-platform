# Network Module

Provisions the VPC/VNet, subnets, NAT gateway, and security groups for the SRE platform.

## Resources Created

- VPC/VNet with configurable CIDR
- Public subnets (for load balancers and NAT gateways)
- Private subnets (for RKE2 nodes)
- NAT gateway for outbound internet access from private subnets
- VPC flow logs for network audit (NIST AU-12)
- Security groups / NSGs with least-privilege rules

## Usage

```hcl
module "network" {
  source = "../../modules/network"

  environment = "dev"
  vpc_cidr    = "10.0.0.0/16"
  azs         = ["us-east-1a", "us-east-1b", "us-east-1c"]
}
```
