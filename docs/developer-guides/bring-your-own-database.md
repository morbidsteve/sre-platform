# Bring Your Own Database

## What the Platform Provides

The SRE Platform includes two managed data services:

- **PostgreSQL** -- powered by CloudNativePG. Enable with `--database` when deploying.
  The platform handles provisioning, connection strings, credentials, and backups.
- **Redis** -- enable with `--redis` when deploying. Used for caching, sessions, and
  simple message queues.

If your application uses PostgreSQL or Redis, you do not need this guide. Use the
built-in services.

## When You Need Something Else

Applications that require MySQL, MongoDB, MariaDB, Elasticsearch, or other data stores
have two options:

1. **Deploy alongside your app** as a standalone container in the same namespace
2. **Connect to an external service** (managed database, existing on-prem instance)

## Option 1: Standalone Database Deployment

Deploy the database as a worker chart with persistence. The worker chart runs a
long-lived process with no inbound traffic restrictions within the namespace.

### MySQL Example

```bash
./scripts/sre-deploy-app.sh --name myapp-mysql --team team-alpha \
  --chart worker --image mysql --tag 8.0 \
  --port 3306 \
  --run-as-root --writable-root \
  --persist /var/lib/mysql:10Gi \
  --env "MYSQL_ROOT_PASSWORD=secret:myapp-mysql-root" \
  --env "MYSQL_DATABASE=myapp" \
  --env "MYSQL_USER=secret:myapp-mysql-user" \
  --env "MYSQL_PASSWORD=secret:myapp-mysql-pass"
```

### MongoDB Example

```bash
./scripts/sre-deploy-app.sh --name myapp-mongo --team team-alpha \
  --chart worker --image mongo --tag 7.0 \
  --port 27017 \
  --run-as-root --writable-root \
  --persist /data/db:20Gi \
  --env "MONGO_INITDB_ROOT_USERNAME=secret:myapp-mongo-user" \
  --env "MONGO_INITDB_ROOT_PASSWORD=secret:myapp-mongo-pass"
```

## Connecting Your App to the Database

Once the database is deployed, your application connects using the service DNS name
within the namespace:

| Database | Connection String |
|---|---|
| MySQL | `mysql://user:pass@myapp-mysql.team-alpha.svc:3306/myapp` |
| MongoDB | `mongodb://user:pass@myapp-mongo.team-alpha.svc:27017/myapp` |

Pass the connection string as an environment variable when deploying your application:

```bash
./scripts/sre-deploy-app.sh --name myapp-api --team team-alpha \
  --chart api-service --image myapp/api --tag v1.0 \
  --port 8080 \
  --env "DATABASE_URL=secret:myapp-db-connection-string"
```

Within the same namespace, you can use the short form `myapp-mysql:3306` without
the full `.team-alpha.svc` suffix.

## Option 2: External Database

If your database is hosted outside the cluster (AWS RDS, Azure Database, an existing
on-prem server), pass the connection details as environment variables:

```bash
./scripts/sre-deploy-app.sh --name myapp-api --team team-alpha \
  --chart api-service --image myapp/api --tag v1.0 \
  --port 8080 \
  --env "DATABASE_URL=secret:myapp-external-db-url"
```

Store the external connection string as a secret in OpenBao. A platform operator
may need to configure network egress rules if the external database is outside the
cluster network.

## Credentials and Secrets

Database passwords should never be passed as plain-text environment variables. Store
them in OpenBao and reference them with the `secret:` prefix:

```bash
--env "MYSQL_ROOT_PASSWORD=secret:myapp-mysql-root"
```

The platform injects the secret value at container startup. Your application reads it
as a normal environment variable.

## Backup Considerations

Standalone databases deployed via the worker chart are **not** automatically backed up.
The platform's built-in backup covers PostgreSQL (managed by CloudNativePG) and cluster
state, but it does not know about your MySQL or MongoDB data.

You are responsible for backups. Options:

- **Velero**: The platform's backup tool can snapshot persistent volumes on a schedule.
  Ask a platform operator to add your database's volume to the backup schedule.
- **Application-level backup**: Run `mysqldump` or `mongodump` as a cronjob deployment
  and store the output in object storage.
- **Replication**: For production workloads, consider running a replica set and
  backing up from the secondary.

For critical data, do not rely on a single backup method. Combine volume snapshots
with application-level dumps.
