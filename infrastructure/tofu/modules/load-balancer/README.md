# Load Balancer Module

Provisions AWS Network Load Balancers (NLBs) for the SRE platform. Creates two load balancers: one for the Kubernetes API (port 6443) and one for Istio ingress (ports 80/443).

## NIST Controls

- **SC-7** (Boundary Protection) — NLBs serve as the controlled entry points to the cluster
- **AU-2** (Audit Events) — NLB access logs capture all connection metadata

## Resources Created

### K8s API Load Balancer
- Network Load Balancer (TCP passthrough on port 6443)
- Target group for RKE2 server nodes
- TCP health check on port 6443

### Istio Ingress Load Balancer
- Network Load Balancer (TCP passthrough on ports 80 and 443)
- HTTPS target group (port 443) with Istio health check on port 15021
- HTTP target group (port 80) with Istio health check on port 15021
- Access logging to S3 (optional)

## Usage

```hcl
module "load_balancer" {
  source = "../../modules/load-balancer"

  environment       = "dev"
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids

  enable_access_logs = true
  access_log_bucket  = "sre-dev-lb-access-logs"

  common_tags = local.common_tags
}
```

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `environment` | string | — | Deployment environment |
| `vpc_id` | string | — | VPC for target groups |
| `public_subnet_ids` | list(string) | — | Subnets for LB placement |
| `enable_api_lb` | bool | `true` | Create K8s API LB |
| `enable_ingress_lb` | bool | `true` | Create Istio ingress LB |
| `api_lb_internal` | bool | `false` | Make API LB internal |
| `enable_access_logs` | bool | `true` | Enable NLB access logging |
| `access_log_bucket` | string | `""` | S3 bucket for access logs |

## Outputs

| Name | Description |
|------|-------------|
| `api_lb_dns` | API LB DNS name |
| `api_target_group_arn` | API target group ARN (for compute module) |
| `ingress_lb_dns` | Ingress LB DNS name |
| `ingress_https_target_group_arn` | HTTPS target group ARN (for compute module) |
