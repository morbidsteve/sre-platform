# Runbook: Node Not Ready

## Alert

- **Prometheus Alert:** `KubeNodeNotReady` / `KubeNodeUnreachable`
- **Grafana Dashboard:** Cluster Health dashboard
- **Firing condition:** A Kubernetes node has been in NotReady state for more than 5 minutes

## Severity

**Critical** -- A NotReady node means pods scheduled on that node may be unreachable or evicted. In a 3-node cluster (1 server + 2 agents), losing a node reduces capacity by 33-50% and may affect pod scheduling and HA guarantees.

## Impact

- Pods on the affected node become unreachable
- DaemonSet pods (Alloy, NeuVector enforcer, node-exporter) stop reporting from that node
- Pod disruption budgets may prevent rescheduling if capacity is tight
- If the affected node is the RKE2 server (control plane), the Kubernetes API may become unavailable
- NeuVector enforcer loses runtime visibility on the affected node

## Investigation Steps

1. Check node status:

```bash
kubectl get nodes -o wide
```

2. Describe the not-ready node for condition details:

```bash
kubectl describe node <node-name>
```

3. Look at the conditions section for specific failures:

```bash
kubectl get node <node-name> -o jsonpath='{.status.conditions[*]}' | jq .
```

4. Check if the node is reachable via SSH:

```bash
ssh sre-admin@<node-ip> "uptime && free -h && df -h"
```

5. If SSH is available, check kubelet status:

```bash
ssh sre-admin@<node-ip> "sudo systemctl status rke2-agent"
# Or for server nodes:
ssh sre-admin@<node-ip> "sudo systemctl status rke2-server"
```

6. Check kubelet logs on the node:

```bash
ssh sre-admin@<node-ip> "sudo journalctl -u rke2-agent --no-pager --since '30 minutes ago' | tail -100"
```

7. Check for disk pressure:

```bash
ssh sre-admin@<node-ip> "df -h && df -i"
```

8. Check for memory pressure:

```bash
ssh sre-admin@<node-ip> "free -h && cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|SwapTotal'"
```

9. Check for PID pressure:

```bash
ssh sre-admin@<node-ip> "ps aux | wc -l"
```

10. Check containerd status:

```bash
ssh sre-admin@<node-ip> "sudo systemctl status containerd"
ssh sre-admin@<node-ip> "sudo crictl --runtime-endpoint unix:///run/k3s/containerd/containerd.sock ps"
```

11. Check system logs for hardware or kernel errors:

```bash
ssh sre-admin@<node-ip> "sudo dmesg | tail -50"
ssh sre-admin@<node-ip> "sudo journalctl -p err --since '1 hour ago' --no-pager"
```

12. Check pods that were running on the not-ready node:

```bash
kubectl get pods -A --field-selector spec.nodeName=<node-name>
```

## Resolution

### kubelet/RKE2 service stopped

1. Restart the RKE2 service:

```bash
# For agent nodes:
ssh sre-admin@<node-ip> "sudo systemctl restart rke2-agent"

# For server nodes:
ssh sre-admin@<node-ip> "sudo systemctl restart rke2-server"
```

2. Wait 1-2 minutes and verify the node returns to Ready:

```bash
kubectl get node <node-name> -w
```

### Disk pressure

1. Identify large files or directories:

```bash
ssh sre-admin@<node-ip> "sudo du -sh /var/log/* | sort -rh | head -10"
ssh sre-admin@<node-ip> "sudo du -sh /var/lib/rancher/rke2/* | sort -rh | head -10"
```

2. Clean up container images:

```bash
ssh sre-admin@<node-ip> "sudo crictl --runtime-endpoint unix:///run/k3s/containerd/containerd.sock rmi --prune"
```

3. Rotate and compress old logs:

```bash
ssh sre-admin@<node-ip> "sudo journalctl --vacuum-size=500M"
```

### Memory pressure

1. Check for pods consuming excessive memory:

```bash
kubectl top pods -A --sort-by=memory | head -20
```

2. If a specific pod is the cause, check its memory limits and consider adjusting the HelmRelease values

3. If system-level memory pressure, check for non-Kubernetes processes:

```bash
ssh sre-admin@<node-ip> "ps aux --sort=-%mem | head -20"
```

### Network connectivity issues

1. Check if the node can reach the API server:

```bash
ssh sre-admin@<node-ip> "curl -k https://127.0.0.1:6443/healthz"
```

2. Check firewall rules:

```bash
ssh sre-admin@<node-ip> "sudo firewall-cmd --list-all"
```

3. Verify required ports are open (RKE2 uses 6443, 9345, 10250, 2379-2380)

### Node completely unresponsive

1. If SSH is not available, attempt console access via Proxmox:

```bash
# From a machine with Proxmox access
ssh root@<proxmox-host> "qm status <vmid>"
```

2. If the VM is stopped, start it:

```bash
ssh root@<proxmox-host> "qm start <vmid>"
```

3. If the VM is running but unresponsive, force reset:

```bash
ssh root@<proxmox-host> "qm reset <vmid>"
```

4. After the node comes back, verify it rejoins the cluster:

```bash
kubectl get nodes -w
```

### Cordon and drain (if node needs maintenance)

1. Cordon the node to prevent new pods:

```bash
kubectl cordon <node-name>
```

2. Drain existing pods:

```bash
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --timeout=300s
```

3. Perform maintenance
4. Uncordon when ready:

```bash
kubectl uncordon <node-name>
```

## Prevention

- Monitor node conditions via the `kube_node_status_condition` metric in Prometheus
- Set disk usage alerts at 80% (warning) and 90% (critical)
- Set memory usage alerts at 85% (warning) and 95% (critical)
- Configure log rotation on all nodes via Ansible (`/etc/logrotate.d/`)
- Ensure RKE2 service is enabled on boot: `systemctl enable rke2-agent` / `systemctl enable rke2-server`
- Maintain at least 3 worker nodes for pod scheduling redundancy
- Run periodic CIS benchmark scans via NeuVector to catch drift

## Escalation

- If the RKE2 server (control plane) node is not ready: this is a P1 incident -- the Kubernetes API may be unavailable
- If multiple nodes are not ready simultaneously: investigate shared infrastructure (network switch, storage, hypervisor)
- If the node cannot rejoin the cluster after restart: the node may need to be re-provisioned using Ansible
