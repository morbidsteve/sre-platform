# Runbook: Certificate Expiry

## Alert

- **Prometheus Alert:** `CertManagerCertExpirySoon` / `CertManagerCertNotReady`
- **Grafana Dashboard:** cert-manager dashboard
- **Firing condition:** Certificate will expire within 30 days, or Certificate resource is in a not-ready state

## Severity

**Critical** -- Expired certificates cause TLS failures across the platform, breaking ingress traffic, inter-service communication, and webhook connectivity.

## Impact

- Istio ingress gateway stops accepting HTTPS connections
- Webhook services (Kyverno, cert-manager) fail validation/mutation
- Internal mTLS certificates may fail rotation, degrading mesh communication
- Harbor, Grafana, Keycloak UI access via Istio gateway breaks

## Investigation Steps

1. List all certificates and their status:

```bash
kubectl get certificates -A
```

2. Check for certificates that are not ready or near expiry:

```bash
kubectl get certificates -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status,EXPIRY:.status.notAfter,RENEWAL:.status.renewalTime'
```

3. Describe the failing certificate for detailed condition messages:

```bash
kubectl describe certificate <certificate-name> -n <namespace>
```

4. Check cert-manager controller logs for errors:

```bash
kubectl logs -n cert-manager deployment/cert-manager --tail=100
```

5. Check the CertificateRequest resources associated with the failing certificate:

```bash
kubectl get certificaterequest -n <namespace>
kubectl describe certificaterequest <name> -n <namespace>
```

6. Check the Order and Challenge resources (for ACME/Let's Encrypt issuers):

```bash
kubectl get orders -A
kubectl get challenges -A
```

7. Verify the ClusterIssuer or Issuer is ready:

```bash
kubectl get clusterissuers
kubectl describe clusterissuer <issuer-name>
```

8. Check cert-manager webhook health:

```bash
kubectl get pods -n cert-manager
kubectl logs -n cert-manager deployment/cert-manager-webhook --tail=50
```

9. Check the cert-manager HelmRelease status:

```bash
flux get helmrelease cert-manager -n cert-manager
```

## Resolution

### Certificate stuck in not-ready state

1. Delete the failing CertificateRequest to trigger a new one:

```bash
kubectl delete certificaterequest <name> -n <namespace>
```

2. Force cert-manager to re-issue by adding a temporary annotation:

```bash
kubectl annotate certificate <name> -n <namespace> cert-manager.io/issue-temporary-certificate="true" --overwrite
```

3. Then remove it to trigger the real issuance:

```bash
kubectl annotate certificate <name> -n <namespace> cert-manager.io/issue-temporary-certificate-
```

### ClusterIssuer not ready (self-signed CA)

1. Check the CA secret exists:

```bash
kubectl get secret -n cert-manager | grep ca
```

2. If the root CA secret is missing, recreate it. Check the ClusterIssuer spec for the expected secret name:

```bash
kubectl describe clusterissuer sre-ca-issuer
```

3. Re-apply the cert-manager manifests via Flux:

```bash
flux reconcile helmrelease cert-manager -n cert-manager
```

### ACME challenge failure (Let's Encrypt)

1. Check challenge status:

```bash
kubectl describe challenge <name> -n <namespace>
```

2. Verify DNS is resolving correctly for the domain
3. Verify the HTTP-01 solver can reach the challenge endpoint (check Istio gateway and VirtualService)

### Manual certificate renewal

1. Delete the existing secret to force re-issuance:

```bash
kubectl delete secret <tls-secret-name> -n <namespace>
```

2. cert-manager will detect the missing secret and re-issue automatically

### cert-manager pods not running

1. Check the HelmRelease:

```bash
flux get helmrelease cert-manager -n cert-manager
```

2. If the release is in a failed state, suspend and resume:

```bash
flux suspend helmrelease cert-manager -n cert-manager
flux resume helmrelease cert-manager -n cert-manager
```

3. Force reconciliation:

```bash
flux reconcile helmrelease cert-manager -n cert-manager --with-source
```

## Prevention

- Monitor the `certmanager_certificate_expiration_timestamp_seconds` metric in Prometheus
- Set alerting thresholds at 30 days (warning) and 7 days (critical) before expiry
- Ensure cert-manager has sufficient RBAC to create/update secrets in all namespaces
- Test certificate renewal in a staging environment before production
- Keep cert-manager updated via the Flux HelmRelease version pin (currently `1.14.4`)
- Verify ClusterIssuer health after any cert-manager upgrade

## Escalation

- If certificate issuance fails after multiple retries: check upstream issuer (Let's Encrypt rate limits, internal CA health)
- If cert-manager pods are crash-looping: escalate to platform team lead
- If the issue affects Istio gateway TLS termination: this is a P1 incident affecting all external traffic
