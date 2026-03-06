# Runbook: High Memory Usage

## Alert

- **Prometheus Alert:** `KubeMemoryOvercommit` / `KubePodMemoryUsageHigh` / `NodeMemoryPressure`
- **Grafana Dashboard:** Cluster Health dashboard, Namespace Resource Usage dashboard
- **Firing condition:** Node memory utilization exceeds 85% (warning) or 95% (critical), or a pod is consuming more than 90% of its memory limit

## Severity

**Warning** (node-level) / **Critical** (if OOMKill is occurring or node enters MemoryPressure condition)

## Impact

- Pods may be OOMKilled, causing service disruption
- Kubernetes may start evicting pods from the node
- DaemonSet pods (Alloy, NeuVector enforcer) may be evicted, causing monitoring/security gaps
- If the node enters MemoryPressure, new pods cannot be scheduled there
- Prometheus may lose scrape targets if its pods are evicted

## Investigation Steps

1. Check node memory pressure conditions:

```bash
kubectl get nodes -o custom-columns='NAME:.metadata.name,MEMORY_PRESSURE:.status.conditions[?(@.type=="MemoryPressure")].status'
```

2. Check node-level memory usage:

```bash
kubectl top nodes
```

3. Find the top memory-consuming pods across the cluster:

```bash
kubectl top pods -A --sort-by=memory | head -20
```

4. Check for pods that have been OOMKilled:

```bash
kubectl get pods -A -o json | jq -r '.items[] | select(.status.containerStatuses[]?.lastState.terminated.reason == "OOMKilled") | "\(.metadata.namespace)/\(.metadata.name) - OOMKilled"'
```

5. Check for recent OOMKill events:

```bash
kubectl get events -A --field-selector reason=OOMKilling --sort-by='.lastTimestamp'
```

6. Check memory usage for a specific pod:

```bash
kubectl top pod <pod-name> -n <namespace> --containers
```

7. Compare actual usage against limits:

```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[*].resources}' | jq .
```

8. Check if memory usage is trending upward (potential leak) via Grafana:

```
Query: container_memory_working_set_bytes{namespace="<namespace>", pod="<pod>"}
```

9. Check node-level memory details via SSH:

```bash
ssh sre-admin@<node-ip> "free -h && cat /proc/meminfo | head -10"
```

10. Check for non-Kubernetes processes consuming memory:

```bash
ssh sre-admin@<node-ip> "ps aux --sort=-%mem | head -15"
```

## Resolution

### Pod approaching memory limit (potential OOMKill)

1. Check if the current memory limit is appropriate:

```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[0].resources.limits.memory}'
```

2. Increase the memory limit in the HelmRelease values. For platform components, edit the corresponding HelmRelease:

```bash
# Example: increase Prometheus memory
kubectl get helmrelease kube-prometheus-stack -n monitoring -o yaml | grep -A 5 "memory"
```

3. Update the HelmRelease in Git and let Flux reconcile, or for immediate relief:

```bash
flux suspend helmrelease <name> -n <namespace>
kubectl edit deployment <name> -n <namespace>  # Temporary -- Flux will revert
flux resume helmrelease <name> -n <namespace>
```

### Known memory-intensive platform components

| Component | Namespace | Default Limit | Typical Usage | Notes |
|-----------|-----------|---------------|---------------|-------|
| Prometheus | monitoring | 2Gi | 1-1.5Gi | Grows with metrics cardinality |
| NeuVector controller | neuvector | 2Gi | 500Mi-1.5Gi | Grows with network rule count |
| Loki | logging | -- | 256-512Mi | Grows with log volume |
| Grafana | monitoring | 512Mi | 200-400Mi | Dashboard count affects memory |
| Kyverno admission | kyverno | 512Mi | 200-400Mi | Grows with policy count |

### Node-level memory pressure

1. Identify pods that can be safely evicted or scaled down:

```bash
kubectl get pods -A --field-selector spec.nodeName=<node-name> --sort-by='.spec.containers[0].resources.requests.memory'
```

2. If a non-critical pod is consuming too much memory, delete it to give the node breathing room:

```bash
kubectl delete pod <pod-name> -n <namespace>
```

3. If the node is consistently under memory pressure, consider:
   - Adding more memory to the VM (Proxmox: `qm set <vmid> --memory <MB>`)
   - Adding another worker node to distribute the load
   - Reducing replica counts for non-critical services

### Memory leak investigation

1. Check if memory usage is monotonically increasing (does not drop after garbage collection):

```
Grafana query: rate(container_memory_working_set_bytes{namespace="<ns>", pod=~"<pod>.*"}[1h])
```

2. If a memory leak is confirmed:
   - Restart the affected pod as a temporary fix
   - Open a bug report against the upstream chart or application
   - Set a lower memory limit to force periodic restarts (not ideal, but prevents node pressure)

### Emergency: Node at 95%+ memory

1. Cordon the node to prevent new scheduling:

```bash
kubectl cordon <node-name>
```

2. Delete the largest non-critical pods:

```bash
kubectl delete pod <pod-name> -n <namespace> --grace-period=10
```

3. Once memory drops, investigate and fix the root cause

4. Uncordon the node:

```bash
kubectl uncordon <node-name>
```

## Prevention

- Set memory requests and limits on all pods (enforced by Kyverno `require-resource-limits` policy)
- Set LimitRange in all tenant namespaces to prevent unbounded memory consumption
- Monitor `container_memory_working_set_bytes` / `container_spec_memory_limit_bytes` ratio in Prometheus
- Alert at 80% of memory limit per pod (warning) to catch issues before OOMKill
- Right-size platform component memory limits based on actual usage patterns
- Review memory trends weekly in the Namespace Resource Usage Grafana dashboard

## Escalation

- If a platform component is consistently OOMKilled: file an issue to increase limits in the HelmRelease and update the Git repo
- If a node is in MemoryPressure and pods cannot be rescheduled: add capacity immediately (new node or memory upgrade)
- If a memory leak is confirmed in a platform component: report upstream and implement a restart CronJob as a workaround
