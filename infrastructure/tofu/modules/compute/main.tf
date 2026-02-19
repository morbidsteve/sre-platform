# -----------------------------------------------------------------------------
# Compute Module — EC2 instances for the RKE2 cluster
# Creates server (control plane) and agent (worker) node pools with hardened
# security groups and encrypted EBS volumes.
# NIST Controls: CM-6 (Configuration Settings), SC-28 (Protection at Rest)
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# SSH Key Pair
# -----------------------------------------------------------------------------

resource "aws_key_pair" "rke2" {
  key_name   = "sre-${var.environment}-rke2"
  public_key = var.ssh_public_key

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-key"
  })
}

# -----------------------------------------------------------------------------
# Security Groups
# -----------------------------------------------------------------------------

resource "aws_security_group" "server" {
  name_prefix = "sre-${var.environment}-rke2-server-"
  description = "Security group for RKE2 server (control plane) nodes"
  vpc_id      = var.vpc_id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-server-sg"
    Role = "rke2-server"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "agent" {
  name_prefix = "sre-${var.environment}-rke2-agent-"
  description = "Security group for RKE2 agent (worker) nodes"
  vpc_id      = var.vpc_id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-agent-sg"
    Role = "rke2-agent"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# --- Server SG Rules ---

# K8s API from LB and agents
resource "aws_security_group_rule" "server_api" {
  type              = "ingress"
  from_port         = 6443
  to_port           = 6443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.server.id
  description       = "Kubernetes API server"
}

# etcd peer communication (server-to-server)
resource "aws_security_group_rule" "server_etcd" {
  type                     = "ingress"
  from_port                = 2379
  to_port                  = 2380
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.server.id
  security_group_id        = aws_security_group.server.id
  description              = "etcd peer and client"
}

# RKE2 supervisor API (server-to-server)
resource "aws_security_group_rule" "server_supervisor" {
  type                     = "ingress"
  from_port                = 9345
  to_port                  = 9345
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.server.id
  security_group_id        = aws_security_group.server.id
  description              = "RKE2 supervisor API"
}

# RKE2 agent registration (agent-to-server)
resource "aws_security_group_rule" "server_agent_register" {
  type                     = "ingress"
  from_port                = 9345
  to_port                  = 9345
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.agent.id
  security_group_id        = aws_security_group.server.id
  description              = "RKE2 agent registration"
}

# Kubelet (server-to-agent, agent-to-server)
resource "aws_security_group_rule" "server_kubelet_from_agent" {
  type                     = "ingress"
  from_port                = 10250
  to_port                  = 10250
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.agent.id
  security_group_id        = aws_security_group.server.id
  description              = "Kubelet API from agents"
}

# VXLAN overlay (Canal CNI)
resource "aws_security_group_rule" "server_vxlan_from_agent" {
  type                     = "ingress"
  from_port                = 8472
  to_port                  = 8472
  protocol                 = "udp"
  source_security_group_id = aws_security_group.agent.id
  security_group_id        = aws_security_group.server.id
  description              = "VXLAN overlay from agents"
}

resource "aws_security_group_rule" "server_vxlan_from_server" {
  type                     = "ingress"
  from_port                = 8472
  to_port                  = 8472
  protocol                 = "udp"
  source_security_group_id = aws_security_group.server.id
  security_group_id        = aws_security_group.server.id
  description              = "VXLAN overlay from servers"
}

# SSH access (restricted to VPC CIDR)
resource "aws_security_group_rule" "server_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = [data.aws_vpc.current.cidr_block]
  security_group_id = aws_security_group.server.id
  description       = "SSH from within VPC"
}

# All outbound
resource "aws_security_group_rule" "server_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.server.id
  description       = "All outbound traffic"
}

# --- Agent SG Rules ---

# Kubelet (server-to-agent)
resource "aws_security_group_rule" "agent_kubelet" {
  type                     = "ingress"
  from_port                = 10250
  to_port                  = 10250
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.server.id
  security_group_id        = aws_security_group.agent.id
  description              = "Kubelet API from servers"
}

