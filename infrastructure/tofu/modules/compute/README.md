# Compute Module

Provisions EC2 instances for the RKE2 Kubernetes cluster with separate server (control plane) and agent (worker) node pools. Includes hardened security groups, encrypted EBS volumes, and IMDSv2 enforcement.

## NIST Controls

- **CM-6** (Configuration Settings) — Hardened security groups with least-privilege rules
- **SC-28** (Protection at Rest) — All EBS volumes encrypted
- **AC-6** (Least Privilege) — Minimal IAM permissions for node instance profile

## Resources Created

- SSH key pair for node access
- Security groups for server and agent nodes with RKE2-specific rules
- IAM role, policy, and instance profile for node permissions
- RKE2 server (control plane) EC2 instances
- RKE2 agent (worker) EC2 instances
- LB target group attachments (if target group ARNs provided)

## Security Group Rules

### Server Nodes
- K8s API (6443) — from all (via LB)
- etcd (2379-2380) — server-to-server only
- RKE2 supervisor (9345) — server-to-server and agent-to-server
- Kubelet (10250) — from agents
- VXLAN (8472/udp) — from servers and agents
- SSH (22) — from VPC CIDR only

### Agent Nodes
- Kubelet (10250) — from servers
- VXLAN (8472/udp) — from servers and agents
- NodePort (30000-32767) — from VPC CIDR
- SSH (22) — from VPC CIDR only

## Usage

```hcl
module "compute" {
  source = "../../modules/compute"

  environment        = "dev"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  server_count       = 3
  agent_count        = 3
  ami_id             = "ami-0123456789abcdef0"
  ssh_public_key     = var.ssh_public_key

  api_lb_target_group_arn     = module.load_balancer.api_target_group_arn
  ingress_lb_target_group_arn = module.load_balancer.ingress_target_group_arn

  common_tags = local.common_tags
}
```

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `environment` | string | — | Deployment environment |
| `vpc_id` | string | — | VPC ID for security groups |
| `private_subnet_ids` | list(string) | — | Subnets for instance placement |
| `server_count` | number | `3` | Control plane nodes (must be odd) |
| `agent_count` | number | `3` | Worker nodes |
| `server_instance_type` | string | `m5.xlarge` | Server EC2 type |
| `agent_instance_type` | string | `m5.2xlarge` | Agent EC2 type |
| `ami_id` | string | — | Pre-hardened Rocky Linux 9 AMI |
| `ssh_public_key` | string | — | SSH public key (sensitive) |
| `root_volume_size_gb` | number | `100` | Root volume size |

## Outputs

| Name | Description |
|------|-------------|
| `server_private_ips` | Server node private IPs |
| `agent_private_ips` | Agent node private IPs |
| `server_instance_ids` | Server node EC2 instance IDs |
| `agent_instance_ids` | Agent node EC2 instance IDs |
