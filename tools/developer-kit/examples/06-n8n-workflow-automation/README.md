# n8n — Workflow Automation Platform

Deploys [n8n](https://n8n.io) as a self-hosted workflow automation tool using the `sre-web-app` Helm template.

## What This Demonstrates

- Deploying an app that **requires root** (Kyverno policy exception needed)
- Using a **non-standard port** (5678)
- Relaxing `readOnlyRootFilesystem` for apps that write to disk
- `startupProbe` for slow-starting Node.js apps
- Persistent volume for workflow data

## Key Config Choices

| Setting | Value | Why |
|---------|-------|-----|
| `runAsNonRoot` | `false` | n8n's internal process manager requires root |
| `readOnlyRootFilesystem` | `false` | n8n writes workflow data and temp files |
| `startupProbe` | `true`, 30 retries | n8n takes 30-60s to start |
| `persistence.mountPath` | `/root/.n8n` | n8n default data directory |
| `port` | `5678` | n8n default |

## Kyverno Policy Exception

n8n requires root, so you'll need a policy exception:

```yaml
apiVersion: kyverno.io/v2
kind: PolicyException
metadata:
  name: n8n-policy-exception
  namespace: YOUR_NAMESPACE
spec:
  exceptions:
    - policyName: require-security-context
      ruleNames:
        - require-run-as-non-root
  match:
    any:
      - resources:
          kinds: [Pod]
          namespaces: [YOUR_NAMESPACE]
          names: ["n8n-*"]
```

## Deploy

```bash
# Mirror the image to Harbor first
docker pull n8nio/n8n:1.64.0
docker tag n8nio/n8n:1.64.0 harbor.apps.sre.example.com/<team>/n8n:v1.64.0
docker push harbor.apps.sre.example.com/<team>/n8n:v1.64.0

# Update helmrelease.yaml with your team name, then add to your tenant apps/
```
