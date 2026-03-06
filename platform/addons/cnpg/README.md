# CloudNativePG — Database-as-a-Service

CloudNativePG is a Kubernetes-native PostgreSQL operator that manages the full lifecycle of PostgreSQL clusters.

## What It Provides

- Automated PostgreSQL cluster creation and management
- Continuous backup to S3-compatible storage (via Barman)
- Point-in-time recovery (PITR)
- Automated failover and switchover
- Rolling updates with zero downtime
- Connection pooling via PgBouncer
- Monitoring via Prometheus metrics

## Creating a Database for Your App

Teams create a `Cluster` resource in their namespace:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: my-app-db
  namespace: team-alpha
spec:
  instances: 2
  postgresql:
    parameters:
      shared_buffers: "256MB"
      max_connections: "100"
  storage:
    storageClass: local-path
    size: 10Gi
  monitoring:
    enablePodMonitor: true
  bootstrap:
    initdb:
      database: myapp
      owner: myapp
```

The operator creates:
- A primary PostgreSQL instance
- Read replicas (based on `instances` count)
- A Kubernetes Secret with connection credentials
- ServiceMonitor for Prometheus

## Connecting Your App

The operator creates a secret `<cluster-name>-app` with connection details:

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: my-app-db-app
        key: uri
```

## Backup Configuration

For production, configure continuous backup:

```yaml
spec:
  backup:
    barmanObjectStore:
      destinationPath: "s3://sre-db-backups/team-alpha/my-app-db"
      s3Credentials:
        accessKeyId:
          name: db-backup-s3-creds
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: db-backup-s3-creds
          key: ACCESS_SECRET_KEY
    retentionPolicy: "30d"
```
