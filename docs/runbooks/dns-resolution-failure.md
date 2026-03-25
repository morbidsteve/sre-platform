# Runbook: DNS Resolution Failure

## Alert

- **Prometheus Alert:** `CoreDNSDown` / `CoreDNSLatencyHigh` / `KubeDNSErrors`
- **Grafana Dashboard:** CoreDNS dashboard, Cluster Health dashboard
- **Firing condition:** Pods cannot resolve DNS names (internal services or external hostnames), CoreDNS pods are not running, or DNS query error rates are elevated

## Severity

**Critical** -- DNS is fundamental to all Kubernetes networking. Service-to-service communication, external API calls, and image pulls all depend on DNS resolution. A DNS failure affects the entire cluster.

## Impact

- All service-to-service communication via DNS names fails (pods cannot reach each other)
- External API calls from pods fail (cannot resolve external hostnames)
- New pod scheduling may fail if image pulls require DNS resolution
- Istio service mesh communication degrades (Istio relies on DNS for service discovery)
- Liveness and readiness probes that depend on network calls may fail, triggering pod restarts cluster-wide
- Cascading failures across all namespaces

## Investigation Steps

1. Check if CoreDNS pods are running:

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
```

2. Check CoreDNS pod logs for errors:

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=100
```

3. Test DNS resolution from a debug pod:

```bash
kubectl run dns-debug --rm -it --image=docker.io/alpine:3.21.2 --restart=Never -- nslookup kubernetes.default.svc.cluster.local
```

4. Test resolution of an external hostname:

```bash
kubectl run dns-debug --rm -it --image=docker.io/alpine:3.21.2 --restart=Never -- nslookup google.com
```

5. Test resolution of an internal service:

```bash
kubectl run dns-debug --rm -it --image=docker.io/alpine:3.21.2 --restart=Never -- nslookup grafana.monitoring.svc.cluster.local
```

6. Check the CoreDNS ConfigMap for misconfigurations:

```bash
kubectl get configmap coredns -n kube-system -o yaml
```

7. Check if the CoreDNS service has endpoints:

```bash
kubectl get endpoints kube-dns -n kube-system
```

8. Check CoreDNS Prometheus metrics for error rates:

```promql
rate(coredns_dns_responses_total{rcode="SERVFAIL"}[5m])
```

9. Check if NetworkPolicies are blocking DNS traffic:

```bash
kubectl get networkpolicies -A -o json | jq -r '
  .items[] |
  select(.spec.policyTypes[]? == "Egress") |
  "\(.metadata.namespace)/\(.metadata.name)"
'
```

10. Check if the upstream DNS servers are reachable from the nodes:

```bash
kubectl debug node/<node-name> -it --image=docker.io/alpine:3.21.2 -- nslookup google.com 8.8.8.8
```

11. Check node-level DNS configuration:

```bash
kubectl debug node/<node-name> -it --image=docker.io/alpine:3.21.2 -- cat /host/etc/resolv.conf
```

## Resolution

### Cause: CoreDNS pods are not running

Restart CoreDNS:

```bash
kubectl rollout restart deployment/rke2-coredns-rke2-coredns -n kube-system
```

If the pods are in CrashLoopBackOff, check the logs for the specific error:

```bash
kubectl logs -n kube-system -l k8s-app=kube-dns --previous
```

Common causes of CoreDNS crashes:
- Corrupted ConfigMap (syntax error in Corefile)
- Resource exhaustion (OOMKilled -- see pod-oomkilled runbook)
- Node failure (the node hosting CoreDNS is down)

### Cause: CoreDNS ConfigMap misconfiguration

If the Corefile has been modified and is causing errors:

1. View the current Corefile:

```bash
kubectl get configmap coredns -n kube-system -o jsonpath='{.data.Corefile}'
```

2. A working RKE2 default Corefile looks like:

```
.:53 {
    errors
    health {
      lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    hosts /etc/coredns/NodeHosts {
      ttl 60
      reload 15s
      fallthrough
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
```

3. If modified, restore the default and restart CoreDNS.

### Cause: NetworkPolicy blocking DNS egress

Pods need to reach CoreDNS on port 53. If a namespace has a default-deny egress NetworkPolicy, it must explicitly allow DNS:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: <namespace>
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

Apply this to any namespace with default-deny egress that is experiencing DNS failures.

### Cause: Upstream DNS server unreachable

If CoreDNS can resolve internal names but not external ones:

1. Check the upstream forwarder in the CoreDNS Corefile (usually `forward . /etc/resolv.conf`)
2. Verify the node's `/etc/resolv.conf` has valid nameservers
3. Check if there is a firewall or network issue blocking outbound DNS (UDP/TCP 53)

### Cause: CoreDNS resource exhaustion

If CoreDNS is OOMKilled or CPU throttled under high query load:

```bash
# Check current resource allocation
kubectl get deployment rke2-coredns-rke2-coredns -n kube-system -o jsonpath='{.spec.template.spec.containers[0].resources}'
```

Increase resources if needed (note: RKE2 manages this deployment, so changes may be reverted on upgrade):

```bash
kubectl patch deployment rke2-coredns-rke2-coredns -n kube-system --type='json' -p='[
  {"op": "replace", "path": "/spec/template/spec/containers/0/resources/limits/memory", "value": "256Mi"},
  {"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/memory", "value": "128Mi"}
]'
```

## Prevention

- Ensure all namespace NetworkPolicies include an explicit DNS egress allow rule
- Monitor CoreDNS metrics in Grafana: query rate, error rate, latency, cache hit ratio
- Set up a Blackbox Exporter probe for DNS resolution (included in synthetic monitoring)
- Keep CoreDNS replicas at 2+ for high availability
- Do not modify the CoreDNS ConfigMap unless absolutely necessary -- let RKE2 manage it
- Include DNS egress rules in the SRE app template Helm charts by default

## Escalation

- CoreDNS completely down with no pods running: P1 -- all cluster networking is affected
- Intermittent DNS failures under load: investigate CoreDNS resource limits and replica count
- DNS failures only for external resolution: check network/firewall rules -- escalate to the network team
- DNS failures after a node reboot: check if CoreDNS was scheduled on the rebooted node and wait for rescheduling
