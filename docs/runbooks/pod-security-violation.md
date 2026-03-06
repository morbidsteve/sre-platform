# Runbook: Pod Security Violation (Kyverno)

## Alert

- **Prometheus Alert:** `KyvernoPolicyViolation`
- **Grafana Dashboard:** Kyverno Policy dashboard
- **Firing condition:** Kyverno reports a policy violation on a resource creation or update, or background scan detects non-compliant existing resources

## Severity

**Warning** -- Policy violations in Enforce mode block resource creation. Violations in Audit mode allow the resource but generate a compliance report. Both require investigation to determine whether the violation is a legitimate security concern or a misconfiguration.

## Impact

- **Enforce mode:** Pod or resource creation is blocked -- the developer's deployment fails
- **Audit mode:** The resource is created but flagged as non-compliant in PolicyReports
- Compliance posture degradation if violations are not addressed
- Potential security risk if a violation indicates a genuine attempt to bypass controls

## Investigation Steps

1. Check for recent policy violations:

```bash
kubectl get policyreport -A
kubectl get clusterpolicyreport
```

2. Get details on violations in a specific namespace:

```bash
kubectl get policyreport -n <namespace> -o yaml
```

3. List all ClusterPolicies and their enforcement mode:

```bash
kubectl get clusterpolicies -o custom-columns='NAME:.metadata.name,ACTION:.spec.validationFailureAction,READY:.status.conditions[0].status'
```

4. Check Kyverno admission controller logs for the specific denial:

```bash
kubectl logs -n kyverno deployment/kyverno-admission-controller --tail=200 | grep -i "denied\|violation\|blocked"
```

5. Check the events in the namespace where the violation occurred:

```bash
kubectl get events -n <namespace> --sort-by='.lastTimestamp' | grep -i "kyverno\|policy"
```

6. If the violation was on a specific pod/deployment, check what triggered it:

```bash
kubectl describe deployment <name> -n <namespace>
kubectl get replicaset -n <namespace> -o yaml | grep -A 20 "securityContext"
```

7. Check the specific policy that was violated:

```bash
kubectl get clusterpolicy <policy-name> -o yaml
```

8. Check the Kyverno background controller for existing resource violations:

```bash
kubectl logs -n kyverno deployment/kyverno-background-controller --tail=100
```

## Resolution

### Violation: disallow-privileged-containers

The pod spec requests privileged mode. Fix the deployment:

```yaml
# Correct security context
spec:
  containers:
    - name: app
      securityContext:
        privileged: false
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        capabilities:
          drop:
            - ALL
```

### Violation: require-run-as-nonroot

The container is running as root. Fix by setting the security context:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
  containers:
    - name: app
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
```

### Violation: restrict-image-registries

The image is not from the approved Harbor registry. Fix by pulling from Harbor:

```yaml
spec:
  containers:
    - name: app
      image: harbor.sre.internal/<project>/<image>:<tag>
```

### Violation: disallow-latest-tag

The image uses the `:latest` tag or has no tag. Fix by pinning an explicit version:

```yaml
spec:
  containers:
    - name: app
      image: harbor.sre.internal/team-alpha/my-app:v1.2.3
```

### Violation: require-resource-limits

The pod is missing CPU or memory limits. Fix by adding resource constraints:

```yaml
spec:
  containers:
    - name: app
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
```

### Violation: require-labels

Required labels are missing. Ensure all resources have standard labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: my-app
    app.kubernetes.io/instance: my-app
    app.kubernetes.io/version: v1.2.3
    app.kubernetes.io/managed-by: Helm
    sre.io/team: team-alpha
```

### Legitimate exception needed (platform components)

If a platform component genuinely needs an exception (e.g., NeuVector enforcer requires privileged access):

1. Create a PolicyException:

```yaml
apiVersion: kyverno.io/v2beta1
kind: PolicyException
metadata:
  name: <component>-exception
  namespace: <namespace>
spec:
  exceptions:
    - policyName: <policy-name>
      ruleNames:
        - <rule-name>
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - <namespace>
```

2. Document the exception and its justification in the component's README
3. Add the exception to Git and let Flux reconcile it

## Prevention

- Use the SRE app template Helm charts (`sre-web-app`, `sre-worker`, `sre-cronjob`) which include compliant security contexts by default
- Run `kyverno test` locally before pushing policy changes
- Review PolicyReports weekly to catch audit-mode violations before switching policies to Enforce
- Include Kyverno policy validation in CI/CD pipelines
- Educate development teams on pod security requirements via the developer guide

## Escalation

- If a legitimate workload is being blocked and no workaround exists: discuss a PolicyException with the security team
- If violations appear to be intentional bypass attempts: escalate to the security team for investigation
- If Kyverno itself is failing (admission controller not responding): this is a P1 -- all admissions may be blocked or uncontrolled
