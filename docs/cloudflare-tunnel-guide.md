# Cloudflare Tunnel Guide for SRE

This guide explains how to expose your SRE lab to the internet using Cloudflare Tunnel, providing real DNS, trusted TLS certificates, and zero inbound port forwarding.

**Audience**: Lab operators wanting secure public access to their SRE platform.

---

## Table of Contents

1. [Why Cloudflare Tunnel](#1-why-cloudflare-tunnel)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Setup Steps](#4-setup-steps)
   - [Step 1: Install cloudflared](#step-1-install-cloudflared)
   - [Step 2: Authenticate with Cloudflare](#step-2-authenticate-with-cloudflare)
   - [Step 3: Create the Tunnel](#step-3-create-the-tunnel)
   - [Step 4: Configure the Tunnel](#step-4-configure-the-tunnel)
   - [Step 5: Create DNS Records](#step-5-create-dns-records)
   - [Step 6: Start the Tunnel](#step-6-start-the-tunnel)
   - [Step 7: Update SRE Platform Domain](#step-7-update-sre-platform-domain)
5. [App Routing: How Wildcard DNS Works](#5-app-routing-how-wildcard-dns-works)
6. [TLS Certificate Strategy](#6-tls-certificate-strategy)
7. [Running cloudflared as a Service](#7-running-cloudflared-as-a-service)
8. [Running cloudflared in Kubernetes](#8-running-cloudflared-in-kubernetes)
9. [Cloudflare Access (Optional Zero Trust)](#9-cloudflare-access-optional-zero-trust)
10. [Gotchas and Troubleshooting](#10-gotchas-and-troubleshooting)
11. [Performance Considerations](#11-performance-considerations)
12. [Security Considerations](#12-security-considerations)

---

## 1. Why Cloudflare Tunnel

### The Problem

Your SRE lab runs on a private network (e.g., `192.168.2.0/24`). To access it from outside:
- You need port forwarding on your router (exposes your IP, requires static IP)
- You need a VPN (adds complexity for every user)
- You need a public IP assigned to the cluster (not always available)

### The Solution

Cloudflare Tunnel creates an **outbound-only** encrypted connection from your network to Cloudflare's edge. Users access your services via Cloudflare, which routes traffic through the tunnel to your cluster. No inbound ports, no public IP, no firewall changes.

### Benefits

| Benefit | Description |
|---------|-------------|
| **No port forwarding** | No inbound firewall rules. The tunnel is outbound-only (HTTPS to Cloudflare). |
| **No public IP** | Works behind NAT, CGNAT, or any network topology. |
| **Automatic TLS** | Cloudflare provides trusted TLS certificates. Browsers see a valid cert. |
| **DDoS protection** | Cloudflare's edge absorbs volumetric attacks before they reach your lab. |
| **Wildcard routing** | One tunnel handles ALL `*.sre.yourdomain.com` subdomains. |
| **Zero Trust option** | Layer Cloudflare Access on top for additional authentication. |
| **Free tier** | Cloudflare Tunnel is free for any number of tunnels and connections. |

---

## 2. Architecture

### Traffic Flow

```
                         Cloudflare Edge
                    ┌────────────────────────┐
                    │                        │
User's Browser ───► │  TLS termination       │
                    │  DDoS protection       │
                    │  DNS resolution         │
                    │                        │
                    │  *.sre.yourdomain.com  │
                    │        │               │
                    └────────┼───────────────┘
                             │
                    Cloudflare Tunnel
                    (outbound HTTPS from lab)
                             │
                    ┌────────┼───────────────┐
                    │  Your Lab Network       │
                    │        │               │
                    │        ▼               │
                    │  cloudflared process    │
                    │  (runs on any machine   │
                    │   that can reach the    │
                    │   gateway LB IP)        │
                    │        │               │
                    │        ▼               │
                    │  Istio Gateway          │
                    │  192.168.2.200:443      │
                    │        │               │
                    │        ▼               │
                    │  OAuth2 Proxy           │
                    │  (SSO auth)             │
                    │        │               │
                    │        ▼               │
                    │  Your Apps              │
                    └────────────────────────┘
```

### Key Concept: Two TLS Layers

```
Browser ──[TLS 1]──► Cloudflare ──[Tunnel]──► cloudflared ──[TLS 2]──► Istio Gateway ──► App

TLS 1: Cloudflare's trusted certificate (Let's Encrypt or Cloudflare Universal SSL)
       Browser sees: valid certificate, green lock
       Domain: *.sre.yourdomain.com

TLS 2: Istio's internal certificate (self-signed CA or Let's Encrypt)
       cloudflared connects to 192.168.2.200:443
       Can be self-signed — cloudflared is configured to accept it
```

---

## 3. Prerequisites

### Required

- [ ] **Cloudflare account** (free tier is sufficient)
- [ ] **Domain managed by Cloudflare** (nameservers pointed to Cloudflare)
- [ ] **A machine** that can reach `192.168.2.200` (the SRE Istio gateway IP). This can be:
  - Any node in the RKE2 cluster
  - A separate VM on the same network
  - The machine you use to manage the cluster
  - A Kubernetes pod inside the cluster itself

### Recommended

- [ ] `cloudflared` CLI installed (covered in setup)
- [ ] SSH access to the machine running cloudflared
- [ ] `kubectl` access to the SRE cluster (for the K8s deployment option)

### Not Required

- Public IP address
- Port forwarding or firewall changes
- VPN
- Static IP

---

## 4. Setup Steps

### Step 1: Install cloudflared

On the machine that will run the tunnel (must be able to reach `192.168.2.200`):

**Linux (AMD64):**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

**Linux (ARM64):**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Debian/Ubuntu:**
```bash
curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser window. Log in to your Cloudflare account and authorize the domain you want to use. A certificate is saved to `~/.cloudflared/cert.pem`.

### Step 3: Create the Tunnel

```bash
cloudflared tunnel create sre-lab
```

Output:
```
Tunnel credentials written to /home/user/.cloudflared/<TUNNEL_UUID>.json.
Created tunnel sre-lab with id <TUNNEL_UUID>
```

Note the `<TUNNEL_UUID>` -- you will need it for DNS configuration.

Verify:
```bash
cloudflared tunnel list
# Should show: sre-lab   <TUNNEL_UUID>   <date>
```

### Step 4: Configure the Tunnel

Create the tunnel configuration file:

```bash
mkdir -p ~/.cloudflared
```

**File**: `~/.cloudflared/config.yml`

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /home/user/.cloudflared/<TUNNEL_UUID>.json

# Route ALL traffic for the wildcard domain to the Istio gateway
ingress:
  # Catch-all rule: route everything to the Istio gateway
  - service: https://192.168.2.200:443
    originRequest:
      # Accept the self-signed certificate from Istio
      noTLSVerify: true
      # Preserve the original Host header (critical for Istio routing)
      httpHostHeader: ""
      # Enable HTTP/2 for better performance
      http2Origin: true
      # WebSocket support
      connectTimeout: 30s
      keepAliveTimeout: 90s
```

**Important**: `noTLSVerify: true` is required because the Istio gateway uses a self-signed certificate (or the internal CA). Cloudflare terminates the public-facing TLS; the connection from cloudflared to Istio is a private link on your local network.

### Step 5: Create DNS Records

Create a wildcard CNAME record pointing to the tunnel:

**Option A: Via cloudflared CLI (recommended)**

```bash
cloudflared tunnel route dns sre-lab "*.sre.yourdomain.com"
```

This creates: `*.sre.yourdomain.com CNAME <TUNNEL_UUID>.cfargotunnel.com`

**Option B: Via Cloudflare Dashboard**

1. Go to your domain in the Cloudflare dashboard
2. Navigate to **DNS** > **Records**
3. Add record:
   - Type: `CNAME`
   - Name: `*.sre` (if your domain is `yourdomain.com`, this creates `*.sre.yourdomain.com`)
   - Target: `<TUNNEL_UUID>.cfargotunnel.com`
   - Proxy status: `Proxied` (orange cloud ON)
   - TTL: Auto

### Step 6: Start the Tunnel

```bash
cloudflared tunnel run sre-lab
```

Output:
```
2026-03-16T12:00:00Z INF Starting tunnel tunnelID=<TUNNEL_UUID>
2026-03-16T12:00:00Z INF Connection established connIndex=0 ...
2026-03-16T12:00:00Z INF Connection established connIndex=1 ...
2026-03-16T12:00:00Z INF Connection established connIndex=2 ...
2026-03-16T12:00:00Z INF Connection established connIndex=3 ...
```

Four connections are established to Cloudflare's edge for redundancy.

### Step 7: Update SRE Platform Domain

Now that the tunnel is running, update the SRE platform to use the new domain. Follow the [Production Deployment Guide](production-deployment-guide.md) Section 3 with:

```
SRE_DOMAIN = "sre.yourdomain.com"
```

Files to update (summary):

| File | Change |
|------|--------|
| `platform/core/istio-config/gateway.yaml` | `*.sre.yourdomain.com` |
| `platform/core/oauth2-proxy/deployment.yaml` | Cookie domain, OIDC URLs |
| `platform/core/oauth2-proxy/virtualservice.yaml` | All host entries |
| `platform/core/istio-config/ext-authz/authorization-policy.yaml` | notHosts list |
| `platform/core/cert-manager-config/certificate-gateway.yaml` | dnsNames |
| `platform/addons/keycloak/helmrelease.yaml` | KC_HOSTNAME |
| All VirtualServices | Host entries |

After pushing changes, Flux reconciles the cluster. The tunnel automatically routes traffic for the new domain.

**Verify:**
```bash
# From any internet-connected machine:
curl -sI https://dashboard.sre.yourdomain.com/
# Expected: HTTP/2 302 redirect to Keycloak login
```

---

## 5. App Routing: How Wildcard DNS Works

The wildcard CNAME `*.sre.yourdomain.com` means that **every subdomain is automatically routed** through the tunnel to your Istio gateway. Istio then routes based on the `Host` header in the request.

```
dashboard.sre.yourdomain.com  ─┐
keycloak.sre.yourdomain.com   ─┤
harbor.sre.yourdomain.com     ─┤─── All resolve to ──► Cloudflare Tunnel ──► 192.168.2.200
grafana.sre.yourdomain.com    ─┤                                                   │
myapp.sre.yourdomain.com      ─┤                                              Istio routes
newapp.sre.yourdomain.com     ─┘                                              by Host header
                                                                                    │
                                                                              VirtualService
                                                                              matching
```

### Adding a New App

When you deploy a new app and create a VirtualService with a new hostname:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: newapp
spec:
  hosts:
    - "newapp.sre.yourdomain.com"
  gateways:
    - istio-system/main
  http:
    - route:
        - destination:
            host: newapp.team-alpha.svc.cluster.local
            port:
              number: 8080
```

The app is **immediately accessible** at `https://newapp.sre.yourdomain.com`. No additional DNS, tunnel, or Cloudflare configuration is needed. The wildcard handles it.

---

## 6. TLS Certificate Strategy

With Cloudflare Tunnel, you have several options for TLS:

### Option A: Cloudflare Edge TLS Only (Simplest)

```
Browser ──[Cloudflare TLS]──► Cloudflare ──[Tunnel]──► cloudflared ──[noTLSVerify]──► Istio
```

- Cloudflare provides the public-facing TLS certificate (Universal SSL or Advanced Certificate)
- `cloudflared` connects to Istio with `noTLSVerify: true` (self-signed cert OK)
- **Simplest setup**. No cert-manager changes needed on the cluster side.
- The Istio gateway still has its self-signed wildcard cert for the original domain.

**Cloudflare SSL/TLS setting**: Set to `Full` (not `Full (strict)`) in the Cloudflare dashboard under SSL/TLS.

### Option B: Cloudflare Origin CA (Recommended)

```
Browser ──[Cloudflare TLS]──► Cloudflare ──[Tunnel]──► cloudflared ──[Origin CA TLS]──► Istio
```

- Cloudflare issues an Origin CA certificate (free, 15-year validity) for `*.sre.yourdomain.com`
- Install this certificate on the Istio gateway instead of the self-signed cert
- `cloudflared` trusts Cloudflare Origin CA by default
- Set `noTLSVerify: false` in the tunnel config (more secure)

**Steps:**

1. In Cloudflare dashboard > SSL/TLS > Origin Server > Create Certificate
2. Hostnames: `*.sre.yourdomain.com`, `sre.yourdomain.com`
3. Certificate validity: 15 years
4. Download the certificate and private key
5. Create the K8s secret:

```bash
kubectl create secret tls sre-wildcard-tls \
  --namespace istio-system \
  --cert=origin-cert.pem \
  --key=origin-key.pem
```

6. The Istio Gateway already references `credentialName: sre-wildcard-tls`, so it picks up the new cert automatically.

7. Update tunnel config:
```yaml
ingress:
  - service: https://192.168.2.200:443
    originRequest:
      noTLSVerify: false
      originServerName: "*.sre.yourdomain.com"
```

8. Set Cloudflare SSL/TLS mode to `Full (strict)`.

### Option C: Let's Encrypt via cert-manager (No Tunnel Change)

If you want trusted certificates on the cluster side regardless of the tunnel:

- Configure cert-manager with Let's Encrypt DNS-01 challenge (Cloudflare DNS provider)
- cert-manager creates the wildcard cert and stores it in `sre-wildcard-tls`
- Both Cloudflare and direct LAN access use trusted certs

See the [Production Deployment Guide](production-deployment-guide.md) Section 5 for cert-manager setup.

### Comparison

| Option | Complexity | Internal Access | External Access | Cert Renewal |
|--------|-----------|----------------|----------------|-------------|
| A: Cloudflare only | Low | Self-signed (browser warning) | Trusted (Cloudflare) | Automatic (Cloudflare) |
| B: Origin CA | Medium | Trusted (if you add CF CA to trust) | Trusted (Cloudflare) | Manual (15-year validity) |
| C: Let's Encrypt | Medium | Trusted | Trusted | Automatic (cert-manager) |

---

## 7. Running cloudflared as a Service

For production, run cloudflared as a systemd service so it starts on boot and restarts on failure.

### Install as systemd Service

```bash
# Copy config to system location
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml
sudo cp ~/.cloudflared/<TUNNEL_UUID>.json /etc/cloudflared/<TUNNEL_UUID>.json
sudo cp ~/.cloudflared/cert.pem /etc/cloudflared/cert.pem

# Update credentials-file path in config
sudo sed -i 's|/home/user/.cloudflared/|/etc/cloudflared/|g' /etc/cloudflared/config.yml

# Install and start the service
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### Verify

```bash
sudo systemctl status cloudflared
# Active: active (running)

# Check logs
sudo journalctl -u cloudflared -f
```

### Monitor

```bash
# Check tunnel status
cloudflared tunnel info sre-lab

# Check connections
cloudflared tunnel run --metrics 127.0.0.1:2000 sre-lab &
curl http://127.0.0.1:2000/metrics
```

---

## 8. Running cloudflared in Kubernetes

Instead of running cloudflared on a separate machine, you can deploy it as a Kubernetes Deployment inside the SRE cluster.

### Step 1: Create the Tunnel Secret

```bash
kubectl create namespace cloudflared

kubectl create secret generic cloudflared-credentials \
  --namespace cloudflared \
  --from-file=credentials.json=/home/user/.cloudflared/<TUNNEL_UUID>.json
```

### Step 2: Create the ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cloudflared-config
  namespace: cloudflared
data:
  config.yaml: |
    tunnel: <TUNNEL_UUID>
    credentials-file: /etc/cloudflared/credentials.json
    metrics: 0.0.0.0:2000
    no-autoupdate: true
    ingress:
      - service: https://istio-gateway.istio-system.svc.cluster.local:443
        originRequest:
          noTLSVerify: true
          http2Origin: true
          connectTimeout: 30s
```

Note: When running inside the cluster, connect to the Istio gateway via its service name (`istio-gateway.istio-system.svc.cluster.local`) instead of the MetalLB IP.

### Step 3: Deploy cloudflared

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: cloudflared
  labels:
    app: cloudflared
spec:
  replicas: 2    # HA: two replicas
  selector:
    matchLabels:
      app: cloudflared
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:2024.12.2    # Pin version
          args:
            - tunnel
            - --config
            - /etc/cloudflared/config.yaml
            - run
          volumeMounts:
            - name: config
              mountPath: /etc/cloudflared/config.yaml
              subPath: config.yaml
              readOnly: true
            - name: credentials
              mountPath: /etc/cloudflared/credentials.json
              subPath: credentials.json
              readOnly: true
          ports:
            - name: metrics
              containerPort: 2000
          livenessProbe:
            httpGet:
              path: /ready
              port: metrics
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
      volumes:
        - name: config
          configMap:
            name: cloudflared-config
        - name: credentials
          secret:
            secretName: cloudflared-credentials
```

### Step 4: Add ServiceMonitor (Optional)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cloudflared
  namespace: cloudflared
spec:
  selector:
    matchLabels:
      app: cloudflared
  endpoints:
    - port: metrics
      interval: 30s
```

---

## 9. Cloudflare Access (Optional Zero Trust)

Cloudflare Access adds an additional authentication layer on top of the SRE platform's SSO. This is useful for:
- Restricting access to specific users/groups before traffic even reaches your cluster
- Adding hardware key (FIDO2) requirements
- Geolocation-based access restrictions
- Device posture checks

### Setup

1. In Cloudflare dashboard, go to **Zero Trust** > **Access** > **Applications**
2. Click **Add an application** > **Self-hosted**
3. Configure:
   - Application name: `SRE Platform`
   - Session duration: 24 hours
   - Application domain: `*.sre.yourdomain.com`
4. Add an **Access policy**:
   - Policy name: `Allow SRE Users`
   - Action: Allow
   - Include: Email ending in `@yourdomain.com`
5. Click **Save**

### How It Interacts with SRE SSO

With Cloudflare Access enabled, the auth flow becomes:

```
Browser → Cloudflare Access (email/IdP check) → Cloudflare Tunnel → OAuth2 Proxy (Keycloak SSO) → App
```

Users authenticate twice:
1. Cloudflare Access (first layer -- can use Google, Okta, SAML, etc.)
2. Keycloak SSO (second layer -- SRE platform auth)

This is defense-in-depth: even if someone obtains Keycloak credentials, they cannot access the platform without also passing the Cloudflare Access check.

### Disabling Cloudflare Access for Specific Services

If you want to bypass Cloudflare Access for specific services (e.g., a public API):

1. In the Access application, add a **Bypass** policy
2. Configure: Path matches `/api/public/*`
3. Or create a separate application for that subdomain with different rules

---

## 10. Gotchas and Troubleshooting

### Self-Signed Certificate Errors

**Problem**: `cloudflared` refuses to connect to `192.168.2.200:443` because of self-signed cert.

**Fix**: Set `noTLSVerify: true` in the tunnel config (see Step 4).

### Host Header Must Be Preserved

**Problem**: Istio routes based on the `Host` header. If cloudflared rewrites it, all requests go to a default backend.

**Fix**: The default cloudflared behavior preserves the Host header. Do NOT set `httpHostHeader` to a static value unless you know what you are doing. Leave it empty or omit it.

### WebSocket Support

**Problem**: WebSocket connections (Socket.IO, etc.) drop after 100 seconds.

**Fix**: Cloudflare Tunnel supports WebSockets by default. If timeouts occur:
1. In Cloudflare dashboard > Network > WebSockets: ensure enabled
2. In tunnel config, increase `keepAliveTimeout`:
```yaml
originRequest:
  keepAliveTimeout: 300s
```

### Large File Uploads

**Problem**: File uploads over 100MB fail with a 413 error.

**Fix**: Cloudflare free tier has a 100MB upload limit. Options:
- Upgrade to Pro ($20/month) for 500MB limit
- Use a direct connection (VPN or LAN) for large uploads
- Chunk uploads in the application

### DNS Propagation Delay

**Problem**: After creating the CNAME, `*.sre.yourdomain.com` does not resolve.

**Fix**: DNS propagation takes 1-5 minutes for Cloudflare-managed domains. Check:
```bash
dig +short dashboard.sre.yourdomain.com
# Should return Cloudflare IP addresses (not your lab IP)
```

If using a subdomain of a non-Cloudflare domain, propagation can take up to 48 hours.

### Cloudflare Tunnel Health Check Failures

**Problem**: Tunnel shows `unhealthy` status in Cloudflare dashboard.

**Fix**:
1. Verify cloudflared can reach the Istio gateway:
```bash
curl -k https://192.168.2.200/ -H "Host: dashboard.sre.yourdomain.com"
```
2. Check cloudflared logs:
```bash
journalctl -u cloudflared -f
# or
cloudflared tunnel run sre-lab 2>&1 | grep -i error
```
3. Verify the tunnel credentials file is readable:
```bash
ls -la /etc/cloudflared/<TUNNEL_UUID>.json
```

### OAuth2 Proxy Redirect Loop with Cloudflare

**Problem**: After logging in to Keycloak, the browser enters a redirect loop.

**Fix**: This usually means the OAuth2 Proxy `redirect-url` does not match the actual callback URL. Ensure:
1. `--redirect-url` uses the Cloudflare domain: `https://dashboard.sre.yourdomain.com/oauth2/callback`
2. The Keycloak client's valid redirect URIs include: `https://*.sre.yourdomain.com/oauth2/callback`
3. The `--cookie-domain` is `.sre.yourdomain.com`

### Connection Closed by Cloudflare (Error 520/521/522)

| Error | Meaning | Fix |
|-------|---------|-----|
| 520 | Web server returned unknown error | Check Istio gateway logs |
| 521 | Web server is down | Verify Istio gateway pod is running |
| 522 | Connection timed out | cloudflared cannot reach `192.168.2.200` |
| 524 | A timeout occurred | Request took longer than 100s (increase timeout) |

---

## 11. Performance Considerations

### Latency

Cloudflare Tunnel adds latency: `user → nearest Cloudflare PoP → tunnel → your lab`. Typical overhead:
- Same region: 5-20ms additional latency
- Cross-region: 20-100ms additional latency
- Acceptable for web applications and APIs
- May not be suitable for real-time applications requiring sub-10ms latency

### Throughput

- Free tier: no bandwidth limits on tunnel traffic
- Practical throughput limited by your uplink speed (upload bandwidth)
- Four concurrent tunnel connections provide redundancy, not additional bandwidth

### Optimization

```yaml
# In tunnel config, enable HTTP/2 and compression:
ingress:
  - service: https://192.168.2.200:443
    originRequest:
      noTLSVerify: true
      http2Origin: true
      disableChunkedEncoding: false
```

Enable Cloudflare caching for static assets:
1. Cloudflare dashboard > Caching > Configuration
2. Set caching level to Standard
3. Browser Cache TTL: 4 hours for static assets
4. Note: Dynamic API responses are not cached by default (no `Cache-Control` header)

---

## 12. Security Considerations

### What Cloudflare Sees

Cloudflare terminates TLS, so Cloudflare can see:
- All HTTP request/response headers
- All HTTP request/response bodies
- Client IP addresses
- Requested URLs

For classified or highly sensitive environments, this may not be acceptable. In that case, use a direct VPN connection instead of Cloudflare Tunnel.

### What Cloudflare Does NOT See

- In-cluster pod-to-pod traffic (encrypted by Istio mTLS)
- Kubernetes API traffic
- Database connections
- Internal service mesh traffic

### Recommendations

1. **Enable Cloudflare HTTPS-only mode** (redirect all HTTP to HTTPS)
2. **Set SSL/TLS encryption mode to "Full (strict)"** if using Origin CA certificates
3. **Enable WAF rules** in Cloudflare for additional protection (free tier includes basic rules)
4. **Review Cloudflare Access logs** regularly for unauthorized access attempts
5. **Do not expose cluster management interfaces** (Kubernetes API, etcd) through the tunnel
6. **Use Cloudflare Access** for an additional authentication layer in sensitive environments
7. **Monitor tunnel metrics** via Prometheus (see Section 8) for anomalous traffic patterns

### Cloudflare Tunnel Limits (Free Tier)

| Limit | Value |
|-------|-------|
| Number of tunnels | Unlimited |
| Number of connections per tunnel | 4 (automatic) |
| Max upload size | 100 MB |
| Request timeout | 100 seconds (extendable with Enterprise) |
| WebSocket connections | Supported |
| gRPC | Supported |
| UDP | Not supported through tunnels |

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnel Quick Reference                          │
│                                                             │
│  Create tunnel:                                             │
│    cloudflared tunnel create sre-lab                        │
│                                                             │
│  Config file:                                               │
│    ~/.cloudflared/config.yml                                │
│                                                             │
│  Add DNS:                                                   │
│    cloudflared tunnel route dns sre-lab "*.sre.domain.com"  │
│                                                             │
│  Start tunnel:                                              │
│    cloudflared tunnel run sre-lab                           │
│                                                             │
│  Install as service:                                        │
│    sudo cloudflared service install                         │
│    sudo systemctl enable --now cloudflared                  │
│                                                             │
│  Check status:                                              │
│    cloudflared tunnel info sre-lab                          │
│    systemctl status cloudflared                             │
│                                                             │
│  Key config for SRE:                                        │
│    noTLSVerify: true     (self-signed Istio cert)           │
│    http2Origin: true     (performance)                      │
│    service: https://192.168.2.200:443                       │
│                                                             │
│  After tunnel works:                                        │
│    Update SRE_DOMAIN in all platform manifests              │
│    See production-deployment-guide.md Section 3             │
└─────────────────────────────────────────────────────────────┘
```
