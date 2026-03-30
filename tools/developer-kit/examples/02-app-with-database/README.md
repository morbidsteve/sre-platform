# Example 2: App with Database

A web app backed by a PostgreSQL database with SSO authentication.

## What this deploys

- Web container on port 8080 with medium resources
- PostgreSQL database (small: 1 replica, 5Gi storage)
- Keycloak SSO integration for user authentication
- Two environment variables: LOG_LEVEL (plain) and DATABASE_URL (secret)

## Secrets

The `todo-db-creds` secret must be created in the platform vault by your operator before deployment. It will contain the database connection string.

## Try it

```bash
./build-example.sh
```
