# Keycloak Identity Provider (Addon)

SSO/OIDC provider for all platform and application UIs in the SRE platform.

## What It Does

- **Centralized SSO** — Single sign-on for Grafana, Harbor, ArgoCD, Backstage, NeuVector
- **SAML/LDAP Federation** — Active Directory and DoD JEDI integration
- **RBAC Group Mapping** — Groups mapped to Kubernetes ClusterRoles
- **MFA Enforcement** — Multi-factor authentication for all users
- **DoD CAC/PKI Support** — Certificate-based authentication for government deployments

## Components

| Resource | Purpose |
|----------|---------|
| `namespace.yaml` | Namespace with Istio sidecar injection |
| `helmrelease.yaml` | Bitnami Keycloak chart with bundled PostgreSQL |
| `virtualservice.yaml` | Istio VirtualService for `keycloak.apps.sre.example.com` |
| `network-policies/default-deny.yaml` | Default deny all ingress/egress |
| `network-policies/allow-keycloak.yaml` | Explicit allows for Keycloak traffic |

## Helm Chart Version

Bitnami Keycloak chart is pinned to version `19.4.1`.

## Architecture

- **Keycloak** (2 replicas) — OIDC/SAML identity provider with Infinispan clustering
- **PostgreSQL** (bundled) — Database for Keycloak realm and user data
- **Istio Integration** — TLS termination at edge via Istio gateway (proxy mode: edge)

## Configuration

### Admin Credentials

Admin credentials are stored in the `keycloak-admin-credentials` Kubernetes Secret, managed via External Secrets Operator from OpenBao. The secret must contain:

```yaml
auth:
  adminPassword: "changeme"
```

### OIDC Clients

After deployment, configure OIDC clients for each platform UI:

| Client | Redirect URI |
|--------|-------------|
| Grafana | `https://grafana.apps.sre.example.com/login/generic_oauth` |
| Harbor | `https://harbor.apps.sre.example.com/c/oidc/callback` |
| NeuVector | `https://neuvector.apps.sre.example.com/` |

### Group-Based RBAC

| Keycloak Group | Kubernetes ClusterRole | Description |
|----------------|----------------------|-------------|
| `platform-admins` | `cluster-admin` | Full platform access |
| `developers` | `edit` (namespace-scoped) | Deploy and manage apps |
| `viewers` | `view` (namespace-scoped) | Read-only access |

### Production Mode

The chart runs with `production: true` and `proxy: edge`, meaning Keycloak trusts the Istio proxy for TLS termination.

## NIST Controls

| Control | Implementation |
|---------|---------------|
| AC-2 | Centralized identity with automated deprovisioning |
| AC-14 | No permitted actions without identification via OIDC |
| AC-17 | MFA for all remote management interfaces |
| IA-2 | SSO with MFA enforcement for organizational users |
| IA-5 | Password policies, certificate rotation via OpenBao |
| IA-8 | Authentication enforcement for non-organizational users |

## Dependencies

- Depends on: Istio (mTLS, VirtualService), cert-manager (TLS certificates), OpenBao (database credentials), Monitoring (ServiceMonitor)

## Troubleshooting

```bash
# Check Keycloak pods
kubectl get pods -n keycloak

# View Keycloak logs
kubectl logs -n keycloak -l app.kubernetes.io/name=keycloak --tail=100

# Check PostgreSQL
kubectl get pods -n keycloak -l app.kubernetes.io/name=postgresql

# Access Keycloak admin console (port-forward for debugging)
kubectl port-forward -n keycloak svc/keycloak 8080:80

# Verify Istio sidecar injection
kubectl get pods -n keycloak -o jsonpath='{.items[*].spec.containers[*].name}' | tr ' ' '\n' | sort -u
```
