# Runbook: OpenBao Sealed

## Alert

- **Prometheus Alert:** `OpenBaoSealed` / `OpenBaoDown`
- **Grafana Dashboard:** OpenBao dashboard
- **Firing condition:** OpenBao server reports sealed status, or the `/v1/sys/health` endpoint returns HTTP 503

## Severity

**Critical** -- When OpenBao is sealed, no secrets can be read or written. All ExternalSecret resources will fail to sync, causing application pods that depend on secrets to fail startup or lose access to rotated credentials.

## Impact

- External Secrets Operator cannot sync secrets from OpenBao to Kubernetes Secrets
- Applications using ESO-managed secrets will not receive updated credentials
- New pod deployments that require secrets from OpenBao will fail
- PKI certificate issuance from OpenBao's PKI engine stops
- Keycloak, Harbor, and other components using ESO secrets may lose database connectivity on credential rotation

## Investigation Steps

1. Check OpenBao pod status:

```bash
kubectl get pods -n openbao -l app.kubernetes.io/name=openbao
```

2. Check the seal status:

```bash
kubectl exec -n openbao openbao-0 -- bao status
```

3. If the pod is running but sealed, the output will show `Sealed: true`

4. Check OpenBao logs for why it became sealed:

```bash
kubectl logs -n openbao openbao-0 --tail=200
```

5. Check if the pod restarted (which causes auto-seal):

```bash
kubectl describe pod -n openbao openbao-0 | grep -A 5 "Last State"
kubectl get events -n openbao --sort-by='.lastTimestamp' | tail -20
```

6. Check the HelmRelease status:

```bash
flux get helmrelease openbao -n openbao
```

7. Check External Secrets Operator for sync failures:

```bash
kubectl get externalsecrets -A
kubectl get clustersecretstores
```

8. Check if the unseal keys secret still exists:

```bash
kubectl get secret openbao-init-keys -n openbao
```

## Resolution

### Standard unseal procedure

OpenBao seals itself on pod restart. The unseal keys are stored in the `openbao-init-keys` secret in the `openbao` namespace.

1. Retrieve the unseal keys:

```bash
kubectl get secret openbao-init-keys -n openbao -o jsonpath='{.data.unseal-keys}' | base64 -d
```

2. Unseal OpenBao (repeat for each key share required -- default threshold is 1 for dev):

```bash
kubectl exec -n openbao openbao-0 -- bao operator unseal <UNSEAL_KEY>
```

3. Verify OpenBao is unsealed:

```bash
kubectl exec -n openbao openbao-0 -- bao status
```

4. Confirm the output shows `Sealed: false`

5. Verify External Secrets can sync again:

```bash
kubectl get clustersecretstores
kubectl get externalsecrets -A
```

### OpenBao pod crash-looping

1. Check the pod logs for the crash reason:

```bash
kubectl logs -n openbao openbao-0 --previous
```

2. Common causes:
   - Storage backend corruption -- check PVC status
   - Out of memory -- check resource limits in the HelmRelease
   - Configuration error after upgrade

3. If storage is the issue, check the PVC:

```bash
kubectl get pvc -n openbao
kubectl describe pvc data-openbao-0 -n openbao
```

4. If the pod cannot start, try restarting:

```bash
kubectl delete pod openbao-0 -n openbao
```

5. After the pod restarts, unseal it (see standard unseal procedure above)

### Unseal keys secret is missing

If the `openbao-init-keys` secret has been deleted:

1. Check if you have a backup of the unseal keys outside the cluster
2. If unseal keys are permanently lost, OpenBao data is unrecoverable and must be re-initialized:

```bash
kubectl exec -n openbao openbao-0 -- bao operator init -key-shares=1 -key-threshold=1 -format=json
```

3. Store the new unseal keys and root token:

```bash
kubectl create secret generic openbao-init-keys -n openbao \
  --from-literal=unseal-keys="<NEW_UNSEAL_KEY>" \
  --from-literal=root-token="<NEW_ROOT_TOKEN>"
```

4. Unseal with the new key
5. Reconfigure all secret engines, auth methods, and policies
6. Re-sync all ExternalSecrets

### Re-enable External Secrets sync after unseal

1. After unsealing, check that the ClusterSecretStore reconnects:

```bash
kubectl get clustersecretstores -o wide
```

2. Force a sync of all ExternalSecrets:

```bash
for es in $(kubectl get externalsecrets -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name' --no-headers); do
  ns=$(echo $es | awk '{print $1}')
  name=$(echo $es | awk '{print $2}')
  kubectl annotate externalsecret $name -n $ns force-sync=$(date +%s) --overwrite
done
```

## Prevention

- Store unseal keys in a secure location outside the cluster (hardware security module, offline vault, or secure password manager)
- Configure auto-unseal with a cloud KMS provider for production environments (AWS KMS, Azure Key Vault)
- Set up the `OpenBaoSealed` Prometheus alert with a 1-minute threshold
- Monitor the `openbao_core_unsealed` metric
- Ensure OpenBao pod has sufficient memory (currently limited to 512Mi) to avoid OOM kills
- Back up OpenBao's Raft storage regularly using Velero

## Escalation

- If unseal keys are lost and no backup exists: escalate immediately to platform team lead -- this requires full re-initialization
- If OpenBao is unsealed but External Secrets still failing: check ESO pod logs and the ClusterSecretStore configuration
- If OpenBao storage is corrupted: restore from the most recent Velero backup of the openbao namespace
