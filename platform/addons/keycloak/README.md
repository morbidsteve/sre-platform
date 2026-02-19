# Keycloak Identity Provider (Addon)

SSO/OIDC provider for all platform and application UIs.

## What It Does

- Centralized SSO for Grafana, Harbor, ArgoCD, Backstage, NeuVector
- SAML/LDAP federation for Active Directory integration
- RBAC groups mapped to Kubernetes ClusterRoles
- MFA enforcement for all users
- DoD CAC/PKI authentication support for government deployments

## NIST Controls

- AC-2 (Account Management) — Centralized identity with automated deprovisioning
- AC-17 (Remote Access) — MFA for all management interfaces
- IA-2 (Identification and Authentication) — SSO with MFA enforcement

## Dependencies

- Depends on: Istio, cert-manager, OpenBao (for database credentials), Monitoring
