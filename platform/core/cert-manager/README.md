# cert-manager

Automated TLS certificate issuance and lifecycle management.

## What It Does

- Issues TLS certificates from Let's Encrypt or internal CA
- Rotates certificates automatically before expiry
- Provides certificates for Istio ingress gateway
- Supports DoD PKI / CAC certificate chains for government deployments

## NIST Controls

- SC-12 (Cryptographic Key Management) — Automated certificate lifecycle
- IA-5 (Authenticator Management) — Certificate rotation policies

## ClusterIssuers

- `letsencrypt-staging` — For dev/test environments
- `letsencrypt-production` — For production with rate limits
- `internal-ca` — Self-signed CA for internal services

## Dependencies

- Depends on: Istio (for ingress gateway cert)