# VXLAN overlay (Canal CNI)
resource "aws_security_group_rule" "agent_vxlan_from_server" {
  type                     = "ingress"
  from_port                = 8472
  to_port                  = 8472
  protocol                 = "udp"
  source_security_group_id = aws_security_group.server.id
  security_group_id        = aws_security_group.agent.id
  description              = "VXLAN overlay from servers"
}

resource "aws_security_group_rule" "agent_vxlan_from_agent" {
  type                     = "ingress"
  from_port                = 8472
  to_port                  = 8472
  protocol                 = "udp"
  source_security_group_id = aws_security_group.agent.id
  security_group_id        = aws_security_group.agent.id
  description              = "VXLAN overlay from agents"
}

# NodePort range (for Istio ingress)
resource "aws_security_group_rule" "agent_nodeport" {
  type              = "ingress"
  from_port         = 30000
  to_port           = 32767
  protocol          = "tcp"
  cidr_blocks       = [data.aws_vpc.current.cidr_block]
  security_group_id = aws_security_group.agent.id
  description       = "NodePort services from within VPC"
}

# SSH access (restricted to VPC CIDR)
resource "aws_security_group_rule" "agent_ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = [data.aws_vpc.current.cidr_block]
  security_group_id = aws_security_group.agent.id
  description       = "SSH from within VPC"
}

# All outbound
resource "aws_security_group_rule" "agent_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.agent.id
  description       = "All outbound traffic"
}

# -----------------------------------------------------------------------------
# Data source — VPC CIDR for internal security group rules
# -----------------------------------------------------------------------------

data "aws_vpc" "current" {
  id = var.vpc_id
}

# -----------------------------------------------------------------------------
# IAM Instance Profile — Minimal permissions for RKE2 nodes
# -----------------------------------------------------------------------------

resource "aws_iam_role" "rke2_node" {
  name = "sre-${var.environment}-rke2-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-node-role"
  })
}

resource "aws_iam_role_policy" "rke2_node" {
  name = "sre-${var.environment}-rke2-node-policy"
  role = aws_iam_role.rke2_node.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeTags",
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "rke2_node" {
  name = "sre-${var.environment}-rke2-node"
  role = aws_iam_role.rke2_node.name

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-node-profile"
  })
}

# -----------------------------------------------------------------------------
# RKE2 Server (Control Plane) Instances
# -----------------------------------------------------------------------------

resource "aws_instance" "server" {
  count = var.server_count

  ami                    = var.ami_id
  instance_type          = var.server_instance_type
  key_name               = aws_key_pair.rke2.key_name
  subnet_id              = var.private_subnet_ids[count.index % length(var.private_subnet_ids)]
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.rke2_node.name

  root_block_device {
    volume_size = var.root_volume_size_gb
    volume_type = var.root_volume_type
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-server-${count.index}"
    Role = "rke2-server"
  })
}

# Register servers with API load balancer target group
resource "aws_lb_target_group_attachment" "server_api" {
  count = var.api_lb_target_group_arn != "" ? var.server_count : 0

  target_group_arn = var.api_lb_target_group_arn
  target_id        = aws_instance.server[count.index].id
  port             = 6443
}

# -----------------------------------------------------------------------------
# RKE2 Agent (Worker) Instances
# -----------------------------------------------------------------------------

resource "aws_instance" "agent" {
  count = var.agent_count

  ami                    = var.ami_id
  instance_type          = var.agent_instance_type
  key_name               = aws_key_pair.rke2.key_name
  subnet_id              = var.private_subnet_ids[count.index % length(var.private_subnet_ids)]
  vpc_security_group_ids = [aws_security_group.agent.id]
  iam_instance_profile   = aws_iam_instance_profile.rke2_node.name

  root_block_device {
    volume_size = var.root_volume_size_gb
    volume_type = var.root_volume_type
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-rke2-agent-${count.index}"
    Role = "rke2-agent"
  })
}

# Register agents with ingress load balancer target group
resource "aws_lb_target_group_attachment" "agent_ingress" {
  count = var.ingress_lb_target_group_arn != "" ? var.agent_count : 0

  target_group_arn = var.ingress_lb_target_group_arn
  target_id        = aws_instance.agent[count.index].id
  port             = 443
}
