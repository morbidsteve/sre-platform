#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Bootstrap the OpenTofu remote state backend (S3 + DynamoDB)
# Run this ONCE before the first `tofu init` in any environment.
# -----------------------------------------------------------------------------

set -euo pipefail

BUCKET_NAME="${1:-sre-tofu-state}"
TABLE_NAME="${2:-sre-tofu-locks}"
REGION="${3:-us-east-1}"

echo "=== Bootstrapping OpenTofu State Backend ==="
echo "  Bucket: ${BUCKET_NAME}"
echo "  Table:  ${TABLE_NAME}"
echo "  Region: ${REGION}"
echo ""

# Create S3 bucket for state storage
if aws s3api head-bucket --bucket "${BUCKET_NAME}" 2>/dev/null; then
  echo "Bucket ${BUCKET_NAME} already exists — skipping."
else
  echo "Creating S3 bucket: ${BUCKET_NAME}"
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${REGION}" \
    --create-bucket-configuration LocationConstraint="${REGION}"

  # Enable versioning (for state recovery)
  aws s3api put-bucket-versioning \
    --bucket "${BUCKET_NAME}" \
    --versioning-configuration Status=Enabled

  # Enable server-side encryption
  aws s3api put-bucket-encryption \
    --bucket "${BUCKET_NAME}" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "aws:kms"
        },
        "BucketKeyEnabled": true
      }]
    }'

  # Block public access
  aws s3api put-public-access-block \
    --bucket "${BUCKET_NAME}" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

  echo "Bucket created and secured."
fi

# Create DynamoDB table for state locking
if aws dynamodb describe-table --table-name "${TABLE_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  echo "DynamoDB table ${TABLE_NAME} already exists — skipping."
else
  echo "Creating DynamoDB table: ${TABLE_NAME}"
  aws dynamodb create-table \
    --table-name "${TABLE_NAME}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}" \
    --tags Key=Project,Value=sre-platform Key=ManagedBy,Value=manual

  aws dynamodb wait table-exists --table-name "${TABLE_NAME}" --region "${REGION}"
  echo "DynamoDB table created."
fi

echo ""
echo "=== Backend bootstrap complete ==="
echo "You can now run: cd environments/<env> && tofu init"
