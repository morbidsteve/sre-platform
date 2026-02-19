# -----------------------------------------------------------------------------
# Load Balancer Module — Network Load Balancers for the SRE platform
# Creates NLBs for the Kubernetes API (6443) and Istio ingress (80/443).
# NIST Controls: SC-7 (Boundary Protection), AU-2 (Audit Events)
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# K8s API Load Balancer — TCP passthrough to RKE2 server nodes on port 6443
# -----------------------------------------------------------------------------

resource "aws_lb" "api" {
  count = var.enable_api_lb ? 1 : 0

  name               = "sre-${var.environment}-k8s-api"
  internal           = var.api_lb_internal
  load_balancer_type = "network"
  subnets            = var.public_subnet_ids

  enable_cross_zone_load_balancing = true

  dynamic "access_logs" {
    for_each = var.enable_access_logs && var.access_log_bucket != "" ? [1] : []
    content {
      bucket  = var.access_log_bucket
      prefix  = "nlb/api"
      enabled = true
    }
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-k8s-api-nlb"
    Role = "kubernetes-api"
  })
}

resource "aws_lb_target_group" "api" {
  count = var.enable_api_lb ? 1 : 0

  name     = "sre-${var.environment}-k8s-api"
  port     = 6443
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    protocol            = "TCP"
    port                = 6443
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 10
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-k8s-api-tg"
  })
}

resource "aws_lb_listener" "api" {
  count = var.enable_api_lb ? 1 : 0

  load_balancer_arn = aws_lb.api[0].arn
  port              = 6443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-k8s-api-listener"
  })
}

# -----------------------------------------------------------------------------
# Istio Ingress Load Balancer — TCP passthrough to worker nodes
# Ports 80 (HTTP redirect) and 443 (HTTPS/TLS passthrough to Istio gateway)
# -----------------------------------------------------------------------------

resource "aws_lb" "ingress" {
  count = var.enable_ingress_lb ? 1 : 0

  name               = "sre-${var.environment}-ingress"
  internal           = false
  load_balancer_type = "network"
  subnets            = var.public_subnet_ids

  enable_cross_zone_load_balancing = true

  dynamic "access_logs" {
    for_each = var.enable_access_logs && var.access_log_bucket != "" ? [1] : []
    content {
      bucket  = var.access_log_bucket
      prefix  = "nlb/ingress"
      enabled = true
    }
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-ingress-nlb"
    Role = "istio-ingress"
  })
}

resource "aws_lb_target_group" "ingress_https" {
  count = var.enable_ingress_lb ? 1 : 0

  name     = "sre-${var.environment}-ingress-https"
  port     = 443
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    protocol            = "HTTP"
    port                = 15021
    path                = var.health_check_path
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 10
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-ingress-https-tg"
  })
}

resource "aws_lb_target_group" "ingress_http" {
  count = var.enable_ingress_lb ? 1 : 0

  name     = "sre-${var.environment}-ingress-http"
  port     = 80
  protocol = "TCP"
  vpc_id   = var.vpc_id

  health_check {
    protocol            = "HTTP"
    port                = 15021
    path                = var.health_check_path
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 10
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-ingress-http-tg"
  })
}

resource "aws_lb_listener" "ingress_https" {
  count = var.enable_ingress_lb ? 1 : 0

  load_balancer_arn = aws_lb.ingress[0].arn
  port              = 443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress_https[0].arn
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-ingress-https-listener"
  })
}

resource "aws_lb_listener" "ingress_http" {
  count = var.enable_ingress_lb ? 1 : 0

  load_balancer_arn = aws_lb.ingress[0].arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress_http[0].arn
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-ingress-http-listener"
  })
}
