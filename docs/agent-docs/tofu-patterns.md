# OpenTofu Patterns for SRE

Read this before creating or modifying anything in `infrastructure/tofu/`.

## Why OpenTofu

SRE uses OpenTofu (not Terraform) because it is MPL 2.0 licensed — fully open-source with no BSL restrictions. OpenTofu is a drop-in replacement; all HCL syntax, provider APIs, and state formats are compatible.

## Directory Structure

```
infrastructure/tofu/
├── modules/                    # Reusable modules (provider-agnostic where possible)
│   ├── compute/                # VM provisioning
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── network/                # VPC/subnets/security groups
│   ├── dns/                    # DNS records
│   ├── load-balancer/          # Load balancer config
│   ├── storage/                # Object storage / block storage
│   └── proxmox/                # Proxmox VE VM provisioning via cloud-init
├── environments/
│   ├── dev/
│   │   ├── main.tf             # Calls modules with dev values
│   │   ├── variables.tf
│   │   ├── terraform.tfvars    # Dev-specific variable values
│   │   ├── backend.tf          # State backend config
│   │   └── versions.tf         # Provider version pins
│   ├── staging/
│   ├── production/
│   └── proxmox-lab/            # On-premises Proxmox VE lab environment
└── scripts/
    └── init-backend.sh         # Bootstrap state backend
```

## Module Conventions

### Every module MUST have

- `main.tf` — resource definitions
- `variables.tf` — all input variables with descriptions, types, and validation
- `outputs.tf` — all outputs with descriptions
- `README.md` — purpose, usage example, required providers

### Variable definitions — always include type, description, and validation

```hcl
variable "instance_count" {
  type        = number
  description = "Number of compute instances to create for the RKE2 cluster."
  default     = 3

  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 10
    error_message = "Instance count must be between 1 and 10."
  }
}

variable "instance_type" {
  type        = string
  description = "Compute instance size. Must meet minimum requirements for RKE2."
  default     = "m5.xlarge"

  validation {
    condition     = can(regex("^(m5|m6i|r5|r6i)\\.(x|2x|4x)large$", var.instance_type))
    error_message = "Instance type must be m5/m6i/r5/r6i family, xlarge or larger."
  }
}
```

### Outputs — always include description

```hcl
output "node_ips" {
  description = "Private IP addresses of provisioned compute nodes."
  value       = aws_instance.rke2_node[*].private_ip
}

output "kubeconfig_path" {
  description = "Path to the generated kubeconfig file."
  value       = local_file.kubeconfig.filename
  sensitive   = true
}
```

## Provider Version Pinning

Pin exact versions in `versions.tf`. Never use `>=` or `~>` in production environments.

```hcl
terraform {
  required_version = "= 1.7.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.31.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "= 4.0.5"
    }
  }
}
```

## State Management

### Backend configuration

Every environment has its own state file. Use S3-compatible backend with encryption and locking:

```hcl
# backend.tf
terraform {
  backend "s3" {
    bucket         = "sre-tofu-state"
    key            = "dev/infrastructure.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "sre-tofu-locks"
  }
}
```

### State rules

- NEVER store state locally in production — always use remote backend
- NEVER commit `.tfstate` files to Git
- State backend (S3 bucket + DynamoDB lock table) is bootstrapped ONCE manually via `scripts/init-backend.sh`
- Each environment (dev/staging/production) has a separate state file
- Use `tofu state list` to inspect, `tofu state mv` to refactor — never edit state files manually

## Sensitive Values

- NEVER put secrets in `.tfvars` files or variable defaults
- Use environment variables: `export TF_VAR_db_password="..."`
- Or use a secrets manager data source to fetch at plan time
- Mark sensitive outputs with `sensitive = true`

```hcl
variable "db_password" {
  type        = string
  description = "Database password, injected via TF_VAR_db_password env var."
  sensitive   = true
}
```

## Tagging Standards

All cloud resources MUST be tagged for compliance and cost tracking:

```hcl
locals {
  common_tags = {
    Project     = "sre-platform"
    Environment = var.environment
    ManagedBy   = "opentofu"
    Owner       = "platform-team"
    CostCenter  = var.cost_center
    Compliance  = "nist-800-53"
  }
}
```

Apply to every resource:

```hcl
resource "aws_instance" "rke2_node" {
  # ...
  tags = merge(local.common_tags, {
    Name = "rke2-node-${count.index}"
    Role = "kubernetes-node"
  })
}
```

## Formatting and Linting

```bash
tofu fmt -recursive          # Auto-format all .tf files
tofu validate                # Syntax and provider validation

# Also run via task
task lint                    # Includes tofu fmt check
task infra-plan              # tofu plan with var file
task infra-apply             # tofu apply with approval
```

## Common Mistakes

- Using `>=` or `~>` for provider versions — pin exact versions
- Storing state locally — always use remote backend with encryption and locking
- Hardcoding values instead of using variables — everything configurable goes in variables.tf
- Missing variable validation blocks — catch bad input early
- Missing output descriptions — outputs are documentation for consumers
- Committing `.tfvars` files with secrets — use env vars or secrets manager
- Creating resources without tags — breaks compliance and cost tracking
- Not running `tofu fmt` before committing — the hook should catch this, but check anyway
- Forgetting `sensitive = true` on secret outputs — they will appear in logs
