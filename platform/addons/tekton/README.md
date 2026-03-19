# Tekton CI Pipelines for SRE Platform

Tekton provides in-cluster CI/CD pipelines for automatically building, validating, and deploying platform applications (dashboard, portal, DSOP wizard) when code is pushed to Git.

## Architecture

```
GitHub/GitLab Push
       |
       v
  EventListener (webhook receiver)
       |
       v
  CEL Interceptor (filter by changed files + branch)
       |
       v
  TriggerTemplate (creates PipelineRun)
       |
       v
  Pipeline: build-deploy
       |
       +---> git-clone (clone the repository)
       +---> validate-node / validate-typescript (syntax/type check)
       +---> docker-build-push (Kaniko build, push to Harbor)
       +---> update-gitops-tag (update deployment.yaml, git push)
       |
       v
  Flux detects git change --> auto-deploys new image
```

## Prerequisites

### Install Tekton Pipelines

Tekton Pipelines must be installed before the Flux Kustomization can reconcile. This is a one-time bootstrap step (similar to Flux itself):

```bash
# Install Tekton Pipelines v0.62.2
kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/previous/v0.62.2/release.yaml

# Install Tekton Triggers v0.28.0
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/previous/v0.28.0/release.yaml

# Install Tekton Interceptors (required for CEL and GitHub/GitLab webhook validation)
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/previous/v0.28.0/interceptors.yaml

# Verify installation
kubectl get pods -n tekton-pipelines
```

### Create Required Secrets

These secrets must exist in the `tekton-pipelines` namespace before running pipelines:

```bash
# Harbor push credentials (Docker config format)
kubectl create secret docker-registry harbor-push-creds \
  --namespace tekton-pipelines \
  --docker-server=harbor.harbor.svc.cluster.local \
  --docker-username='robot$ci-push' \
  --docker-password='YOUR_ROBOT_PASSWORD'

# GitHub token for git push (update GitOps manifests)
kubectl create secret generic github-token \
  --namespace tekton-pipelines \
  --from-literal=token='YOUR_GITHUB_TOKEN'

# GitHub webhook secret (for verifying incoming webhooks)
kubectl create secret generic github-webhook-secret \
  --namespace tekton-pipelines \
  --from-literal=secret='YOUR_WEBHOOK_SECRET'
```

### Apply Tekton Tasks and Pipeline

```bash
# Apply tasks
kubectl apply -f ci/tekton/tasks/

# Apply pipeline
kubectl apply -f ci/tekton/pipelines/

# Apply triggers (GitHub)
kubectl apply -f ci/tekton/triggers/github-webhook.yaml

# Apply triggers (GitLab, if using GitLab)
kubectl apply -f ci/tekton/triggers/gitlab-webhook.yaml
```

## Usage

### Manual Trigger

To manually trigger a build for any app, apply the corresponding app-config:

```bash
# Build dashboard
kubectl create -f ci/tekton/app-configs/dashboard.yaml

# Build portal
kubectl create -f ci/tekton/app-configs/portal.yaml

# Build DSOP wizard
kubectl create -f ci/tekton/app-configs/dsop-wizard.yaml
```

Before running, edit the `image-tag` parameter in the YAML to set the desired version.

### Automatic Trigger (Webhook)

When configured, any push to `main` that modifies files under `apps/dashboard/`, `apps/portal/`, or `apps/dsop-wizard/` will automatically trigger the corresponding pipeline.

The image tag for webhook-triggered builds is `git-<commit-sha>`, providing traceability from image to exact commit.

To skip CI on a commit, include `[skip ci]` in the commit message.

### Monitoring Pipeline Runs

```bash
# List all pipeline runs
kubectl get pipelineruns -n tekton-pipelines

# Watch a specific run
kubectl get pipelineruns -n tekton-pipelines -w

# View logs for a pipeline run
kubectl logs -n tekton-pipelines -l tekton.dev/pipelineRun=<run-name> --all-containers

# Get detailed status
kubectl describe pipelinerun <run-name> -n tekton-pipelines
```

## Configuring GitHub Webhook

1. Go to your GitHub repository Settings > Webhooks
2. Click "Add webhook"
3. Set:
   - **Payload URL**: `https://tekton-triggers.apps.sre.example.com/github`
   - **Content type**: `application/json`
   - **Secret**: The value from the `github-webhook-secret` Secret
   - **Events**: Select "Just the push event"
4. Click "Add webhook"

For the webhook URL to work, you need an Istio VirtualService routing traffic to the EventListener service. Example:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: tekton-triggers
  namespace: tekton-pipelines
spec:
  hosts:
    - tekton-triggers.apps.sre.example.com
  gateways:
    - istio-system/main
  http:
    - match:
        - uri:
            prefix: /
      route:
        - destination:
            host: el-github-push-listener.tekton-pipelines.svc.cluster.local
            port:
              number: 8080
```

## Platform Apps Covered

| App | Directory | Validation | Dockerfile | Deployment YAML |
|-----|-----------|------------|------------|-----------------|
| Dashboard | `apps/dashboard/` | Node.js syntax | `apps/dashboard/Dockerfile` | `apps/dashboard/k8s/deployment.yaml` |
| Portal | `apps/portal/` | TypeScript build | `apps/portal/Dockerfile` | `apps/portal/k8s/deployment.yaml` |
| DSOP Wizard | `apps/dsop-wizard/` | TypeScript build | `apps/dsop-wizard/Dockerfile` | `apps/dsop-wizard/k8s/deployment.yaml` |

## Troubleshooting

### Pipeline run fails at build-push step

- Check Harbor push credentials: `kubectl get secret harbor-push-creds -n tekton-pipelines -o jsonpath='{.data}'`
- Verify Harbor is reachable from the cluster: `kubectl run test --rm -it --image=alpine:3.19.1 -- wget -qO- http://harbor.harbor.svc.cluster.local/api/v2.0/health`
- Check Kaniko logs: `kubectl logs -n tekton-pipelines <pod-name> -c step-build-and-push`

### Pipeline run fails at update-gitops step

- Check GitHub token permissions: needs `contents: write` on the repository
- Verify the deployment file path exists in the repo
- Check git clone logs: `kubectl logs -n tekton-pipelines <pod-name> -c step-update-and-push`

### EventListener not receiving webhooks

- Check EventListener pod: `kubectl get pods -n tekton-pipelines -l eventlistener=github-push-listener`
- Check EventListener logs: `kubectl logs -n tekton-pipelines -l eventlistener=github-push-listener`
- Verify webhook secret matches: compare GitHub webhook config with `github-webhook-secret` Secret
- Check Istio VirtualService routing to EventListener service

### Cleanup old PipelineRuns

PipelineRuns accumulate over time. Clean up completed runs:

```bash
# Delete completed runs older than 24 hours
kubectl get pipelineruns -n tekton-pipelines -o name | while read pr; do
  kubectl delete "$pr" -n tekton-pipelines
done

# Or use Tekton's built-in pruning (if tekton-results is installed)
```
