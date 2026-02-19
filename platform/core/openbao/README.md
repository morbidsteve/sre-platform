# OpenBao Secrets Management

OpenBao (open-source Vault fork) with External Secrets Operator for Kubernetes-native secret delivery.

## Components

- **OpenBao** — HA secrets management with Raft storage and auto-unseal
- **External Secrets Operator (ESO)** — Syncs OpenBao secrets to Kubernetes Secrets

## What It Does

- Centralized secret storage with encryption at rest
- Dynamic secret generation (database credentials, PKI certificates)
- Automatic secret rotation policies
- Kubernetes auth method (pods authenticate via ServiceAccount)
- Audit logging forwarded to Loki

## NIST Controls

- IA-5 (Authenticator Management) — Secret rotation and lifecycle
- SC-12 (Cryptographic Key Management) — Centralized key/secret store
- SC-28 (Protection at Rest) — Encrypted storage backend
- AU-2 (Audit Events) — All secret access is logged

## Dependencies

- Depends on: Istio, Monitoring
- ESO depends on: OpenBao
