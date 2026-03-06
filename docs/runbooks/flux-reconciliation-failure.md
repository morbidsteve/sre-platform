# Runbook: Flux Reconciliation Failure

## Alert

- **Prometheus Alert:** `FluxReconciliationFailure`
- **Grafana Dashboard:** Flux CD dashboard
- **Firing condition:** A Flux Kustomization or HelmRelease has been in a failed or not-ready state for more than 15 minutes

## Severity

**Warning** -- Reconciliation failures mean the cluster state has drifted from the Git repository. Changes committed to Git are not being applied. Extended failures may indicate a broken deployment or dependency issue.

## Impact

- New deployments or configuration changes from Git are not applied
- Platform components may be running stale configurations
- If a core component fails (Istio, Kyverno, monitoring), downstream services may be affected
- Security patches committed to Git are not being rolled out

## Investigation Steps

1. Get the status of all Flux Kustomizations:

```bash
flux get kustomizations -A
```

2. Get the status of all HelmReleases:

```bash
flux get helmreleases -A
```

3. Identify the specific failing resource and check its events:

```bash
flux logs --kind=Kustomization --name=<name> --namespace=flux-system
flux logs --kind=HelmRelease --name=<name> --namespace=<namespace>
```

4. Check the Flux source-controller for Git repository sync issues:

```bash
flux get sources git -A
kubectl logs -n flux-system deployment/source-controller --tail=100
```

5. Check the Flux helm-controller for Helm-specific errors:

```bash
kubectl logs -n flux-system deployment/helm-controller --tail=100
```

6. Check the Flux kustomize-controller:

```bash
kubectl logs -n flux-system deployment/kustomize-controller --tail=100
```

7. Verify Flux system pods are running:

```bash
kubectl get pods -n flux-system
```

8. Check for resource conflicts or validation errors:

```bash
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | tail -20
```

9. Check if the HelmRelease has dependency issues:

```bash
kubectl get helmrelease <name> -n <namespace> -o yaml | grep -A 10 dependsOn
```

## Resolution

### HelmRelease stuck in "not ready" due to failed upgrade

1. Check the Helm history:

```bash
helm history <release-name> -n <namespace>
```

2. If a bad revision exists, let Flux retry:

```bash
flux reconcile helmrelease <name> -n <namespace> --with-source
```

3. If retries are exhausted, reset the release:

```bash
flux suspend helmrelease <name> -n <namespace>
helm rollback <release-name> <last-good-revision> -n <namespace>
flux resume helmrelease <name> -n <namespace>
```

### Kustomization failing due to invalid YAML

1. Check the error message in the Kustomization status:

```bash
kubectl get kustomization <name> -n flux-system -o yaml | grep -A 5 'message:'
```

2. Fix the YAML in the Git repository
3. Push the fix and force reconciliation:

```bash
flux reconcile source git sre-platform -n flux-system
flux reconcile kustomization <name> -n flux-system
```

### Git source not syncing

1. Check the GitRepository status:

```bash
flux get sources git -A
kubectl describe gitrepository sre-platform -n flux-system
```

2. Verify Git credentials are valid:

```bash
kubectl get secret flux-system -n flux-system -o yaml
```

3. Test connectivity from the cluster to the Git repository:

```bash
kubectl run -n flux-system --rm -it --restart=Never curl-test --image=curlimages/curl:8.4.0 -- curl -I https://github.com
```

### Dependency failure cascading

If component B depends on component A, and A is failing:

1. Fix component A first
2. Then reconcile B:

```bash
flux reconcile helmrelease <component-a> -n <namespace-a>
# Wait for A to become ready
flux reconcile helmrelease <component-b> -n <namespace-b>
```

The dependency chain is: `istio-base -> cert-manager -> kyverno -> monitoring -> logging -> openbao -> harbor -> neuvector -> keycloak -> tempo -> velero`

### HelmRelease stuck with "another operation in progress"

1. Check for stale Helm secrets:

```bash
kubectl get secrets -n <namespace> -l owner=helm
```

2. If a pending install/upgrade secret exists, remove it:

```bash
kubectl delete secret sh.helm.release.v1.<name>.v<version> -n <namespace>
```

3. Resume reconciliation:

```bash
flux reconcile helmrelease <name> -n <namespace>
```

## Prevention

- Always run `task lint` before pushing changes to Git
- Use `flux diff kustomization` to preview changes before committing
- Pin exact chart versions in HelmReleases (never use `*` or ranges)
- Monitor `gotk_reconcile_condition` metric in Prometheus for early drift detection
- Set up Grafana alerts on Flux reconciliation duration and failure count
- Test HelmRelease changes in a dev environment before promoting to production

## Escalation

- If Flux system pods are crash-looping: escalate to platform team immediately
- If Git source is unreachable for more than 30 minutes: check network/firewall rules and Git hosting service status
- If multiple HelmReleases fail simultaneously: likely a shared dependency issue -- start from the root of the dependency chain
