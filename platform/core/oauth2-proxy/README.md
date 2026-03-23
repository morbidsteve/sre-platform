# OAuth2 Proxy

## What It Does

OAuth2 Proxy provides SSO authentication for all platform web UIs. It integrates with Keycloak as the OIDC provider and works with Istio's ext-authz to gate access to services.

## Configuration

- **Provider**: Keycloak (OIDC)
- **Upstream**: Configured per-service via Istio VirtualService routing
- **Cookie**: `_oauth2_proxy` session cookie
- **Excluded services**: Keycloak, Harbor, NeuVector (they have their own auth)

## Dependencies

- Keycloak (OIDC provider)
- Istio (ext-authz integration)
- cert-manager (TLS certificates)

## NIST Controls

| Control | Implementation |
|---------|---------------|
| AC-2 | Centralized account management via Keycloak SSO |
| AC-14 | Enforces authentication for all platform services |
| IA-2 | OIDC-based identification and authentication |

## Troubleshooting

```bash
# Check OAuth2 Proxy pods
kubectl get pods -n oauth2-proxy

# Check logs for auth failures
kubectl logs -n oauth2-proxy -l app.kubernetes.io/name=oauth2-proxy

# Test OIDC discovery
curl -sk https://keycloak.apps.sre.example.com/realms/sre/.well-known/openid-configuration
```
