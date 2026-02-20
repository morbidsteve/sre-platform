# Proxmox Lab Environment — State Backend
# Uses local backend — homelab environments typically do not have S3-compatible
# storage available. For shared environments, migrate to an S3 backend.

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}
