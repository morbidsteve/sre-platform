# Runbook: Istio mTLS Failure

## Alert

- **Prometheus Alert:** `IstioMTLSError` / `IstioPilotConflictOutbound` / `Istio5xxResponseRate`
- **Grafana Dashboard:** Istio Mesh dashboard
- **Firing condition:** Services report TLS handshake failures, 503 errors from sidecars, or PeerAuthentication STRICT mode rejecting connections

## Severity

**Critical** -- mTLS failures break service-to-service communication within the mesh. In STRICT mode (the SRE platform default), any service without a valid Istio sidecar proxy will be unable to communicate with mesh services.

## Impact

- Service-to-service communication fails with 503 or connection reset errors
- Pods without Istio sidecars cannot reach mesh services (STRICT mTLS rejects plaintext)
- Application health checks may fail if probes go through the sidecar
- Ingress traffic through the Istio gateway may be affected
- Compliance violation: NIST SC-8 (Transmission Confidentiality) control is not being met

## Investigation Steps

1. Check Istiod (control plane) status:

```bash
kubectl get pods -n istio-system -l app=istiod
kubectl logs -n istio-system deployment/istiod --tail=100
```

2. Check the PeerAuthentication policy:

```bash
kubectl get peerauthentication -A
```

3. Verify mTLS mode for a specific namespace:

```bash
kubectl get peerauthentication -n <namespace> -o yaml
```

4. Check proxy status for a failing pod:

```bash
istioctl proxy-status
```

5. If `istioctl` is not available, check the sidecar proxy logs:

```bash
kubectl logs <pod-name> -n <namespace> -c istio-proxy --tail=100
```

6. Check for TLS handshake errors:

```bash
kubectl logs <pod-name> -n <namespace> -c istio-proxy --tail=200 | grep -i "tls\|handshake\|ssl\|certificate"
```

7. Check if the destination service has sidecar injection enabled:

```bash
kubectl get namespace <namespace> --show-labels | grep istio-injection
```

8. Verify the sidecar is present on both source and destination pods:

```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[*].name}'
```

9. Check Istio DestinationRules that might override mTLS settings:

```bash
kubectl get destinationrules -A
kubectl get destinationrules -A -o yaml | grep -B 5 -A 5 "tls"
```

10. Check the Istio HelmRelease status:

```bash
flux get helmrelease istio-base -n istio-system
flux get helmrelease istiod -n istio-system
```

11. Verify certificates are valid in the proxy:

```bash
kubectl exec <pod-name> -n <namespace> -c istio-proxy -- openssl s_client -connect <destination-svc>.<destination-ns>.svc.cluster.local:<port> -tls1_2 2>/dev/null | openssl x509 -noout -dates
```

## Resolution

### Pod missing Istio sidecar

1. Verify the namespace has the injection label:

```bash
kubectl get namespace <namespace> -o jsonpath='{.metadata.labels.istio-injection}'
```

2. If missing, add the label:

```bash
kubectl label namespace <namespace> istio-injection=enabled --overwrite
```

3. Restart the pods to inject the sidecar:

```bash
kubectl rollout restart deployment <name> -n <namespace>
```

### mTLS failing between namespaces

1. Check if both namespaces have STRICT PeerAuthentication:

```bash
kubectl get peerauthentication -n <source-namespace>
kubectl get peerauthentication -n <destination-namespace>
```

2. Ensure no DestinationRule is disabling mTLS:

```bash
kubectl get destinationrules -n <namespace> -o yaml | grep -A 10 "trafficPolicy"
```

3. If a service needs to accept plaintext (e.g., external health check), create a permissive PeerAuthentication for that specific port:

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: allow-plaintext-health
  namespace: <namespace>
spec:
  selector:
    matchLabels:
      app: <app-name>
  portLevelMtls:
    8080:
      mode: PERMISSIVE
```

### Platform namespace communication (Istio injection disabled)

Platform namespaces (kube-system, monitoring, logging, kyverno, etc.) do not have Istio injection enabled. If a platform service needs to reach a mesh service:

1. Create a DestinationRule to disable mTLS for that specific service:

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: <service>-plaintext
  namespace: <mesh-namespace>
spec:
  host: <service>.<mesh-namespace>.svc.cluster.local
  trafficPolicy:
    tls:
      mode: DISABLE
```

2. Or set the PeerAuthentication to PERMISSIVE for that service

### Istiod certificate rotation failure

1. Check Istiod logs for certificate errors:

```bash
kubectl logs -n istio-system deployment/istiod --tail=200 | grep -i "cert\|ca\|root"
```

2. Check if the Istio root CA secret exists:

```bash
kubectl get secret istio-ca-secret -n istio-system
```

3. If certificates are expired, restart Istiod to trigger re-issuance:

```bash
kubectl rollout restart deployment istiod -n istio-system
```

4. Then restart all application pods to get new certificates:

```bash
for ns in $(kubectl get namespaces -l istio-injection=enabled -o name); do
  kubectl rollout restart deployment -n ${ns##*/} 2>/dev/null
done
```

### Istio sidecar injection webhook failure

1. Check the webhook configuration:

```bash
kubectl get mutatingwebhookconfigurations istio-sidecar-injector -o yaml
```

2. Verify the webhook service is reachable:

```bash
kubectl get svc -n istio-system istiod
kubectl get endpoints -n istio-system istiod
```

3. If the webhook is down, restart Istiod:

```bash
kubectl rollout restart deployment istiod -n istio-system
```

## Prevention

- Verify sidecar injection is working after any Istio upgrade
- Monitor `istio_requests_total` with `response_code=503` for early detection of mTLS issues
- Monitor `pilot_proxy_convergence_time` for slow configuration propagation
- Ensure all tenant namespaces have `istio-injection: enabled` label (enforced by Kyverno)
- Document which platform namespaces intentionally do NOT have Istio injection
- Test mTLS connectivity after PeerAuthentication or DestinationRule changes
- Keep Istiod and proxy versions in sync (currently `1.25.2`)

## Escalation

- If Istiod is completely down: this is a P1 -- no new proxies can connect, and certificate rotation stops
- If mTLS failures affect the Istio ingress gateway: all external traffic is affected -- escalate immediately
- If certificate rotation failure is cluster-wide: all proxy-to-proxy communication will eventually fail as certificates expire
