# ArgoCD (Optional Addon)

ArgoCD as an optional GitOps UI for application teams who prefer its visual interface over the Flux CLI.

## Purpose

While Flux CD is the primary GitOps engine for platform services, some app teams prefer ArgoCD's web UI for managing their application deployments. This addon provides ArgoCD scoped to tenant namespaces only — it does not manage platform-level resources.

## NIST Controls

- CM-3 (Configuration Change Control) — Git-based change tracking with approval workflows

## Dependencies

- Depends on: Istio, Keycloak (for SSO)
