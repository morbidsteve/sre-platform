output "vpc_id" {
  description = "ID of the created VPC."
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC."
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "List of public subnet IDs (for load balancers and NAT gateways)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs (for RKE2 nodes)."
  value       = aws_subnet.private[*].id
}

output "public_subnet_cidrs" {
  description = "CIDR blocks of the public subnets."
  value       = aws_subnet.public[*].cidr_block
}

output "private_subnet_cidrs" {
  description = "CIDR blocks of the private subnets."
  value       = aws_subnet.private[*].cidr_block
}

output "nat_gateway_ids" {
  description = "List of NAT gateway IDs."
  value       = aws_nat_gateway.main[*].id
}

output "nat_gateway_public_ips" {
  description = "Public IP addresses of the NAT gateways (for firewall allowlisting)."
  value       = aws_eip.nat[*].public_ip
}

output "internet_gateway_id" {
  description = "ID of the internet gateway."
  value       = aws_internet_gateway.main.id
}

output "flow_log_group_name" {
  description = "CloudWatch log group name for VPC flow logs."
  value       = var.enable_flow_logs ? aws_cloudwatch_log_group.flow_log[0].name : null
}
