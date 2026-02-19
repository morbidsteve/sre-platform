# Compute Module

Provisions VM instances for the RKE2 Kubernetes cluster. Creates separate instance groups for control plane (server) nodes and worker (agent) nodes.

## Resources Created

- Control plane VM instances (recommended: 3 for HA)
- Worker VM instances (configurable count)
- Instance profiles / managed identities
- SSH key pairs

## Usage

```hcl
module "compute" {
  source = "../../modules/compute"

  environment    = "dev"
  instance_count = 3
  instance_type  = "m5.xlarge"
  ami_id         = var.hardened_ami_id
  subnet_ids     = module.network.private_subnet_ids
  # ...
}
```
