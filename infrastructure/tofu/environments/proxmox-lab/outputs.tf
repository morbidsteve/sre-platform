# Proxmox Lab Environment — Outputs
# Values for Ansible inventory and operator reference.

output "server_ips" {
  description = "IP addresses of RKE2 server (control plane) nodes. Use for Ansible inventory."
  value       = module.proxmox_cluster.server_ips
}

output "agent_ips" {
  description = "IP addresses of RKE2 agent (worker) nodes. Use for Ansible inventory."
  value       = module.proxmox_cluster.agent_ips
}

output "api_server_endpoint" {
  description = "Kubernetes API server endpoint URL."
  value       = module.proxmox_cluster.api_server_endpoint
}

output "server_vm_ids" {
  description = "Proxmox VM IDs of the server nodes."
  value       = module.proxmox_cluster.server_vm_ids
}

output "agent_vm_ids" {
  description = "Proxmox VM IDs of the agent nodes."
  value       = module.proxmox_cluster.agent_vm_ids
}

output "server_vm_names" {
  description = "Names of the server VMs in Proxmox."
  value       = module.proxmox_cluster.server_vm_names
}

output "agent_vm_names" {
  description = "Names of the agent VMs in Proxmox."
  value       = module.proxmox_cluster.agent_vm_names
}
