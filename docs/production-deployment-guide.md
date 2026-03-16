# Production Deployment Guide

This guide covers deploying the SRE platform to a production environment with a custom domain, trusted TLS certificates, and production-grade Keycloak configuration. It is a step-by-step operational runbook.

**Audience**: Platform operators deploying SRE to production or a new environment.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Domain Configuration](#3-domain-configuration)
4. [DNS Setup](#4-dns-setup)
5. [TLS Certificate Configuration](#5-tls-certificate-configuration)
6. [Keycloak Realm Setup](#6-keycloak-realm-setup)
7. [OAuth2 Proxy Configuration](#7-oauth2-proxy-configuration)
8. [Harbor Configuration](#8-harbor-configuration)
9. [Monitoring and Logging Configuration](#9-monitoring-and-logging-configuration)
10. [Production Hardening Checklist](#10-production-hardening-checklist)
11. [Operator Checklist: Files to Modify](#11-operator-checklist-files-to-modify)
12. [What Auto-Configures Once Domain Is Set](#12-what-auto-configures-once-domain-is-set)
13. [Validation and Smoke Testing](#13-validation-and-smoke-testing)
14. [Rollback Procedure](#14-rollback-procedure)
15. [Post-Deployment Verification](#15-post-deployment-verification)

---

## 1. Overview

The SRE platform uses a single domain variable (`SRE_DOMAIN`) that propagates through all configuration files. Changing this variable and updating the dependent files is the primary task for production deployment.

### Current Lab Configuration

| Setting | Lab Value |
|---------|-----------|
| Domain | `apps.sre.example.com` |
| Gateway LB IP | `192.168.2.200` (MetalLB) |
| TLS | Self-signed internal CA via cert-manager |
| Keycloak realm | `sre` |
| OAuth2 Proxy cookie domain | `.apps.sre.example.com` |

### Target Production Configuration

| Setting | Production Value |
|---------|-----------------|
| Domain | `apps.yourdomain.com` (your choice) |
| Gateway LB IP | Cloud LB or MetalLB (environment-dependent) |
| TLS | Let's Encrypt or organizational CA |
| Keycloak realm | `sre` (same) |
| OAuth2 Proxy cookie domain | `.apps.yourdomain.com` |

### Architecture: What Changes vs What Stays the Same

```
CHANGES:                          STAYS THE SAME:
─────────                         ──────────────────
Domain name                       Istio mesh config
TLS certificate issuer            Kyverno policies
OAuth2 Proxy URLs                 NetworkPolicies
Keycloak hostname                 Monitoring stack
DNS records                       Logging stack
VirtualService hosts              NeuVector config
Harbor hostname                   OpenBao config
                                  Flux reconciliation
                                  App deployment flow
```

---

## 2. Prerequisites

Before starting a production deployment:

### Infrastructure

- [ ] Kubernetes cluster running (RKE2 recommended, DISA STIG hardened)
- [ ] Minimum 3 control plane nodes + 3 worker nodes
- [ ] Persistent storage available (local-path, Longhorn, or cloud PVs)
- [ ] Load balancer configured (MetalLB for bare metal, cloud LB for cloud)
- [ ] Gateway LB IP assigned and routable from users

### DNS

- [ ] Domain registered and managed (Cloudflare, Route 53, or internal DNS)
- [ ] Ability to create wildcard DNS records
- [ ] DNS propagation verified

### Certificates

- [ ] Decided on TLS strategy: Let's Encrypt, organizational CA, or Cloudflare Origin CA
- [ ] If Let's Encrypt: DNS-01 challenge provider credentials (Cloudflare API token, Route 53 keys)
- [ ] If organizational CA: CA certificate and key available

### Secrets

- [ ] Keycloak admin password generated (minimum 16 characters, mixed case, numbers, symbols)
- [ ] OAuth2 Proxy client secret generated: `openssl rand -hex 32`
- [ ] OAuth2 Proxy cookie secret generated: `openssl rand -base64 24`
- [ ] Harbor admin password generated

### Tools

- [ ] `kubectl` configured with cluster admin access
- [ ] `flux` CLI installed
- [ ] `helm` CLI installed (for debugging)
- [ ] `openssl` for secret generation

---

## 3. Domain Configuration

### Step 1: Choose Your Domain

Select a domain for the platform. All services will be subdomains:

```
*.apps.yourdomain.com

Examples:
  dashboard.apps.yourdomain.com
  keycloak.apps.yourdomain.com
  harbor.apps.yourdomain.com
  grafana.apps.yourdomain.com
  myapp.apps.yourdomain.com
```

Set the variable for use in this guide:

```bash
export SRE_DOMAIN="apps.yourdomain.com"
```

### Step 2: Update the Istio Gateway

**File**: `platform/core/istio-config/gateway.yaml`

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: main
  namespace: istio-system
spec:
  selector:
    istio: gateway
  servers:
    - port:
        number: 443
        name: https
        protocol: HTTPS
      tls:
        mode: SIMPLE
        credentialName: sre-wildcard-tls
      hosts:
        - "*.apps.yourdomain.com"          # <-- UPDATE THIS
    - port:
        number: 80
        name: http
        protocol: HTTP
      tls:
        httpsRedirect: true
      hosts:
        - "*.apps.yourdomain.com"          # <-- UPDATE THIS
```

### Step 3: Update OAuth2 Proxy

**File**: `platform/core/oauth2-proxy/deployment.yaml`

Update these arguments in the container spec:

```yaml
args:
  # ...existing args...
  - --cookie-domain=.apps.yourdomain.com                                          # <-- UPDATE
  - --whitelist-domain=.apps.yourdomain.com                                       # <-- UPDATE
  - --oidc-issuer-url=https://keycloak.apps.yourdomain.com/realms/sre            # <-- UPDATE
  - --login-url=https://keycloak.apps.yourdomain.com/realms/sre/protocol/openid-connect/auth  # <-- UPDATE
  - --redirect-url=https://dashboard.apps.yourdomain.com/oauth2/callback          # <-- UPDATE
  # NOTE: redeem-url, oidc-jwks-url, validate-url, profile-url use in-cluster
  #       service URLs and do NOT need to change:
  # - --redeem-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/token
  # - --oidc-jwks-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/certs
  # - --validate-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/userinfo
  # - --profile-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/userinfo
```

Also update the OAuth2 Proxy credentials Secret if generating new secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oauth2-proxy-credentials
  namespace: oauth2-proxy
type: Opaque
stringData:
  client-id: "oauth2-proxy"
  client-secret: "REPLACE_WITH_NEW_SECRET"    # openssl rand -hex 32
  cookie-secret: "REPLACE_WITH_NEW_SECRET"    # openssl rand -base64 24
```

### Step 4: Update OAuth2 Proxy VirtualService

**File**: `platform/core/oauth2-proxy/virtualservice.yaml`

Update all host references:

```yaml
# First VirtualService: oauth2 dedicated host
spec:
  hosts:
    - "oauth2.apps.yourdomain.com"           # <-- UPDATE

---
# Second VirtualService: /oauth2/ paths on all service hosts
spec:
  hosts:
    - "dashboard.apps.yourdomain.com"        # <-- UPDATE
    - "grafana.apps.yourdomain.com"          # <-- UPDATE
    - "prometheus.apps.yourdomain.com"       # <-- UPDATE
    - "alertmanager.apps.yourdomain.com"     # <-- UPDATE
    - "harbor.apps.yourdomain.com"           # <-- UPDATE
    - "neuvector.apps.yourdomain.com"        # <-- UPDATE
    - "openbao.apps.yourdomain.com"          # <-- UPDATE
    - "portal.apps.yourdomain.com"           # <-- UPDATE
```

### Step 5: Update Keycloak

**File**: `platform/addons/keycloak/helmrelease.yaml`

```yaml
spec:
  values:
    extraEnvVars:
      - name: KC_HOSTNAME
        value: "keycloak.apps.yourdomain.com"    # <-- UPDATE
      - name: KC_HOSTNAME_PORT
        value: "443"
      - name: KC_HOSTNAME_STRICT
        value: "false"
      - name: KC_HTTP_RELATIVE_PATH
        value: "/"
```

**File**: `platform/addons/keycloak/virtualservice.yaml`

```yaml
spec:
  hosts:
    - "keycloak.apps.yourdomain.com"             # <-- UPDATE
```

### Step 6: Update Keycloak Client Redirect URIs

After Keycloak is running, update the `oauth2-proxy` client configuration in the Keycloak admin console:

1. Log in to `https://keycloak.apps.yourdomain.com/admin`
2. Select realm `sre`
3. Go to **Clients** > `oauth2-proxy`
4. Update **Valid redirect URIs**: `https://*.apps.yourdomain.com/oauth2/callback`
5. Update **Web origins**: `https://*.apps.yourdomain.com`
6. Update **Post logout redirect URIs**: `https://dashboard.apps.yourdomain.com`
7. Click **Save**

### Step 7: Update cert-manager Certificate

**File**: `platform/core/cert-manager-config/certificate-gateway.yaml`

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: sre-wildcard-tls
  namespace: istio-system
spec:
  secretName: sre-wildcard-tls
  duration: 2160h
  renewBefore: 720h
  privateKey:
    algorithm: ECDSA
    size: 256
  dnsNames:
    - "*.apps.yourdomain.com"                    # <-- UPDATE
    - "apps.yourdomain.com"                      # <-- UPDATE
  issuerRef:
    name: letsencrypt-production                 # <-- UPDATE for production
    kind: ClusterIssuer
    group: cert-manager.io
```

### Step 8: Update ext-authz AuthorizationPolicy

**File**: `platform/core/istio-config/ext-authz/authorization-policy.yaml`

```yaml
spec:
  rules:
    - to:
        - operation:
            notHosts:
              - "keycloak.apps.yourdomain.com"   # <-- UPDATE
              - "harbor.apps.yourdomain.com"     # <-- UPDATE
              - "neuvector.apps.yourdomain.com"  # <-- UPDATE
```

### Step 9: Update All VirtualServices

Search for and update every VirtualService that references the domain:

```bash
# Find all files referencing the old domain
grep -r "apps.sre.example.com" platform/ --include="*.yaml" -l
```

Each VirtualService has a `hosts:` field that needs updating. Common ones:

| Service | File | Host |
|---------|------|------|
| Dashboard | `apps/tenants/*/virtualservice.yaml` | `dashboard.apps.yourdomain.com` |
| Grafana | `platform/core/monitoring/virtualservice.yaml` | `grafana.apps.yourdomain.com` |
| Prometheus | `platform/core/monitoring/virtualservice.yaml` | `prometheus.apps.yourdomain.com` |
| Alertmanager | `platform/core/monitoring/virtualservice.yaml` | `alertmanager.apps.yourdomain.com` |
| Harbor | `platform/addons/harbor/virtualservice.yaml` | `harbor.apps.yourdomain.com` |
| Keycloak | `platform/addons/keycloak/virtualservice.yaml` | `keycloak.apps.yourdomain.com` |
| NeuVector | `platform/core/runtime-security/virtualservice.yaml` | `neuvector.apps.yourdomain.com` |
| OpenBao | `platform/core/openbao/virtualservice.yaml` | `openbao.apps.yourdomain.com` |

### Step 10: Update SRE Dashboard Environment

The SRE Dashboard uses environment variables for domain references. Update its ConfigMap or Deployment:

```yaml
env:
  - name: SRE_DOMAIN
    value: "apps.yourdomain.com"
  - name: HARBOR_REGISTRY
    value: "harbor.apps.yourdomain.com"
  - name: KEYCLOAK_URL
    value: "https://keycloak.apps.yourdomain.com"
```

---

## 4. DNS Setup

### Option A: Wildcard DNS Record (Recommended)

Create a single wildcard DNS record pointing to your load balancer IP:

```
Type:  A
Name:  *.apps.yourdomain.com
Value: <GATEWAY_LB_IP>
TTL:   300
```

This automatically routes ALL subdomains (`dashboard.apps.yourdomain.com`, `myapp.apps.yourdomain.com`, etc.) to the Istio gateway. No per-app DNS registration is needed.

### Option B: Individual DNS Records

If wildcard records are not permitted by your DNS policy:

```
Type:  A
Name:  dashboard.apps.yourdomain.com     Value: <GATEWAY_LB_IP>
Type:  A
Name:  keycloak.apps.yourdomain.com      Value: <GATEWAY_LB_IP>
Type:  A
Name:  harbor.apps.yourdomain.com        Value: <GATEWAY_LB_IP>
Type:  A
Name:  grafana.apps.yourdomain.com       Value: <GATEWAY_LB_IP>
Type:  A
Name:  prometheus.apps.yourdomain.com    Value: <GATEWAY_LB_IP>
Type:  A
Name:  alertmanager.apps.yourdomain.com  Value: <GATEWAY_LB_IP>
Type:  A
Name:  neuvector.apps.yourdomain.com     Value: <GATEWAY_LB_IP>
Type:  A
Name:  openbao.apps.yourdomain.com       Value: <GATEWAY_LB_IP>
Type:  A
Name:  oauth2.apps.yourdomain.com        Value: <GATEWAY_LB_IP>
```

Note: With individual records, you must add a new DNS record for each new tenant app.

### Option C: /etc/hosts (Lab/Dev Only)

For local development or lab environments:

```bash
# Add to /etc/hosts on each client machine
echo "<GATEWAY_LB_IP> dashboard.apps.yourdomain.com keycloak.apps.yourdomain.com harbor.apps.yourdomain.com grafana.apps.yourdomain.com prometheus.apps.yourdomain.com neuvector.apps.yourdomain.com" | sudo tee -a /etc/hosts
```

### Verify DNS Resolution

```bash
# Should resolve to your gateway LB IP
dig +short dashboard.apps.yourdomain.com
dig +short keycloak.apps.yourdomain.com
dig +short harbor.apps.yourdomain.com

# Wildcard test
dig +short randomapp.apps.yourdomain.com
```

---

## 5. TLS Certificate Configuration

### Option A: Let's Encrypt (Recommended for Internet-Facing)

#### Step 1: Create ClusterIssuer for Let's Encrypt

**File**: `platform/core/cert-manager-config/clusterissuer-letsencrypt.yaml`

For HTTP-01 challenge (requires port 80 accessible from internet):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    email: admin@yourdomain.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-production-key
    solvers:
      - http01:
          ingress:
            class: istio
```

For DNS-01 challenge (recommended for wildcard certificates):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    email: admin@yourdomain.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: letsencrypt-production-key
    solvers:
      - dns01:
          cloudflare:
            email: admin@yourdomain.com
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

#### Step 2: Create Cloudflare API Token Secret (if using DNS-01)

```bash
kubectl create secret generic cloudflare-api-token \
  --namespace cert-manager \
  --from-literal=api-token="YOUR_CLOUDFLARE_API_TOKEN"
```

The Cloudflare API token needs the `Zone:DNS:Edit` permission for your domain.

#### Step 3: Update the Certificate to Use Let's Encrypt

Update `platform/core/cert-manager-config/certificate-gateway.yaml`:

```yaml
spec:
  issuerRef:
    name: letsencrypt-production
    kind: ClusterIssuer
    group: cert-manager.io
```

### Option B: Internal CA (Air-Gapped or Private Networks)

The default self-signed CA chain is already configured. For production, consider using your organization's CA:

#### Step 1: Import Organizational CA

```bash
kubectl create secret tls org-ca-tls \
  --namespace cert-manager \
  --cert=/path/to/ca.crt \
  --key=/path/to/ca.key
```

#### Step 2: Create ClusterIssuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: org-ca-issuer
spec:
  ca:
    secretName: org-ca-tls
```

#### Step 3: Distribute CA Certificate

Clients must trust your CA. Distribute the CA certificate to:
- Browser trust stores on client machines
- System CA bundle on nodes (`/etc/pki/ca-trust/source/anchors/`)
- Container images that make HTTPS calls to platform services

### Option C: Cloudflare Origin CA (If Using Cloudflare Tunnel)

See the [Cloudflare Tunnel Guide](cloudflare-tunnel-guide.md) for this option.

### Verify Certificate Issuance

```bash
# Check certificate status
kubectl get certificate sre-wildcard-tls -n istio-system

# Check for errors
kubectl describe certificate sre-wildcard-tls -n istio-system

# Verify the certificate details
kubectl get secret sre-wildcard-tls -n istio-system -o jsonpath='{.data.tls\.crt}' | \
  base64 -d | openssl x509 -noout -subject -issuer -dates
```

---

## 6. Keycloak Realm Setup

### Initial Access

After deployment, access the Keycloak admin console:

```
URL: https://keycloak.apps.yourdomain.com/admin
```

Log in with the admin credentials configured in the HelmRelease (`admin` user, password from `keycloak-admin-credentials` Secret).

### Step 1: Create the SRE Realm

If the `sre` realm does not exist:

1. Click the realm dropdown (top-left, shows "master")
2. Click **Create Realm**
3. Name: `sre`
4. Click **Create**

### Step 2: Create the oauth2-proxy Client

1. In the `sre` realm, go to **Clients** > **Create client**
2. Configure:
   - Client type: `OpenID Connect`
   - Client ID: `oauth2-proxy`
   - Name: `SRE OAuth2 Proxy`
3. Click **Next**
4. Configure:
   - Client authentication: `ON`
   - Authorization: `OFF`
   - Authentication flow: check `Standard flow` and `Direct access grants`
5. Click **Next**
6. Configure:
   - Root URL: `https://dashboard.apps.yourdomain.com`
   - Valid redirect URIs: `https://*.apps.yourdomain.com/oauth2/callback`
   - Web origins: `https://*.apps.yourdomain.com`
   - Post logout redirect URIs: `https://dashboard.apps.yourdomain.com`
7. Click **Save**
8. Go to the **Credentials** tab and copy the **Client secret**
9. Update the OAuth2 Proxy Secret with this client secret

### Step 3: Add Groups Protocol Mapper

1. In the `oauth2-proxy` client, go to **Client scopes** tab
2. Click `oauth2-proxy-dedicated`
3. Click **Configure a new mapper** > **Group Membership**
4. Configure:
   - Name: `groups`
   - Token Claim Name: `groups`
   - Full group path: `OFF`
   - Add to ID token: `ON`
   - Add to access token: `ON`
   - Add to userinfo: `ON`
5. Click **Save**

### Step 4: Create Groups

1. Go to **Groups** in the left sidebar
2. Create the following groups:
   - `sre-admins` -- Platform administrators
   - `developers` -- Application developers
   - `viewers` -- Read-only access

### Step 5: Create Users

1. Go to **Users** > **Add user**
2. Create at least one admin user:
   - Username: `sre-admin`
   - Email: `admin@yourdomain.com`
   - First Name: `SRE`
   - Last Name: `Admin`
   - Email verified: `ON`
3. Click **Create**
4. Go to **Credentials** tab > **Set password**
5. Go to **Groups** tab > **Join Group** > select `sre-admins`

### Step 6: Configure Password Policy (Production)

1. Go to **Authentication** > **Policies** > **Password policy**
2. Add policies:
   - Minimum length: 12
   - Not recently used: 5
   - Uppercase characters: 1
   - Lowercase characters: 1
   - Digits: 1
   - Special characters: 1

### Step 7: Enable MFA (Production)

1. Go to **Authentication** > **Flows** > **browser**
2. Add **OTP Form** as a required step after username/password
3. Or configure WebAuthn for hardware key support

---

## 7. OAuth2 Proxy Configuration

After updating the OAuth2 Proxy deployment file (Step 3 in Domain Configuration), verify the complete configuration:

### Required OAuth2 Proxy Arguments (Production)

```yaml
args:
  - --provider=keycloak-oidc
  - --client-id=$(CLIENT_ID)
  - --client-secret=$(CLIENT_SECRET)
  - --cookie-secret=$(COOKIE_SECRET)
  - --cookie-name=_sre_oauth2
  - --cookie-secure=true
  - --cookie-samesite=lax
  - --cookie-httponly=true
  - --cookie-domain=.apps.yourdomain.com
  - --upstream=static://200
  - --http-address=0.0.0.0:4180
  - --email-domain=yourdomain.com           # Restrict to org domain in production
  - --set-xauthrequest=true
  - --set-authorization-header=true
  - --pass-access-token=true
  - --pass-authorization-header=true
  - --skip-auth-route=^/healthz$
  - --skip-auth-route=^/api/health$
  - --whitelist-domain=.apps.yourdomain.com
  - --reverse-proxy=true
  - --skip-oidc-discovery=true
  - --oidc-issuer-url=https://keycloak.apps.yourdomain.com/realms/sre
  - --login-url=https://keycloak.apps.yourdomain.com/realms/sre/protocol/openid-connect/auth
  - --redeem-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/token
  - --oidc-jwks-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/certs
  - --validate-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/userinfo
  - --profile-url=http://keycloak.keycloak.svc.cluster.local/realms/sre/protocol/openid-connect/userinfo
  - --insecure-oidc-skip-issuer-verification=true
  - --oidc-groups-claim=groups
  - --code-challenge-method=S256
  - --redirect-url=https://dashboard.apps.yourdomain.com/oauth2/callback
  - --scope=openid profile email groups
```

### Production-Specific Changes

| Parameter | Lab Value | Production Value | Reason |
|-----------|-----------|-----------------|--------|
| `--email-domain` | `*` | `yourdomain.com` | Restrict login to org emails |
| `--cookie-domain` | `.apps.sre.example.com` | `.apps.yourdomain.com` | Match production domain |
| `--redirect-url` | `...sre.example.com...` | `...yourdomain.com...` | Match production domain |
| `--oidc-issuer-url` | `...sre.example.com...` | `...yourdomain.com...` | Match Keycloak hostname |
| `--login-url` | `...sre.example.com...` | `...yourdomain.com...` | Match Keycloak hostname |

---

## 8. Harbor Configuration

### Update Harbor Hostname

If Harbor's VirtualService or HelmRelease references the domain, update it:

**File**: `platform/addons/harbor/virtualservice.yaml` (or equivalent)

```yaml
spec:
  hosts:
    - "harbor.apps.yourdomain.com"
```

### Update Kyverno Registry Restriction Policy

Update the `restrict-image-registries` policy to allow the new Harbor hostname:

**File**: `policies/custom/restrict-image-registries.yaml`

```yaml
spec:
  rules:
    - name: validate-image-registry
      validate:
        message: "Images must be from the approved Harbor registry."
        pattern:
          spec:
            containers:
              - image: "harbor.apps.yourdomain.com/*"
```

### Update Harbor Pull Secrets in Tenant Namespaces

Recreate pull secrets with the new Harbor hostname:

```bash
kubectl create secret docker-registry harbor-pull-secret \
  --namespace team-alpha \
  --docker-server=harbor.apps.yourdomain.com \
  --docker-username=robot-account \
  --docker-password=ROBOT_ACCOUNT_TOKEN
```

---

## 9. Monitoring and Logging Configuration

### Grafana

Update Grafana's VirtualService and any OAuth integration to use the new domain.

If Grafana uses Keycloak SSO directly (separate from OAuth2 Proxy), update the Grafana OIDC configuration in the HelmRelease values:

```yaml
grafana:
  grafana.ini:
    auth.generic_oauth:
      auth_url: https://keycloak.apps.yourdomain.com/realms/sre/protocol/openid-connect/auth
      token_url: https://keycloak.apps.yourdomain.com/realms/sre/protocol/openid-connect/token
      api_url: https://keycloak.apps.yourdomain.com/realms/sre/protocol/openid-connect/userinfo
```

### AlertManager

Update AlertManager webhook URLs if they reference the domain:

```yaml
alertmanager:
  config:
    receivers:
      - name: slack
        slack_configs:
          - send_resolved: true
            api_url: "https://hooks.slack.com/..."   # External, no change needed
```

---

## 10. Production Hardening Checklist

Apply these hardening measures for production:

### Secrets Management

- [ ] Replace all lab passwords with strong, unique passwords (minimum 16 chars)
- [ ] Move all secrets to OpenBao + External Secrets Operator (no plaintext in Git)
- [ ] Rotate OAuth2 Proxy client secret and cookie secret
- [ ] Rotate Harbor admin password
- [ ] Rotate Keycloak admin password
- [ ] Verify no secrets in Git history: `git log --all -p | grep -i password`

### Network

- [ ] Restrict MetalLB IP pool to allocated production IPs
- [ ] Enable Istio egress gateway for controlled outbound traffic
- [ ] Review and tighten NetworkPolicies for cross-namespace communication
- [ ] Configure NeuVector in Protect mode (after learning period)

### Kyverno Policies

- [ ] Transition all Audit-mode policies to Enforce:
  - `disallow-privilege-escalation` -> Enforce
  - `require-drop-all-capabilities` -> Enforce
  - `require-run-as-nonroot` -> Enforce
  - `require-security-context` -> Enforce
  - `restrict-image-registries` -> Enforce
  - `restrict-volume-types` -> Enforce
  - `verify-image-signatures` -> Enforce

### Authentication

- [ ] Set `--email-domain` in OAuth2 Proxy to your organization's domain
- [ ] Enable MFA in Keycloak for all users
- [ ] Configure Keycloak password policy (see Section 6)
- [ ] Disable direct access grants on the oauth2-proxy client if not needed

### Observability

- [ ] Configure AlertManager with production notification channels (PagerDuty, Slack, email)
- [ ] Set log retention to compliance-required duration (90 days minimum for NIST AU-4)
- [ ] Configure long-term metric storage (Thanos sidecar or remote write)
- [ ] Set up Grafana alerting rules for security events

### Backup

- [ ] Configure Velero with production S3 storage
- [ ] Test backup/restore procedure
- [ ] Document RPO (Recovery Point Objective) and RTO (Recovery Time Objective)

### OS and Cluster

- [ ] Verify DISA STIG compliance: `scripts/validate-compliance.sh`
- [ ] Verify FIPS mode enabled: `fips-mode-setup --check`
- [ ] Verify SELinux enforcing: `getenforce`
- [ ] Verify RKE2 CIS benchmark: `kube-bench run --targets node,master`

---

## 11. Operator Checklist: Files to Modify

Complete list of files requiring domain updates, in order:

### Must Change (Domain-Dependent)

| # | File | What to Change |
|---|------|---------------|
| 1 | `platform/core/istio-config/gateway.yaml` | `hosts: *.${SRE_DOMAIN}` |
| 2 | `platform/core/oauth2-proxy/deployment.yaml` | Cookie domain, OIDC URLs, redirect URL, whitelist domain |
| 3 | `platform/core/oauth2-proxy/virtualservice.yaml` | All host entries |
| 4 | `platform/core/istio-config/ext-authz/authorization-policy.yaml` | `notHosts` list |
| 5 | `platform/core/cert-manager-config/certificate-gateway.yaml` | `dnsNames` and `issuerRef` |
| 6 | `platform/addons/keycloak/helmrelease.yaml` | `KC_HOSTNAME` value |
| 7 | `platform/addons/keycloak/virtualservice.yaml` | Host entry |
| 8 | All other VirtualServices (monitoring, harbor, neuvector, openbao, dashboard) | Host entries |
| 9 | `policies/custom/restrict-image-registries.yaml` | Harbor hostname pattern |

### Must Change (Secrets -- Production)

| # | File/Resource | What to Change |
|---|--------------|---------------|
| 10 | `platform/core/oauth2-proxy/deployment.yaml` (Secret) | `client-secret`, `cookie-secret` |
| 11 | Keycloak admin password Secret | Admin password |
| 12 | Harbor admin password | Admin password |

### Must Configure (Keycloak -- Post-Deploy)

| # | Action | Details |
|---|--------|---------|
| 13 | Create `sre` realm | If fresh Keycloak install |
| 14 | Create `oauth2-proxy` client | With new redirect URIs |
| 15 | Add groups protocol mapper | `groups` claim in tokens |
| 16 | Create groups | `sre-admins`, `developers`, `viewers` |
| 17 | Create admin user | Assign to `sre-admins` |
| 18 | Configure password policy | Production requirements |

---

## 12. What Auto-Configures Once Domain Is Set

After updating the files listed above and pushing to Git:

| Component | Auto-Configuration | How |
|-----------|-------------------|-----|
| **Flux reconciliation** | Applies all updated manifests automatically | Watches Git repo |
| **Istio gateway TLS** | Picks up new wildcard certificate | credentialName in Gateway |
| **cert-manager** | Issues certificate for new domain | Certificate resource |
| **OAuth2 Proxy** | Starts authenticating on new domain | Deployment restart |
| **All VirtualServices** | Route traffic for new hostnames | Istio reconciliation |
| **Istio mTLS** | Works on any domain (identity-based, not hostname-based) | PeerAuthentication |
| **Kyverno policies** | Continue enforcing (domain-agnostic) | ClusterPolicies |
| **NetworkPolicies** | Continue enforcing (domain-agnostic) | NetworkPolicies |
| **NeuVector** | Continues monitoring (domain-agnostic) | DaemonSet |
| **Prometheus/Grafana** | Continue scraping (uses in-cluster service discovery) | ServiceMonitors |
| **Loki/Alloy** | Continue collecting logs (domain-agnostic) | DaemonSet |

---

## 13. Validation and Smoke Testing

After deploying with the new domain:

### Step 1: Verify DNS

```bash
dig +short dashboard.apps.yourdomain.com
# Expected: <GATEWAY_LB_IP>

dig +short keycloak.apps.yourdomain.com
# Expected: <GATEWAY_LB_IP>
```

### Step 2: Verify TLS Certificate

```bash
echo | openssl s_client -connect dashboard.apps.yourdomain.com:443 -servername dashboard.apps.yourdomain.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates
# Expected: subject with *.apps.yourdomain.com, valid dates
```

### Step 3: Verify Keycloak

```bash
curl -sf https://keycloak.apps.yourdomain.com/realms/sre/.well-known/openid-configuration | jq '.issuer'
# Expected: "https://keycloak.apps.yourdomain.com/realms/sre"
```

### Step 4: Verify OAuth2 Proxy

```bash
# Should redirect to Keycloak login
curl -sI https://dashboard.apps.yourdomain.com/ | head -5
# Expected: HTTP/2 302, Location: https://keycloak.apps.yourdomain.com/realms/sre/...
```

### Step 5: Verify End-to-End Login

1. Open browser to `https://dashboard.apps.yourdomain.com`
2. You should be redirected to the Keycloak login page
3. Log in with the admin user created in Section 6
4. You should be redirected back to the dashboard
5. Verify the SSO cookie is set: check browser developer tools for `_sre_oauth2` on `.apps.yourdomain.com`

### Step 6: Verify All Services

```bash
# Check all platform services
for svc in dashboard keycloak harbor grafana prometheus alertmanager neuvector; do
  echo -n "$svc: "
  curl -sf -o /dev/null -w "%{http_code}" "https://${svc}.apps.yourdomain.com/" || echo "FAILED"
  echo
done
```

---

## 14. Rollback Procedure

If the domain migration fails:

### Quick Rollback

```bash
# Revert all domain changes in Git
git revert HEAD

# Or restore from a specific commit
git checkout <pre-migration-commit> -- platform/

# Push to trigger Flux reconciliation
git push
```

### Manual Rollback (If Git Is Unavailable)

```bash
# Suspend Flux to prevent reconciliation
flux suspend kustomization --all

# Restore original OAuth2 Proxy config
kubectl apply -f platform/core/oauth2-proxy/deployment.yaml.backup

# Restore original Gateway
kubectl apply -f platform/core/istio-config/gateway.yaml.backup

# Resume Flux
flux resume kustomization --all
```

### Rollback Verification

After rollback, verify the old domain works:

```bash
curl -sI https://dashboard.apps.sre.example.com/ | head -5
```

---

## 15. Post-Deployment Verification

After production deployment is stable:

### Compliance Verification

```bash
# Run STIG validation
./scripts/validate-compliance.sh

# Check Kyverno policy compliance
kubectl get clusterpolicyreport -o json | jq '[.items[].results[] | .result] | group_by(.) | map({(.[0]): length}) | add'
# Expected: {"pass": N, "fail": 0}

# Verify mTLS is STRICT
istioctl analyze --all-namespaces
```

### Security Verification

```bash
# Verify no privileged pods (outside exceptions)
kubectl get pods -A -o json | jq '.items[] | select(.spec.containers[].securityContext.privileged==true) | .metadata.namespace + "/" + .metadata.name'

# Verify all namespaces have NetworkPolicies
for ns in $(kubectl get ns -o jsonpath='{.items[*].metadata.name}'); do
  count=$(kubectl get networkpolicy -n $ns --no-headers 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "WARNING: No NetworkPolicy in namespace $ns"
  fi
done
```

### Performance Baseline

After deployment, collect baseline metrics for comparison:

```bash
# Grafana dashboards to baseline:
# - Node CPU/Memory utilization
# - Pod restart counts
# - Istio request latency (p50, p95, p99)
# - Loki ingestion rate
# - cert-manager certificate status
```
