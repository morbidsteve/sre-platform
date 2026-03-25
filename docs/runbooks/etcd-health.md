# Runbook: etcd Health

## Alert

- **Prometheus Alert:** `EtcdHighCommitDuration` / `EtcdHighFsyncDuration` / `EtcdMembersDown` / `EtcdInsufficientMembers`
- **Grafana Dashboard:** etcd dashboard (if enabled), Cluster Health dashboard
- **Firing condition:** etcd cluster reports high commit/fsync durations (disk I/O issues), member health failures, or database size approaching quota

## Severity

**Critical** -- etcd is the backing datastore for the entire Kubernetes control plane. All cluster state (pods, services, secrets, configmaps, CRDs) is stored in etcd. An unhealthy etcd directly threatens cluster availability.

## Impact

- API server becomes slow or unresponsive (all kubectl commands hang or timeout)
- Flux cannot reconcile (GitOps drift goes undetected)
- New pod scheduling stops
- Secret rotation and certificate renewal cannot proceed
- If etcd loses quorum (majority of members down), the cluster becomes read-only and then fully unavailable
- **Data loss risk**: improper intervention can corrupt the etcd database

## Investigation Steps

> **WARNING**: etcd is extremely sensitive. Do not restart etcd or delete data without understanding the impact. Always prefer read-only diagnostic commands first.

1. Check etcd member health (RKE2 embeds etcd, so use the RKE2 etcd binary):

```bash
# On the control plane node (via debug pod or SSH)
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  endpoint health --cluster
```

2. Check etcd member list and leader status:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  member list -w table
```

3. Check etcd database size:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  endpoint status -w table
```

4. Check disk I/O performance on the etcd data directory:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host df -h /var/lib/rancher/rke2/server/db/etcd
```

5. Check Prometheus metrics for etcd performance:

```promql
# Backend commit duration (should be < 25ms P99)
histogram_quantile(0.99, rate(etcd_disk_backend_commit_duration_seconds_bucket[5m]))

# WAL fsync duration (should be < 10ms P99)
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m]))

# Database size in bytes
etcd_mvcc_db_total_size_in_bytes

# Number of keys
etcd_debugging_mvcc_keys_total
```

6. Check for etcd alarm conditions:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  alarm list
```

7. Check the RKE2 server logs for etcd-related errors:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host journalctl -u rke2-server --no-pager --since "1 hour ago" | grep -i "etcd\|wal\|snapshot\|compact"
```

## Resolution

### Cause: etcd database too large (approaching quota)

The default etcd quota is 2GB (RKE2 sets 8GB). When the database exceeds the quota, etcd enters alarm mode and rejects writes.

1. Check current database size vs quota:

```bash
# The "DB SIZE" column shows current size
# etcdctl endpoint status shows this
```

2. Compact and defragment the database:

```bash
# Get the current revision
REV=$(kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  endpoint status -w json | jq '.[0].Status.header.revision')

# Compact old revisions
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  compact $REV

# Defragment each member (run on each control plane node)
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  defrag --cluster
```

3. If alarm was triggered, disarm it after compaction:

```bash
kubectl debug node/<control-plane-node> -it --image=docker.io/alpine:3.21.2 -- \
  chroot /host /var/lib/rancher/rke2/bin/etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cert=/var/lib/rancher/rke2/server/tls/etcd/server-client.crt \
  --key=/var/lib/rancher/rke2/server/tls/etcd/server-client.key \
  --cacert=/var/lib/rancher/rke2/server/tls/etcd/server-ca.crt \
  alarm disarm
```

### Cause: High disk I/O latency

etcd requires fast disk I/O (SSD recommended). If the underlying disk is slow:

1. Check disk I/O metrics:

```promql
# High values indicate slow disk
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m]))
```

2. If running on cloud infrastructure, verify the VM uses an SSD-backed volume type (gp3/io1 on AWS, Premium SSD on Azure)
3. If running on Proxmox, ensure the etcd data directory is on an SSD/NVMe datastore, not spinning disk

### Cause: etcd member down (single node failure)

If one etcd member is down but quorum is maintained:

1. Verify the RKE2 server service is running on the affected node
2. Check RKE2 server logs on the affected node
3. If the node is unreachable, check network connectivity and node health (see node-not-ready runbook)

> **DANGER**: Do not remove etcd members unless you understand quorum implications. A 3-node etcd cluster can tolerate 1 failure. Removing a member reduces the cluster to 2 nodes, which can tolerate 0 failures.

## Prevention

- Run etcd on SSD/NVMe storage only -- never on spinning disks
- Monitor etcd database size and set alerts at 50% of quota
- RKE2 automatically manages etcd snapshots -- verify snapshots are being created:
  ```bash
  ls -la /var/lib/rancher/rke2/server/db/snapshots/
  ```
- Monitor WAL fsync and backend commit durations -- alert if P99 exceeds 25ms
- Ensure etcd data directory has at least 20% free disk space at all times
- Use dedicated disk volumes for etcd data if running high-traffic clusters
- Keep the number of Kubernetes resources reasonable -- excessive CRDs or configmaps grow the database

## Escalation

- etcd cluster has lost quorum (majority of members down): P1 -- the cluster is effectively down. This requires immediate infrastructure team response
- etcd database corruption suspected: P1 -- do NOT attempt repairs without expert guidance. Restore from the latest RKE2 etcd snapshot
- Persistent disk I/O issues: escalate to the infrastructure team for storage migration
- All etcd operations should be performed by or supervised by someone with etcd experience
