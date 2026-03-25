# Runbook: External Secrets Sync Failure

## Alert

- **Prometheus Alert:** `ExternalSecretSyncFailure` / `ExternalSecretNotReady`
- **Grafana Dashboard:** External Secrets dashboard, Cluster Health dashboard
- **Firing condition:** An ExternalSecret resource fails to sync from OpenBao, or the ClusterSecretStore reports connection errors. The ExternalSecret status shows `SecretSyncedError` or the sync has not succeeded within the expected interval.

## Severity

**Warning** -- Existing Kubernetes Secrets remain in place (they are not deleted on sync failure), so running pods continue to work with the last-synced values. However, new secret values, rotated credentials, or newly created ExternalSecrets will not be available.

## Impact

- New deployments that depend on secrets from OpenBao will fail (the Kubernetes Secret does not exist yet)
- Secret rotation does not take effect (pods continue using stale credentials)
- If a secret was rotated in OpenBao and the old credential was revoked, pods using the stale secret will experience authentication failures
- Compliance posture is affected: IA-5 (Authenticator Management) and SC-12 (Cryptographic Key Management) controls are degraded

## Investigation Steps

1. List all ExternalSecrets and their sync status:

```bash
kubectl get externalsecrets -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,STORE:.spec.secretStoreRef.name,STATUS:.status.conditions[0].reason,LAST_SYNC:.status.conditions[0].lastTransitionTime'
```

2. Find ExternalSecrets with sync errors:

```bash
kubectl get externalsecrets -A -o json | jq -r '
  .items[] |
  select(.status.conditions[]?.reason != "SecretSynced") |
  "\(.metadata.namespace)/\(.metadata.name): \(.status.conditions[0].reason) - \(.status.conditions[0].message)"
'
```

3. Check the ClusterSecretStore status:

```bash
kubectl get clustersecretstore -o custom-columns='NAME:.metadata.name,STATUS:.status.conditions[0].reason,MESSAGE:.status.conditions[0].message'
```

4. Check ESO controller logs for errors:

```bash
kubectl logs -n external-secrets deployment/external-secrets --tail=200 | grep -i "error\|fail\|denied\|unauthorized"
```

5. Check the ESO webhook logs:

```bash
kubectl logs -n external-secrets deployment/external-secrets-webhook --tail=100
```

6. Verify OpenBao is unsealed and reachable:

```bash
kubectl get pods -n openbao -l app.kubernetes.io/name=openbao
kubectl exec -n openbao openbao-0 -- vault status 2>/dev/null || echo "OpenBao may be sealed or unreachable"
```

7. Test the Kubernetes auth method from the ESO service account:

```bash
# Check the ESO service account token
kubectl get serviceaccount -n external-secrets external-secrets -o yaml

# Verify the Kubernetes auth role exists in OpenBao
kubectl exec -n openbao openbao-0 -- vault read auth/kubernetes/config 2>/dev/null
```

8. Check if the secret path exists in OpenBao:

```bash
# Get the remote ref path from the ExternalSecret
kubectl get externalsecret <name> -n <namespace> -o jsonpath='{.spec.data[*].remoteRef.key}'

# Verify the path exists in OpenBao
kubectl exec -n openbao openbao-0 -- vault kv get <path> 2>/dev/null
```

9. Check ESO Prometheus metrics:

```promql
# Sync error rate
rate(externalsecret_sync_calls_error_total[5m])

# Sync duration
histogram_quantile(0.99, rate(externalsecret_sync_calls_duration_seconds_bucket[5m]))

# Number of ExternalSecrets not synced
externalsecret_status_condition{condition="Ready", status="False"}
```

## Resolution

### Cause: OpenBao is sealed

If OpenBao is sealed, no secrets can be synced.

1. Follow the openbao-sealed runbook to unseal OpenBao
2. Once unsealed, ESO will automatically retry on its next refresh interval
3. To force an immediate resync:

```bash
# Annotate the ExternalSecret to trigger a sync
kubectl annotate externalsecret <name> -n <namespace> force-sync=$(date +%s) --overwrite
```

### Cause: Kubernetes auth method misconfigured

The ESO service account cannot authenticate to OpenBao.

1. Verify the Kubernetes auth backend is configured:

```bash
kubectl exec -n openbao openbao-0 -- vault auth list 2>/dev/null
```

2. Check the Kubernetes auth config points to the correct API server:

```bash
kubectl exec -n openbao openbao-0 -- vault read auth/kubernetes/config 2>/dev/null
```

3. Verify the role exists and allows the ESO service account:

```bash
kubectl exec -n openbao openbao-0 -- vault read auth/kubernetes/role/external-secrets 2>/dev/null
```

4. If the role is missing, recreate it:

```bash
kubectl exec -n openbao openbao-0 -- vault write auth/kubernetes/role/external-secrets \
  bound_service_account_names=external-secrets \
  bound_service_account_namespaces=external-secrets \
  policies=platform-reader \
  ttl=1h
```

### Cause: Secret path does not exist in OpenBao

The ExternalSecret references a path that has not been created in OpenBao.

1. Create the secret in OpenBao:

```bash
kubectl exec -n openbao openbao-0 -- vault kv put sre/<team>/<secret-name> \
  value="<secret-value>"
```

2. ESO will pick it up on the next refresh interval (default: 1h, configurable per ExternalSecret).

### Cause: ESO controller is not running

1. Check the ESO deployment:

```bash
kubectl get deployment -n external-secrets
```

2. If pods are not running, check for issues:

```bash
kubectl describe deployment external-secrets -n external-secrets
kubectl get events -n external-secrets --sort-by='.lastTimestamp'
```

3. Restart ESO if needed:

```bash
kubectl rollout restart deployment/external-secrets -n external-secrets
```

### Cause: ClusterSecretStore connectivity failure

1. Check the ClusterSecretStore spec:

```bash
kubectl get clustersecretstore openbao-backend -o yaml
```

2. Verify the OpenBao server URL is correct and reachable from the ESO pod:

```bash
kubectl exec -n external-secrets deployment/external-secrets -- \
  wget -qO- --timeout=5 https://openbao.openbao.svc.cluster.local:8200/v1/sys/health 2>&1 || echo "Connection failed"
```

3. If the URL or auth configuration is wrong, update the ClusterSecretStore manifest in Git and let Flux reconcile.

## Prevention

- Monitor ESO sync metrics in Grafana: `externalsecret_sync_calls_error_total` and `externalsecret_status_condition`
- Set up alerts for ExternalSecret sync failures (included in SRE alerting rules)
- Always test new ExternalSecrets in dev before deploying to production
- Ensure OpenBao has monitoring and auto-unseal configured to minimize sealed-state duration
- Use short refresh intervals (15m) for critical secrets and longer intervals (1h) for stable secrets
- Document all OpenBao paths in the tenant onboarding guide so teams create secrets in the correct location
- Include ESO health in the morning health check script

## Escalation

- If OpenBao is sealed and cannot be unsealed: P1 -- follow the openbao-sealed runbook and escalate to the platform team
- If ESO is completely down and no secrets are syncing: P2 -- existing secrets still work but no updates possible
- If a specific team's secrets are failing but others work: likely a path or permissions issue -- assist the team directly
- If Kubernetes auth is broken after an OpenBao upgrade: escalate to the platform team to reconfigure auth
