# Proxmox Module — Outputs
# Values consumed by Ansible inventory and downstream automation.

output "server_ips" {
  description = "IP addresses of RKE2 server (control plane) nodes. Use for Ansible inventory and kubeconfig."
  value       = proxmox_virtual_environment_vm.server[*].ipv4_addresses[1][0]
}

output "agent_ips" {
  description = "IP addresses of RKE2 agent (worker) nodes. Use for Ansible inventory."
  value       = proxmox_virtual_environment_vm.agent[*].ipv4_addresses[1][0]
}

output "api_server_endpoint" {
  description = "Kubernetes API server endpoint. Points to the first server node. For HA, place a load balancer in front of all server nodes."
  value       = "https://${proxmox_virtual_environment_vm.server[0].ipv4_addresses[1][0]}:6443"
}

output "server_vm_ids" {
  description = "Proxmox VM IDs of the server nodes."
  value       = proxmox_virtual_environment_vm.server[*].vm_id
}

output "agent_vm_ids" {
  description = "Proxmox VM IDs of the agent nodes."
  value       = proxmox_virtual_environment_vm.agent[*].vm_id
}

output "server_vm_names" {
  description = "Names of the server VMs in Proxmox."
  value       = proxmox_virtual_environment_vm.server[*].name
}

output "agent_vm_names" {
  description = "Names of the agent VMs in Proxmox."
  value       = proxmox_virtual_environment_vm.agent[*].name
}
