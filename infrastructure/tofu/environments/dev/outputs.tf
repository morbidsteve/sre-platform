# -----------------------------------------------------------------------------
# Outputs — Values needed by Ansible and downstream tooling
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID for the dev environment."
  value       = module.vpc.vpc_id
}

output "server_private_ips" {
  description = "Private IPs of RKE2 server nodes (for Ansible inventory)."
  value       = module.compute.server_private_ips
}

output "agent_private_ips" {
  description = "Private IPs of RKE2 agent nodes (for Ansible inventory)."
  value       = module.compute.agent_private_ips
}

output "api_lb_dns" {
  description = "DNS name of the K8s API load balancer (set as server URL in kubeconfig)."
  value       = module.load_balancer.api_lb_dns
}

output "ingress_lb_dns" {
  description = "DNS name of the Istio ingress load balancer (point wildcard DNS here)."
  value       = module.load_balancer.ingress_lb_dns
}

output "nat_gateway_public_ips" {
  description = "NAT gateway public IPs (for firewall allowlisting)."
  value       = module.vpc.nat_gateway_public_ips
}
