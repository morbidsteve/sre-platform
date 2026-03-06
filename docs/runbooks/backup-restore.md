# Runbook: Backup and Restore (Velero)

## Alert

- **Prometheus Alert:** `VeleroBackupFailure` / `VeleroBackupPartialFailure` / `VeleroScheduleMissed`
- **Grafana Dashboard:** Velero dashboard (from velero metrics ServiceMonitor)
- **Firing condition:** A scheduled backup has failed, partially failed, or has not run on schedule

## Severity

**Critical** -- Backup failures mean the platform has no recovery point. If a disaster occurs, data loss is possible. Compliance frameworks (NIST CP-9, CP-10) require verified backups.

## Impact

- No recent backup available for disaster recovery
- Compliance violation: NIST CP-9 (Information System Backup) control not met
- If storage backend is unreachable, all scheduled backups (daily, weekly, monthly) will fail
- PersistentVolume data may not be recoverable if backups are stale

## Investigation Steps

1. Check Velero pod status:

```bash
kubectl get pods -n velero
```

2. Check backup schedule status:

```bash
kubectl get schedules -n velero
```

3. List recent backups and their status:

```bash
kubectl get backups -n velero --sort-by='.metadata.creationTimestamp' | tail -10
```

4. Describe a failing backup:

```bash
kubectl describe backup <backup-name> -n velero
```

5. Check Velero logs:

```bash
kubectl logs -n velero deployment/velero --tail=200
```

6. Check the backup storage location status:

```bash
kubectl get backupstoragelocations -n velero
kubectl describe backupstoragelocation default -n velero
```

7. Check volume snapshot location:

```bash
kubectl get volumesnapshotlocations -n velero
```

8. Check for node-agent (restic/kopia) issues if using file-level backup:

```bash
kubectl get pods -n velero -l name=node-agent
kubectl logs -n velero -l name=node-agent --tail=100
```

9. Check the Velero HelmRelease:

```bash
flux get helmrelease velero -n velero
```

## Resolution

### Backup storage location unavailable

1. Check if S3 credentials are valid:

```bash
kubectl get secret velero-s3-credentials -n velero
```

2. Test S3 connectivity from within the cluster:

```bash
kubectl run -n velero --rm -it --restart=Never s3-test --image=amazon/aws-cli:2.15.0 -- s3 ls s3://sre-velero-backups/ --endpoint-url <S3_ENDPOINT>
```

3. If credentials have expired or rotated, update the secret and restart Velero:

```bash
kubectl create secret generic velero-s3-credentials -n velero \
  --from-literal=aws-access-key-id="<KEY>" \
  --from-literal=aws-secret-access-key="<SECRET>" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment velero -n velero
```

4. Verify the backup storage location recovers:

```bash
kubectl get backupstoragelocation default -n velero -w
```

### Backup partially failed

1. Check which resources or namespaces had errors:

```bash
kubectl describe backup <backup-name> -n velero | grep -A 20 "Phase:"
```

2. Download the backup logs:

```bash
kubectl logs -n velero deployment/velero --tail=500 | grep "<backup-name>"
```

3. Common causes:
   - PVC backup timeout (large volumes)
   - Webhook validation failures during resource capture
   - CRD resources without proper backup annotations

4. Retry the backup manually:

```bash
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Backup
metadata:
  name: manual-backup-$(date +%Y%m%d-%H%M)
  namespace: velero
spec:
  excludedNamespaces:
    - kube-system
    - flux-system
  includeClusterResources: true
  storageLocation: default
  ttl: 168h
EOF
```

### Schedule not running

1. Check if the schedule is paused:

```bash
kubectl get schedule -n velero -o yaml | grep paused
```

2. If paused, unpause:

```bash
kubectl patch schedule daily-backup -n velero --type merge -p '{"spec":{"paused":false}}'
```

3. Verify the schedule cron expression is correct:

```bash
kubectl get schedule -n velero -o custom-columns='NAME:.metadata.name,SCHEDULE:.spec.schedule,PAUSED:.spec.paused'
```

### Node-agent (restic/kopia) failures

1. Check node-agent DaemonSet:

```bash
kubectl get ds -n velero -l name=node-agent
```

2. Check logs on the failing node:

```bash
kubectl logs -n velero -l name=node-agent --tail=100
```

3. Restart node-agent if needed:

```bash
kubectl rollout restart daemonset -n velero node-agent
```

## Restore Procedure

### Full namespace restore

1. List available backups:

```bash
kubectl get backups -n velero --sort-by='.metadata.creationTimestamp'
```

2. Create a restore from the most recent successful backup:

```bash
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: restore-$(date +%Y%m%d-%H%M)
  namespace: velero
spec:
  backupName: <backup-name>
  includedNamespaces:
    - <namespace-to-restore>
  restorePVs: true
EOF
```

3. Monitor the restore progress:

```bash
kubectl get restore -n velero -w
kubectl describe restore <restore-name> -n velero
```

### Selective resource restore

1. Restore only specific resource types:

```bash
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: restore-secrets-$(date +%Y%m%d-%H%M)
  namespace: velero
spec:
  backupName: <backup-name>
  includedNamespaces:
    - <namespace>
  includedResources:
    - secrets
    - configmaps
EOF
```

### Disaster recovery -- full cluster restore

1. Ensure Velero is installed on the new cluster
2. Configure the same backup storage location
3. Verify Velero can see existing backups:

```bash
kubectl get backups -n velero
```

4. Restore in dependency order:
   - First: namespaces, CRDs, cluster-scoped resources
   - Then: platform core components (istio, cert-manager, kyverno, monitoring)
   - Then: application namespaces

```bash
# Step 1: Cluster resources
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: restore-cluster-resources
  namespace: velero
spec:
  backupName: <latest-backup>
  includeClusterResources: true
  includedResources:
    - namespaces
    - customresourcedefinitions
    - clusterroles
    - clusterrolebindings
EOF

# Step 2: Platform namespaces
kubectl create -f - <<EOF
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: restore-platform
  namespace: velero
spec:
  backupName: <latest-backup>
  includedNamespaces:
    - istio-system
    - cert-manager
    - kyverno
    - monitoring
    - logging
    - openbao
    - external-secrets
  restorePVs: true
EOF
```

### Post-restore verification

1. Check all pods are running:

```bash
kubectl get pods -A | grep -v Running | grep -v Completed
```

2. Check Flux reconciliation:

```bash
flux get kustomizations -A
flux get helmreleases -A
```

3. Verify platform services are healthy:

```bash
kubectl get helmreleases -A
```

## Prevention

- Monitor `velero_backup_last_successful_timestamp` metric and alert if it exceeds 26 hours (daily backup missed)
- Test restore procedures quarterly by restoring to a test namespace
- Verify backup storage location health daily via the `velero_backup_storage_location_available` metric
- Ensure S3 credentials are rotated before expiry and the `velero-s3-credentials` secret is updated
- Keep Velero updated via the Flux HelmRelease (currently `11.3.2`)
- Document and test the full disaster recovery procedure annually

## Escalation

- If all backups are failing: this is a compliance violation (NIST CP-9) -- escalate to platform team lead
- If a restore is needed for production data recovery: coordinate with all affected teams before starting
- If the backup storage location is permanently lost: rebuild from Git (Flux will re-deploy all platform components) but PersistentVolume data is lost
