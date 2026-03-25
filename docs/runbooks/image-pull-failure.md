# Runbook: Image Pull Failure

## Alert

- **Prometheus Alert:** `KubePodImagePullBackOff` / `KubePodNotReady`
- **Grafana Dashboard:** Cluster Health dashboard
- **Firing condition:** A pod is stuck in `ImagePullBackOff` or `ErrImagePull` state because the container runtime cannot pull the specified image

## Severity

**Warning** -- The affected pod cannot start, but other pods in the Deployment may still be running. If all replicas are affected (e.g., a Deployment rollout with a bad image tag), this becomes **Critical**.

## Impact

- The affected pod cannot start, reducing available replicas
- If this is a new rollout, the rollout stalls and the old version continues serving (Deployment default behavior)
- If this is the only replica, the service is completely unavailable
- Build pipelines that depend on deploying the new image will appear stuck
- Flux will report the HelmRelease or Kustomization as not healthy

## Investigation Steps

1. Find pods with image pull errors:

```bash
kubectl get pods -A --field-selector status.phase!=Running | grep -E "ImagePullBackOff|ErrImagePull|Init:ImagePullBackOff"
```

2. Get detailed error from the pod events:

```bash
kubectl describe pod <pod-name> -n <namespace> | grep -A 10 "Events:"
```

3. Check the exact image reference the pod is trying to pull:

```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[*].image}'
```

4. Verify the image exists in Harbor:

```bash
# Check if the project and repository exist
curl -sk -u 'admin:Harbor12345' \
  "https://harbor.apps.sre.example.com/api/v2.0/projects/<project>/repositories/<repo>/artifacts?page_size=5" | jq '.[].tags'
```

5. Verify the image pull secret exists and is correctly configured:

```bash
# Check if the pod references an imagePullSecret
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.imagePullSecrets[*].name}'

# Check if the secret exists
kubectl get secret <secret-name> -n <namespace>

# Decode and verify the registry URL in the secret
kubectl get secret <secret-name> -n <namespace> -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d | jq '.auths | keys'
```

6. Test DNS resolution from within the cluster:

```bash
kubectl run dns-test --rm -it --image=docker.io/alpine:3.21.2 --restart=Never -- nslookup harbor.apps.sre.example.com
```

7. Test pulling the image manually from a debug pod:

```bash
kubectl run pull-test --rm -it --image=docker.io/alpine:3.21.2 --restart=Never -- wget -qO /dev/null https://harbor.apps.sre.example.com/v2/
```

8. Check if the Harbor registry certificate is trusted by the nodes:

```bash
# On RKE2 nodes, registries.yaml must have the correct config
kubectl get nodes -o wide  # Get node IPs
# Check RKE2 registries config (via privileged debug pod if needed)
kubectl get configmap -n kube-system rke2-registries -o yaml 2>/dev/null
```

9. Check Harbor health:

```bash
kubectl get pods -n harbor
kubectl logs deployment/harbor-core -n harbor --tail=50
```

## Resolution

### Cause: Image tag does not exist

The most common cause. The image reference points to a tag that has not been pushed to Harbor.

1. Verify the correct tag:

```bash
curl -sk -u 'admin:Harbor12345' \
  "https://harbor.apps.sre.example.com/api/v2.0/projects/<project>/repositories/<repo>/artifacts?page_size=10" | \
  jq -r '.[].tags[].name'
```

2. Fix the image tag in the HelmRelease or Deployment manifest and push to Git. Flux will reconcile.

### Cause: Image pull secret missing or expired

Robot account credentials may have expired or the pull secret was never created in the namespace.

1. Create or refresh the pull secret:

```bash
kubectl create secret docker-registry harbor-pull-secret \
  -n <namespace> \
  --docker-server=harbor.apps.sre.example.com \
  --docker-username='robot$ci-push' \
  --docker-password='<robot-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

2. Verify the Deployment references the secret:

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: harbor-pull-secret
```

### Cause: DNS resolution failure

The node cannot resolve the Harbor hostname.

1. Check the node-hosts-manager DaemonSet is running:

```bash
kubectl get ds -n kube-system node-hosts-manager
```

2. Verify `/etc/hosts` entries on the node (via debug pod):

```bash
kubectl debug node/<node-name> -it --image=docker.io/alpine:3.21.2 -- cat /host/etc/hosts | grep harbor
```

3. If missing, restart the node-hosts-manager DaemonSet:

```bash
kubectl rollout restart ds/node-hosts-manager -n kube-system
```

### Cause: TLS certificate error

The node does not trust Harbor's TLS certificate.

1. Check RKE2 registries configuration on the node:

```bash
kubectl debug node/<node-name> -it --image=docker.io/alpine:3.21.2 -- cat /host/etc/rancher/rke2/registries.yaml
```

2. Ensure `insecure_skip_verify: true` is set (for self-signed certs) or the CA certificate is installed:

```yaml
# /etc/rancher/rke2/registries.yaml
mirrors:
  harbor.apps.sre.example.com:
    endpoint:
      - "https://harbor.apps.sre.example.com"
configs:
  "harbor.apps.sre.example.com":
    tls:
      insecure_skip_verify: true
```

3. Restart RKE2 on the node after updating registries.yaml (requires privileged access).

### Cause: Harbor is down

If Harbor itself is not responding:

```bash
kubectl get pods -n harbor
kubectl rollout restart deployment/harbor-core -n harbor
kubectl rollout restart deployment/harbor-registry -n harbor
```

Wait for Harbor to become healthy, then delete the failing pod to trigger a fresh pull:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

## Prevention

- Always verify image tags exist before updating HelmRelease or Deployment manifests
- Use the `build-and-deploy.sh` script which pushes the image before updating the tag in Git
- Automate pull secret creation as part of tenant onboarding (`scripts/onboard-tenant.sh`)
- Monitor Harbor availability with a synthetic probe (Blackbox Exporter)
- Set up alerts on robot account expiry dates
- Use Kyverno `restrict-image-registries` policy to catch invalid registry references early

## Escalation

- If Harbor is completely down and multiple teams cannot deploy: P1 -- escalate to the platform team
- If the issue is a misconfigured registries.yaml across all nodes: escalate to the infrastructure team (requires node-level access)
- If a robot account has been revoked or credentials rotated without updating secrets: escalate to the platform admin
