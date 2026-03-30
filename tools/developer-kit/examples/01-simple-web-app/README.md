# Example 1: Simple Web App

The simplest possible bundle — a web application with no dependencies.

## What this deploys

- A single web container listening on port 3000
- External ingress at hello-web.apps.sre.example.com
- Small resource allocation (100m CPU, 128Mi memory)
- No database, no cache, no SSO

## Try it

```bash
./build-example.sh    # Creates a dummy image tar
cd ..
tar czf hello-web-v1.0.0.bundle.tar.gz -C 01-simple-web-app bundle.yaml images/
```

Replace the dummy image with your real one:
```bash
docker save my-web-app:v1.0.0 -o images/hello-web.tar
```
