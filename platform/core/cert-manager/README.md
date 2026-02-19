# cert-manager

Automated TLS certificate issuance and rotation for the SRE platform. Manages certificates for the Istio ingress gateway, internal service communication, and workload identities.

## Components

| Resource | Purpose |
|----------|---------|
| `helmrelease.yaml` | cert-manager Helm chart (v1.14.4) |
| `clusterissuer-selfsigned.yaml` | Self-signed root CA + internal CA chain |
| `clusterissuer-letsencrypt.yaml` | Let's Encrypt issuers (staging + production) |
| `certificate-gateway.yaml` | Wildcard TLS cert for Istio gateway |
| `network-policies/` | Default deny + explicit allows |

## ClusterIssuers

| Issuer | Use Case |
|--------|----------|
| `selfsigned-root` | Bootstrap only — creates the root CA |
| `sre-internal-ca` | Internal platform certificates (dev, air-gap, or as intermediate) |
| `letsencrypt-staging` | Dev/test environments (untrusted, no rate limits) |
| `letsencrypt-production` | Production environments (trusted, rate limited) |

## Certificate Chain

```
selfsigned-root (ClusterIssuer)
    ↓ issues
sre-root-ca (Certificate, ECDSA P-384, 10yr)
    ↓ backs
sre-internal-ca (ClusterIssuer)
    ↓ issues
sre-wildcard-tls (Certificate, *.apps.sre.example.com, 90d)
```

## Configuration

### Switching issuers per environment

The gateway certificate defaults to `sre-internal-ca`. For production with public DNS, update the `issuerRef` in `certificate-gateway.yaml` to `letsencrypt-production`.

### Adding certificates for new services

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: my-service-tls
  namespace: my-namespace
spec:
  secretName: my-service-tls
  dnsNames:
    - my-service.apps.sre.example.com
  issuerRef:
    name: sre-internal-ca
    kind: ClusterIssuer
```

## Dependencies

- Depends on: Istio (for ingress gateway cert)

## NIST Controls

| Control | Implementation |
|---------|---------------|
| IA-5 | Automated certificate lifecycle management |
| SC-12 | Cryptographic key generation and rotation |
| SC-13 | ECDSA key pairs for FIPS-compliant cryptography |

## Troubleshooting

```bash
# Check certificate status
kubectl get certificates -A
kubectl describe certificate sre-wildcard-tls -n istio-system

# Check issuer status
kubectl get clusterissuers
kubectl describe clusterissuer sre-internal-ca

# View cert-manager logs
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager
```
