output "server_instance_ids" {
  description = "Instance IDs of RKE2 server (control plane) nodes."
  value       = aws_instance.server[*].id
}

output "server_private_ips" {
  description = "Private IP addresses of RKE2 server nodes."
  value       = aws_instance.server[*].private_ip
}

output "agent_instance_ids" {
  description = "Instance IDs of RKE2 agent (worker) nodes."
  value       = aws_instance.agent[*].id
}

output "agent_private_ips" {
  description = "Private IP addresses of RKE2 agent nodes."
  value       = aws_instance.agent[*].private_ip
}

output "server_security_group_id" {
  description = "Security group ID for RKE2 server nodes."
  value       = aws_security_group.server.id
}

output "agent_security_group_id" {
  description = "Security group ID for RKE2 agent nodes."
  value       = aws_security_group.agent.id
}

output "iam_instance_profile_name" {
  description = "Name of the IAM instance profile attached to all RKE2 nodes."
  value       = aws_iam_instance_profile.rke2_node.name
}

output "ssh_key_name" {
  description = "Name of the SSH key pair created for node access."
  value       = aws_key_pair.rke2.key_name
}
