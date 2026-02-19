# -----------------------------------------------------------------------------
# VPC Module — Networking foundation for the SRE platform
# Creates VPC, public/private subnets, NAT gateway, and VPC flow logs.
# NIST Controls: SC-7 (Boundary Protection), AU-12 (Audit Generation)
# -----------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = var.enable_dns_hostnames
  enable_dns_support   = var.enable_dns_support

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-vpc"
  })
}

# -----------------------------------------------------------------------------
# Internet Gateway — Required for public subnet internet access
# -----------------------------------------------------------------------------

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-igw"
  })
}

# -----------------------------------------------------------------------------
# Public Subnets — For load balancers and NAT gateways only
# -----------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count = length(var.public_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.public_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  map_public_ip_on_launch = false

  tags = merge(var.common_tags, {
    Name                     = "sre-${var.environment}-public-${var.availability_zones[count.index]}"
    "kubernetes.io/role/elb" = "1"
    Tier                     = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-public-rt"
  })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# -----------------------------------------------------------------------------
# NAT Gateway — Provides outbound internet for private subnets
# Single NAT gateway for dev, one per AZ for production (set via count)
# -----------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count  = var.environment == "production" ? length(var.availability_zones) : 1
  domain = "vpc"

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-nat-eip-${count.index}"
  })
}

resource "aws_nat_gateway" "main" {
  count = var.environment == "production" ? length(var.availability_zones) : 1

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-nat-${count.index}"
  })

  depends_on = [aws_internet_gateway.main]
}

# -----------------------------------------------------------------------------
# Private Subnets — For RKE2 nodes (no direct internet access)
# -----------------------------------------------------------------------------

resource "aws_subnet" "private" {
  count = length(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = merge(var.common_tags, {
    Name                              = "sre-${var.environment}-private-${var.availability_zones[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
    Tier                              = "private"
  })
}

resource "aws_route_table" "private" {
  count = length(var.private_subnet_cidrs)

  vpc_id = aws_vpc.main.id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-private-rt-${count.index}"
  })
}

resource "aws_route" "private_nat" {
  count = length(var.private_subnet_cidrs)

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.environment == "production" ? count.index : 0].id
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# -----------------------------------------------------------------------------
# VPC Flow Logs — Network traffic audit (NIST AU-12, AU-3)
# Captures all traffic for security monitoring and incident response
# -----------------------------------------------------------------------------

resource "aws_flow_log" "main" {
  count = var.enable_flow_logs ? 1 : 0

  iam_role_arn    = aws_iam_role.flow_log[0].arn
  log_destination = aws_cloudwatch_log_group.flow_log[0].arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-flow-log"
  })
}

resource "aws_cloudwatch_log_group" "flow_log" {
  count = var.enable_flow_logs ? 1 : 0

  name              = "/sre/${var.environment}/vpc-flow-logs"
  retention_in_days = var.flow_log_retention_days

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-flow-log-group"
  })
}

resource "aws_iam_role" "flow_log" {
  count = var.enable_flow_logs ? 1 : 0

  name = "sre-${var.environment}-vpc-flow-log"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "vpc-flow-logs.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(var.common_tags, {
    Name = "sre-${var.environment}-vpc-flow-log-role"
  })
}

resource "aws_iam_role_policy" "flow_log" {
  count = var.enable_flow_logs ? 1 : 0

  name = "sre-${var.environment}-vpc-flow-log-policy"
  role = aws_iam_role.flow_log[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}
