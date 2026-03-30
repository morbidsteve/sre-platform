# Example 3: Multi-Container Application

A full-featured order processing service with three containers.

## What this deploys

- **order-api**: Primary web service (port 8080, medium resources)
- **order-worker**: Background job processor (worker, small resources)
- **db-migrate**: Database migration job (runs nightly at 3 AM)
- PostgreSQL database (medium: 2 replicas, 10Gi)
- Redis cache (small: 1Gi)
- External API access to api.stripe.com

## Try it

```bash
./build-example.sh    # Creates dummy tars for all 3 images
```
