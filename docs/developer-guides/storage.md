# Object Storage

## Overview

S3-compatible object storage for your application. When you enable storage, the platform:

- Provisions credentials from OpenBao and syncs them via External Secrets Operator
- Creates a ConfigMap with endpoint, bucket, and region configuration
- Injects all storage environment variables into your container automatically

Available in web-app, api-service, and worker chart types.

---

## How to Enable

### Via App Contract

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: my-app
  team: team-alpha
spec:
  type: web-app
  image: harbor.sre.internal/team-alpha/my-app:v1.0.0
  resources: small
  ingress: my-app.apps.sre.example.com
  services:
    storage:
      enabled: true
```

### Via Helm Values

```yaml
storage:
  enabled: true
```

---

## Environment Variables

When storage is enabled, these environment variables are available in your container:

| Variable | Source | Description |
|----------|--------|-------------|
| `AWS_ACCESS_KEY_ID` | Secret (OpenBao) | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | Secret (OpenBao) | S3 secret key |
| `STORAGE_ENDPOINT` | ConfigMap | S3 endpoint URL (default: `https://minio.sre.internal`) |
| `STORAGE_BUCKET` | ConfigMap | Bucket name (default: `<team>-<app-name>`) |
| `STORAGE_REGION` | ConfigMap | Region (default: `us-east-1`) |
| `STORAGE_USE_SSL` | ConfigMap | Always `true` |

The `AWS_*` variables use the standard naming that most S3 SDKs recognize automatically.

---

## Prerequisites

Before enabling storage, an admin must provision the credentials in OpenBao:

```bash
bao kv put sre/team-alpha/storage/my-app \
  access_key_id="AKIAIOSFODNN7EXAMPLE" \
  secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

The OpenBao path is: `sre/<team>/storage/<app-name>`

For MinIO (dev/staging), create the bucket:

```bash
mc alias set sre https://minio.sre.internal ADMIN_KEY ADMIN_SECRET
mc mb sre/team-alpha-my-app
mc admin user add sre AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
mc admin policy attach sre readwrite --user AKIAIOSFODNN7EXAMPLE
```

---

## Code Examples

### Node.js (using @aws-sdk/client-s3)

```javascript
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
  forcePathStyle: true, // Required for MinIO
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload a file
await s3.send(new PutObjectCommand({
  Bucket: process.env.STORAGE_BUCKET,
  Key: 'uploads/photo.jpg',
  Body: fileBuffer,
  ContentType: 'image/jpeg',
}));

// Download a file
const response = await s3.send(new GetObjectCommand({
  Bucket: process.env.STORAGE_BUCKET,
  Key: 'uploads/photo.jpg',
}));
const body = await response.Body.transformToByteArray();
```

### Python (using boto3)

```python
import os
import boto3

s3 = boto3.client(
    's3',
    endpoint_url=os.environ['STORAGE_ENDPOINT'],
    region_name=os.environ['STORAGE_REGION'],
    aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
)

# Upload a file
s3.upload_file('local-file.txt', os.environ['STORAGE_BUCKET'], 'remote-file.txt')

# Download a file
s3.download_file(os.environ['STORAGE_BUCKET'], 'remote-file.txt', 'local-file.txt')

# List objects
response = s3.list_objects_v2(Bucket=os.environ['STORAGE_BUCKET'], Prefix='uploads/')
for obj in response.get('Contents', []):
    print(obj['Key'], obj['Size'])
```

---

## Custom Configuration

Override defaults for production or custom buckets:

```yaml
storage:
  enabled: true
  bucket: "my-custom-bucket"
  endpoint: "https://s3.us-east-1.amazonaws.com"
  region: "us-east-1"
```

| Setting | Default | When to override |
|---------|---------|------------------|
| `bucket` | `<team>-<app-name>` | Shared buckets, legacy bucket names |
| `endpoint` | `https://minio.sre.internal` | Production AWS S3, different MinIO instance |
| `region` | `us-east-1` | Non-default AWS region |

---

## What Gets Created

When storage is enabled, the Helm chart generates:

- **ExternalSecret** (`<app>-storage-creds`): Syncs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from OpenBao path `sre/<team>/storage/<app-name>`
- **ConfigMap** (`<app>-storage-config`): Contains `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_USE_SSL`
- **Env vars**: Credentials injected via `secretKeyRef`, config injected via `envFrom` on the ConfigMap

---

## Troubleshooting

### "Access Denied" when accessing the bucket

- Check that OpenBao has credentials at `sre/<team>/storage/<app-name>`
- Verify the ExternalSecret synced: `kubectl get externalsecret <app>-storage-creds -n <team>`
- Check the MinIO user has the right policy attached

### "No such bucket" error

- The platform does not auto-create buckets. Ask your admin to create it.
- Default bucket name is `<team>-<app-name>`. If you set a custom name, make sure it exists.

### Connection timeout to storage endpoint

- If using the default MinIO endpoint, ensure your namespace has egress NetworkPolicy rules allowing it.
- The sre-lib network policy template already allows HTTPS egress to `0.0.0.0/0`.

### Env vars not available

- Check the ExternalSecret status: `kubectl get externalsecret -n <team>`
- Check the ConfigMap exists: `kubectl get cm <app>-storage-config -n <team>`
- Verify `storage.enabled: true` in your Helm values
