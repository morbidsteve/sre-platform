output "api_lb_dns" {
  description = "DNS name of the K8s API load balancer."
  value       = var.enable_api_lb ? aws_lb.api[0].dns_name : null
}

output "api_lb_arn" {
  description = "ARN of the K8s API load balancer."
  value       = var.enable_api_lb ? aws_lb.api[0].arn : null
}

output "api_lb_zone_id" {
  description = "Route53 zone ID of the K8s API load balancer (for DNS alias records)."
  value       = var.enable_api_lb ? aws_lb.api[0].zone_id : null
}

output "api_target_group_arn" {
  description = "ARN of the K8s API target group (for registering server nodes)."
  value       = var.enable_api_lb ? aws_lb_target_group.api[0].arn : null
}

output "ingress_lb_dns" {
  description = "DNS name of the Istio ingress load balancer."
  value       = var.enable_ingress_lb ? aws_lb.ingress[0].dns_name : null
}

output "ingress_lb_arn" {
  description = "ARN of the Istio ingress load balancer."
  value       = var.enable_ingress_lb ? aws_lb.ingress[0].arn : null
}

output "ingress_lb_zone_id" {
  description = "Route53 zone ID of the ingress load balancer (for DNS alias records)."
  value       = var.enable_ingress_lb ? aws_lb.ingress[0].zone_id : null
}

output "ingress_https_target_group_arn" {
  description = "ARN of the HTTPS ingress target group (for registering agent nodes)."
  value       = var.enable_ingress_lb ? aws_lb_target_group.ingress_https[0].arn : null
}

output "ingress_http_target_group_arn" {
  description = "ARN of the HTTP ingress target group (for registering agent nodes)."
  value       = var.enable_ingress_lb ? aws_lb_target_group.ingress_http[0].arn : null
}
