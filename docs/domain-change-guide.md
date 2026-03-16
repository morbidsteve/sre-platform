# Domain Change Guide

How to change the SRE platform domain from `apps.sre.example.com` to your production domain.

## Overview

The SRE platform uses Flux CD's `postBuild.substituteFrom` feature to inject the domain into all Kubernetes manifests at reconciliation time. The domain is defined in a single ConfigMap (`sre-domain-config`) in the `flux-system` namespace.

**Variables defined in `sre-domain-config`:**

| Variable | Default Value | Used For |
|----------|--------------|----------|
| `SRE_DOMAIN` | `apps.sre.example.com` | All service hostnames, TLS certificates, OAuth2 cookie domains |
| `SRE_REGISTRY` | `harbor.apps.sre.example.com` | Container image registry references |
| `SRE_KEYCLOAK_URL` | `https://keycloak.apps.sre.example.com` | Keycloak OIDC endpoint references |
| `SRE_CLUSTER_NAME` | `sre-lab` | Cluster identifier in Backstage and monitoring |

## Step 1: Edit the Domain ConfigMap

Edit the file for your environment profile:

| Environment | File |
|-------------|------|
| Default (dev) | `platform/core/config/domain-config.yaml` |
| Single-node | `platform/environments/single-node/domain-config.yaml` |
| Small cluster | `platform/environments/small/domain-config.yaml` |
| Production | `platform/environments/production/domain-config.yaml` |

Change all four variables to match your new domain:

```yaml
data:
  SRE_DOMAIN: "apps.mycompany.com"
  SRE_REGISTRY: "harbor.apps.mycompany.com"
  SRE_KEYCLOAK_URL: "https://keycloak.apps.mycompany.com"
  SRE_CLUSTER_NAME: "prod-cluster-01"
```

## Step 2: Commit and Push

```bash
git add platform/core/config/domain-config.yaml
# Or the environment-specific file:
# git add platform/environments/production/domain-config.yaml
git commit -m "feat(domain): change platform domain to apps.mycompany.com"
git push
```

Flux will detect the change and begin reconciling all Kustomizations that reference `sre-domain-config` via `postBuild.substituteFrom`. This typically completes within 10 minutes (the default reconciliation interval).

## Step 3: Force Immediate Reconciliation (Optional)

To apply changes immediately without waiting for the interval:

```bash
flux reconcile kustomization sre-platform -n flux-system --with-source
```

## What Gets Updated Automatically

The following resources use `${SRE_DOMAIN}` substitution and update automatically when the ConfigMap changes:

### Core Platform (all have `postBuild.substituteFrom`)
- **Istio Gateway** -- wildcard host `*.${SRE_DOMAIN}`
- **TLS Certificate** -- wildcard cert for `*.${SRE_DOMAIN}`
- **OAuth2 Proxy** -- cookie domain, whitelist domain, OIDC issuer URL, redirect URL
- **Grafana** -- root URL, Keycloak auth URL
- **All VirtualServices** -- hostnames for grafana, prometheus, alertmanager, keycloak, harbor, openbao, neuvector, oauth2, dashboard, portal
- **AuthorizationPolicy** -- ext-authz exclusion hosts
- **cert-manager CA chain** -- wildcard SAN entries
- **Node hosts DaemonSet** -- /etc/hosts entries and RKE2 registries.yaml
- **ExternalDNS** -- domain filter

### Addons (all have `postBuild.substituteFrom`)
- **Harbor HelmRelease** -- external URL
- **Keycloak HelmRelease** -- hostname
- **Backstage app-config** -- base URLs, Grafana domain
- **Dashboard** -- VirtualService host, container image registry

## What Requires Manual Changes

These files contain hardcoded domain references that are NOT managed by Flux substitution. They must be updated manually after a domain change.

### Keycloak Realm Configuration
After the domain change, update the Keycloak realm:

1. Log into Keycloak admin at `https://keycloak.<new-domain>/admin`
2. Update each OIDC client's redirect URIs:
   - `grafana` client: `https://grafana.<new-domain>/login/generic_oauth`
   - `oauth2-proxy` client: `https://dashboard.<new-domain>/oauth2/callback`
   - `neuvector` client: `https://neuvector.<new-domain>/`
   - `openbao` client: `https://openbao.<new-domain>/ui/vault/auth/oidc/oidc/callback`
3. Update the realm's Frontend URL under Realm Settings to `https://keycloak.<new-domain>`

### DNS Records
Configure DNS for your new domain:
- Create a wildcard A record `*.<new-domain>` pointing to your Istio ingress gateway IP (MetalLB VIP or cloud load balancer)
- Or create individual A records for each service hostname

