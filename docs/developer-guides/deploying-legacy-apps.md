# Deploying Legacy Applications

## What Makes an App "Legacy"

The platform defaults to non-root user, read-only filesystem, no special Linux
capabilities, and unprivileged ports only. Applications that need any of the following
are considered "legacy" deployments:

- **Runs as root** (UID 0)
- **Writes to the filesystem** (logs, temp files, runtime config)
- **Binds to ports below 1024** (nginx on 80, Apache on 443)
- **Requires Linux capabilities** (`NET_BIND_SERVICE`, `SYS_PTRACE`, etc.)

The platform provides flags to relax specific constraints per deployment.

## Deploy Script Flags

### `--run-as-root`

Allows the container to run as UID 0. Use when the application fails with
"permission denied" errors or explicitly requires root.

### `--writable-root`

Disables the read-only root filesystem. Use when the application writes to paths
inside the container (logs, temp files, runtime config generation).

### `--add-capability <CAPABILITY>`

Adds a specific Linux capability. The most common use is `NET_BIND_SERVICE`, which
allows binding to ports below 1024. Repeat the flag for multiple capabilities.

### `--persist <path>:<size>`

Attaches persistent writable storage at the specified path. Use when the application
stores data that must survive container restarts.

## Combining Flags

Flags can be combined. Most legacy applications need two or three together.

### Example: WordPress

```bash
./scripts/sre-deploy-app.sh --name wordpress --team team-alpha \
  --chart web-app --image wordpress --tag 6.7-apache \
  --port 80 \
  --run-as-root --writable-root \
  --add-capability NET_BIND_SERVICE \
  --persist /var/www/html:10Gi \
  --env "WORDPRESS_DB_HOST=wordpress-db.team-alpha.svc:3306" \
  --env "WORDPRESS_DB_USER=secret:wordpress-db-user" \
  --env "WORDPRESS_DB_PASSWORD=secret:wordpress-db-pass"
```

### Example: Vendor COTS Software

A typical commercial off-the-shelf application that expects full control of its
environment:

```bash
./scripts/sre-deploy-app.sh --name vendor-erp --team team-alpha \
  --chart web-app --image harbor.apps.sre.example.com/team-alpha/vendor-erp --tag 2024.3 \
  --port 8443 \
  --run-as-root --writable-root \
  --persist /opt/vendor/data:50Gi \
  --persist /opt/vendor/logs:5Gi \
  --env "LICENSE_KEY=secret:vendor-erp-license" \
  --env "DB_CONNECTION=secret:vendor-erp-db-url"
```

## Security Review

Using `--run-as-root`, `--writable-root`, or `--add-capability` relaxes the default
security posture. These flags trigger additional behavior:

- The deployment is tagged with a security exception annotation for auditors.
- Each exception is logged with the deploying user, timestamp, and flags used.
- Platform operators may require justification for production deployments.

The goal is visibility, not blocking. The platform tracks exceptions so the security
team maintains an accurate picture of the cluster's posture.

## Health Check Requirements

Even legacy apps need a health endpoint. Acceptable patterns:

- An HTTP endpoint returning 200 (e.g., `GET /` or `GET /health`)
- A TCP port that accepts connections

Without a health endpoint, the platform defaults to a TCP check on the configured
port. For best results, configure a dedicated health path:

```bash
./scripts/sre-deploy-app.sh --name myapp --team team-alpha \
  --image vendor/app --tag 1.0 \
  --health-path /status --health-port 8080
```
