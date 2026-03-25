# Runbook: Pod OOMKilled

## Alert

- **Prometheus Alert:** `KubeContainerOOMKilled` / `HighPodRestartRate`
- **Grafana Dashboard:** Cluster Health dashboard, Namespace Resource Usage dashboard
- **Firing condition:** A container is terminated by the kernel OOM killer because it exceeded its memory limit, or a pod is restarting frequently due to repeated OOMKill events

## Severity

**Warning** -- A single OOMKill may be transient (spike in traffic, large request). Repeated OOMKills indicate a memory limit misconfiguration or a memory leak and require immediate attention.

## Impact

- The affected container is terminated and restarted, causing brief service interruption
- If the pod is part of a Deployment with a single replica, there is a full outage until the restart completes
- Repeated OOMKills cause CrashLoopBackOff, extending downtime with exponential backoff delays
- Data in non-persistent storage (emptyDir, tmpfs) is lost on each OOMKill
- If multiple pods on the same node are OOMKilled, the node may enter MemoryPressure and evict additional pods

## Investigation Steps

1. Find pods that have been OOMKilled recently:

```bash
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.status.containerStatuses[]?.lastState.terminated.reason == "OOMKilled") |
  "\(.metadata.namespace)/\(.metadata.name) - OOMKilled at \(.status.containerStatuses[0].lastState.terminated.finishedAt)"
'
```

2. Check the events for OOMKill details:

```bash
kubectl get events -A --field-selector reason=OOMKilling --sort-by='.lastTimestamp'
```

3. Check the container's current memory limit and actual usage:

```bash
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Limits\|Requests\|Last State\|Restart Count"
```

4. Check real-time memory usage vs limits for the pod:

```bash
kubectl top pod <pod-name> -n <namespace> --containers
```

5. Check memory usage across the namespace to identify which pods are consuming the most:

```bash
kubectl top pods -n <namespace> --sort-by=memory
```

6. Query Prometheus for memory usage trends over time (run in Grafana Explore or via curl):

```promql
container_memory_working_set_bytes{namespace="<namespace>", pod="<pod-name>"}
```

7. Compare actual usage to the configured limit:

```promql
container_memory_working_set_bytes{namespace="<namespace>", pod=~"<pod-prefix>.*"}
  /
container_spec_memory_limit_bytes{namespace="<namespace>", pod=~"<pod-prefix>.*"}
```

8. Check if the OOMKill correlates with traffic spikes:

```promql
rate(istio_requests_total{destination_workload="<workload-name>", destination_workload_namespace="<namespace>"}[5m])
```

9. Check the node's overall memory status:

```bash
kubectl top nodes
kubectl describe node <node-name> | grep -A 10 "Allocated resources"
```

10. Check if the container has a memory leak by looking at usage growth over time:

```promql
deriv(container_memory_working_set_bytes{namespace="<namespace>", pod=~"<pod-prefix>.*"}[1h])
```

## Resolution

### Cause: Memory limit too low for normal operation

The container legitimately needs more memory than its limit allows. Increase the memory limit in the Deployment or HelmRelease values:

```yaml
resources:
  requests:
    memory: 256Mi    # Set to observed P50 usage
  limits:
    memory: 512Mi    # Set to 2x observed P95 usage
```

If using an SRE app template, update the tenant's values file:

```yaml
app:
  resources:
    requests:
      memory: 256Mi
    limits:
      memory: 512Mi
```

After updating, verify Flux reconciles the change:

```bash
flux reconcile kustomization <kustomization-name> --with-source
kubectl rollout status deployment/<deployment-name> -n <namespace>
```

### Cause: Memory leak in the application

If memory usage grows continuously without releasing, the application has a memory leak.

1. Collect evidence of the leak pattern:

```promql
# Memory grows linearly over time without flattening
container_memory_working_set_bytes{namespace="<namespace>", pod=~"<pod-prefix>.*"}
```

2. As a temporary mitigation, increase the limit and add a liveness probe that restarts the pod before it hits the limit:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
```

3. Report the leak to the application team with the Prometheus graph as evidence.

### Cause: JVM or runtime not respecting container limits

For JVM applications, the JVM may not respect cgroup memory limits by default:

```yaml
env:
  - name: JAVA_OPTS
    value: "-XX:MaxRAMPercentage=75.0 -XX:+UseContainerSupport"
```

For Node.js applications:

```yaml
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=384"  # Set to ~75% of memory limit in MB
```

### Cause: Node-level memory pressure

If multiple pods are being OOMKilled across the same node, the node itself is under memory pressure:

```bash
# Check if the node has MemoryPressure
kubectl describe node <node-name> | grep -A 5 "Conditions"

# Cordon the node to prevent new scheduling while investigating
kubectl cordon <node-name>

# Identify the top memory consumers on that node
kubectl get pods --field-selector spec.nodeName=<node-name> -A -o json | \
  jq -r '.items[] | "\(.metadata.namespace)/\(.metadata.name)"' | \
  while read pod; do kubectl top pod ${pod##*/} -n ${pod%%/*} 2>/dev/null; done
```

## Prevention

- Set memory requests to the observed P50 usage and limits to 2x the P95 usage
- Use Vertical Pod Autoscaler (VPA) in recommendation mode to get right-sizing suggestions
- Configure HPA with memory-based scaling to add replicas before individual pods hit limits
- Monitor the `container_memory_working_set_bytes / container_spec_memory_limit_bytes` ratio and alert at 80%
- Require all deployments to have memory limits (enforced by Kyverno `require-resource-limits` policy)
- Set up Grafana alerts on memory growth rate to catch leaks early
- For JVM apps, always set `-XX:+UseContainerSupport` and `-XX:MaxRAMPercentage`

## Escalation

- If a platform component (Prometheus, Loki, Istio) is being OOMKilled: this is a P1 -- platform observability or security may be degraded
- If the same pod is OOMKilled more than 5 times in an hour despite limit increases: escalate to the application team for memory leak investigation
- If multiple nodes are under memory pressure simultaneously: escalate to the infrastructure team for capacity planning
