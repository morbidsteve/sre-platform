# sre-api-service Helm Chart

Standard Helm chart for deploying internal API services on the SRE platform. Extends the web-app template with Istio AuthorizationPolicy for caller restrictions and mTLS peer authentication.

## Resources Created

Everything from `sre-web-app` plus:
- Istio AuthorizationPolicy restricting which services can call this API
- Istio PeerAuthentication for mTLS enforcement

## Usage

```yaml
# values.yaml
app:
  name: my-api
  team: alpha
  image:
    repository: harbor.sre.internal/alpha/my-api
    tag: "v2.1.0"
  port: 8080
  allowedCallers:
    - namespace: alpha
      serviceAccount: my-frontend
```
