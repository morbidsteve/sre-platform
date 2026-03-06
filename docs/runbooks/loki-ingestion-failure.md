# Runbook: Loki Ingestion Failure

## Alert

- **Prometheus Alert:** `LokiIngestionRateDrop` / `LokiRequestErrors` / `LokiStreamLimitExceeded`
- **Grafana Dashboard:** Loki dashboard
- **Firing condition:** Loki ingestion rate drops by more than 50% compared to the previous hour, or Loki returns 429/500 errors to Alloy collectors

## Severity

**Warning** -- Log ingestion failure means platform and application logs are being dropped. This creates gaps in observability and audit trails, violating NIST AU-2 (Audit Events) and AU-4 (Audit Storage Capacity) controls.

## Impact

- New logs from pods and node journals are not being stored
- Grafana log queries return incomplete results
- Audit trail gaps for compliance (NIST AU-2, AU-12)
- Alert rules based on log queries (LogQL) will not fire
- Incident investigation is impaired due to missing log data

## Investigation Steps

1. Check Loki pod status:

```bash
kubectl get pods -n logging -l app.kubernetes.io/name=loki
```

2. Check Loki logs for errors:

```bash
kubectl logs -n logging -l app.kubernetes.io/name=loki --tail=200
```

3. Check Alloy (log collector) pod status:

```bash
kubectl get pods -n logging -l app.kubernetes.io/name=alloy
```

4. Check Alloy logs for delivery errors:

```bash
kubectl logs -n logging -l app.kubernetes.io/name=alloy --tail=200 | grep -i "error\|429\|500\|dropped\|failed"
```

5. Check Loki metrics for ingestion rate:

```
Prometheus query: rate(loki_distributor_bytes_received_total[5m])
```

6. Check for rate limiting:

```bash
kubectl logs -n logging -l app.kubernetes.io/name=loki --tail=200 | grep -i "rate\|limit\|429"
```

7. Check Loki storage (filesystem in SingleBinary mode):

```bash
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=loki -o name | head -1) -- df -h /tmp/loki
```

8. Check the HelmRelease status:

```bash
flux get helmrelease loki -n logging
flux get helmrelease alloy -n logging
```

9. Check if Loki can be reached from Alloy:

```bash
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=alloy -o name | head -1) -- wget -q -O- http://loki.logging.svc.cluster.local:3100/ready
```

10. Check Loki readiness:

```bash
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=loki -o name | head -1) -- wget -q -O- http://localhost:3100/ready
```

## Resolution

### Loki storage full

1. Check current disk usage:

```bash
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=loki -o name | head -1) -- du -sh /tmp/loki/chunks /tmp/loki/rules
```

2. If the storage is full, reduce the retention period temporarily:

```yaml
# In the Loki HelmRelease values
loki:
  limits_config:
    retention_period: "168h"  # Reduce from 720h to 168h (7 days)
```

3. Push the change to Git and reconcile:

```bash
flux reconcile helmrelease loki -n logging --with-source
```

4. If using PVC storage, expand the PVC (if the StorageClass supports expansion):

```bash
kubectl edit pvc storage-loki-0 -n logging
```

5. For immediate relief, restart Loki to trigger compaction:

```bash
kubectl rollout restart statefulset loki -n logging
```

### Loki rate limiting (429 errors)

1. Check the current rate limits:

```bash
kubectl get helmrelease loki -n logging -o yaml | grep -A 10 "limits_config"
```

2. Increase the ingestion rate limits:

```yaml
loki:
  limits_config:
    ingestion_rate_mb: 10
    ingestion_burst_size_mb: 20
    per_stream_rate_limit: "5MB"
    per_stream_rate_limit_burst: "15MB"
```

3. Alternatively, reduce log volume by filtering noisy namespaces in the Alloy configuration

### Alloy pods not collecting logs

1. Check Alloy DaemonSet:

```bash
kubectl get daemonset alloy -n logging
```

2. Verify all nodes have an Alloy pod:

```bash
kubectl get pods -n logging -l app.kubernetes.io/name=alloy -o wide
```

3. If a pod is missing, check node taints:

```bash
kubectl describe node <node-name> | grep Taints
```

4. Restart the Alloy DaemonSet:

```bash
kubectl rollout restart daemonset alloy -n logging
```

### Alloy cannot reach Loki

1. Test connectivity:

```bash
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=alloy -o name | head -1) -- wget -q -O- http://loki.logging.svc.cluster.local:3100/ready
```

2. Check NetworkPolicies in the logging namespace:

```bash
kubectl get networkpolicies -n logging
```

3. Verify the Loki service exists and has endpoints:

```bash
kubectl get svc loki -n logging
kubectl get endpoints loki -n logging
```

### Loki pod crash-looping

1. Check logs from the previous crash:

```bash
kubectl logs -n logging -l app.kubernetes.io/name=loki --previous --tail=100
```

2. Common causes:
   - Out of memory (check resource limits)
   - Corrupted WAL (write-ahead log)
   - Schema migration failure after upgrade

3. If WAL corruption is suspected:

```bash
# Delete the WAL directory (data since last flush will be lost)
kubectl exec -n logging $(kubectl get pod -n logging -l app.kubernetes.io/name=loki -o name | head -1) -- rm -rf /tmp/loki/wal
kubectl rollout restart statefulset loki -n logging
```

4. If out of memory, increase limits in the HelmRelease

### High cardinality labels causing memory pressure

1. Check for high cardinality:

```
LogQL query in Grafana: count(count by (__name__)({__name__=~".+"}))
```

2. Identify namespaces producing the most log volume:

```
LogQL: sum by (namespace) (rate({namespace=~".+"} | __error__="" [5m]))
```

3. Add label drop rules in the Alloy configuration for high-cardinality labels that are not useful

### Emergency: log data gap recovery

If logs were lost during the outage:

1. Check if the Alloy pods buffered logs locally (they do not persist to disk by default -- logs during the outage are lost)
2. For critical audit events, check the Kubernetes API audit log on the server node:

```bash
ssh sre-admin@<server-ip> "sudo cat /var/lib/rancher/rke2/server/logs/audit.log | tail -500"
```

3. Check node journals for events during the gap:

```bash
ssh sre-admin@<node-ip> "sudo journalctl --since '<start-time>' --until '<end-time>'"
```

## Prevention

- Monitor `loki_ingester_chunks_stored_total` and `loki_distributor_bytes_received_total` metrics
- Alert on ingestion rate drops greater than 50% over 15 minutes
- Alert on Loki storage usage at 70% (warning) and 85% (critical)
- Set appropriate retention periods based on compliance requirements (currently 720h / 30 days)
- Review and optimize Alloy relabeling rules to drop unnecessary labels
- Ensure Loki has sufficient memory for the expected log volume
- Configure Alloy to drop debug-level logs from noisy namespaces in non-production environments

## Escalation

- If log ingestion is completely stopped: this is a compliance violation (NIST AU-2, AU-12) -- escalate to platform team lead
- If Loki data is corrupted and unrecoverable: restore from Velero backup of the logging namespace
- If the issue is caused by excessive log volume from a tenant application: notify the tenant team to reduce log verbosity