### Application Source Code (apps/ directory)
These files contain hardcoded domains in application source code that is baked into container images. They require a rebuild and redeploy:

| File | What to Change |
|------|---------------|
| `apps/dashboard/server.js` | CORS origin check domain |
| `apps/dashboard/public/index.html` | API endpoint URLs |
| `apps/portal/src/api.ts` | API base URL |
| `apps/portal/src/components/EmptyState.tsx` | Service URLs |
| `apps/portal/src/components/QuickActions.tsx` | Service URLs |
| `apps/portal/k8s/deployment.yaml` | Container image registry (now uses `${SRE_REGISTRY}`) |
| `apps/portal/k8s/virtualservice.yaml` | Host (needs Flux Kustomization with postBuild) |

### Backstage Catalog
| File | What to Change |
|------|---------------|
| `platform/catalog/platform-components.yaml` | Service URL links (Grafana, Prometheus, Harbor, Keycloak, NeuVector) |

### Scripts
These scripts contain hardcoded domains used for setup and configuration:

| File | What to Change |
|------|---------------|
| `scripts/configure-keycloak-sso.sh` | Keycloak and service URLs |
| `scripts/configure-neuvector-sso.sh` | NeuVector and Keycloak URLs |
| `scripts/sre-access.sh` | Service URLs displayed to operators |
| `scripts/sre-deploy.sh` | Harbor registry URL |
| `scripts/sre-deploy-app.sh` | Harbor registry URL |
| `scripts/onboard-tenant.sh` | Service URLs |
| `scripts/preview-env.sh` | Domain references |

### CI/CD Templates
| File | What to Change |
|------|---------------|
| `ci/gitlab-ci/build-scan-deploy.gitlab-ci.yml` | Registry URL |
| `ci/github-actions/example-caller.yaml` | Registry URL |
| `ci/github-actions/preview-environment.yaml` | Domain references |
| `ci/github-actions/dast-scan.yaml` | Target URLs |

### Documentation
Domain references in docs are for human consumption and should be updated for accuracy:

| File |
|------|
| `docs/production-deployment-guide.md` |
| `docs/developer-deployment-guide.md` |
| `docs/developer-guide.md` |
| `docs/getting-started-developer.md` |
| `docs/onboarding-guide.md` |
| `docs/security-guide.md` |
| `docs/user-guide.md` |
| `docs/app-sso-integration-guide.md` |
| `docs/compliance-review.md` |
| `docs/architecture.md` |
| `README.md` |

## Verification Checklist

After changing the domain, verify:

```bash
# 1. Check Flux reconciliation status
flux get kustomizations -A

# 2. Verify TLS certificate was reissued
kubectl get certificate -n istio-system sre-wildcard-tls

# 3. Verify Istio gateway has new hosts
kubectl get gateway -n istio-system main -o yaml | grep hosts -A5

# 4. Verify OAuth2 Proxy has new domain
kubectl get deployment -n oauth2-proxy oauth2-proxy -o yaml | grep cookie-domain

# 5. Verify VirtualServices updated
kubectl get virtualservice -A -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.hosts[*]}{"\n"}{end}'

# 6. Test service accessibility
curl -sk https://dashboard.<new-domain>/
curl -sk https://grafana.<new-domain>/
curl -sk https://keycloak.<new-domain>/

# 7. Check for any remaining old domain references
flux logs --all-namespaces | grep "apps.sre.example.com"
```

## Troubleshooting

### Certificate not updating
If the wildcard certificate still shows the old domain:
```bash
# Delete the old certificate secret to force reissue
kubectl delete secret sre-wildcard-tls -n istio-system
# cert-manager will automatically reissue with the new domain
```

### OAuth2 Proxy login loop
If SSO redirects fail after domain change:
1. Verify Keycloak client redirect URIs are updated (Step 3 above)
2. Verify `--redirect-url` in OAuth2 Proxy matches the new domain
3. Clear browser cookies for the old domain

### DNS resolution failures
If in-cluster services cannot resolve the new domain:
1. Check the node-hosts DaemonSet updated `/etc/hosts`:
   ```bash
   kubectl exec -n kube-system ds/node-hosts-manager -- cat /host-etc/hosts | grep "<new-domain>"
   ```
2. Verify CoreDNS is resolving the domain:
   ```bash
   kubectl run -it --rm dns-test --image=busybox:1.36 -- nslookup grafana.<new-domain>
   ```

### Harbor image pulls failing
If pods cannot pull images from the new registry domain:
1. Verify RKE2 `registries.yaml` was updated by the DaemonSet
2. Restart RKE2 on each node to pick up the new registries config:
   ```bash
   systemctl restart rke2-server  # on control plane nodes
   systemctl restart rke2-agent   # on worker nodes
   ```
