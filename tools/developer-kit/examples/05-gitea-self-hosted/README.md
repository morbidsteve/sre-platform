# Gitea — Self-Hosted Git Server

Deploys [Gitea](https://gitea.io) as a self-hosted Git server using the `sre-web-app` Helm template.

## What This Demonstrates

- Deploying a **stateful** third-party application with persistent storage
- Using `startupProbe` for slow-starting apps
- Relaxing `readOnlyRootFilesystem` for apps that need writable disk
- Using a non-standard port (3000)
- Persistent volume for Git repository data

## Key Config Choices

| Setting | Value | Why |
|---------|-------|-----|
| `persistence.enabled` | `true` | Git repos need durable storage |
| `readOnlyRootFilesystem` | `false` | Gitea writes temp files and caches |
| `startupProbe.enabled` | `true` | Gitea takes 30-60s to initialize on first run |
| `port` | `3000` | Gitea default |

## Deploy

```bash
# Mirror the image to Harbor first
docker pull gitea/gitea:1.22-rootless
docker tag gitea/gitea:1.22-rootless harbor.apps.sre.example.com/<team>/gitea:v1.22-rootless
docker push harbor.apps.sre.example.com/<team>/gitea:v1.22-rootless

# Update helmrelease.yaml with your team name and image path, then deploy
```
