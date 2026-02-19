terraform {
  backend "s3" {
    bucket         = "sre-tofu-state"
    key            = "dev/infrastructure.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "sre-tofu-locks"
  }
}
