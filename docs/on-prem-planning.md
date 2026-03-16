# On-Premises and Air-Gapped Deployment Planning

This document covers planning and architecture for deploying the SRE platform in on-premises and air-gapped environments where internet access is limited or absent.

**Audience**: Platform architects planning on-prem/air-gapped SRE deployments.

---

## Table of Contents

1. [Overview: Why Air-Gap](#1-overview-why-air-gap)
2. [Architecture: Connected vs Air-Gapped](#2-architecture-connected-vs-air-gapped)
3. [Git Repository: Internal GitOps Source](#3-git-repository-internal-gitops-source)
4. [Harbor as Image Cache and Registry](#4-harbor-as-image-cache-and-registry)
5. [TLS Certificates Without Internet](#5-tls-certificates-without-internet)
6. [Identity Provider: Keycloak in Air-Gap](#6-identity-provider-keycloak-in-air-gap)
7. [RPOC ATO Portal as Tenant App](#7-rpoc-ato-portal-as-tenant-app)
8. [Network Considerations](#8-network-considerations)
9. [Suggested Architecture](#9-suggested-architecture)
10. [Migration Path: Lab to Air-Gapped](#10-migration-path-lab-to-air-gapped)
11. [Day-2 Operations in Air-Gap](#11-day-2-operations-in-air-gap)
12. [Hardware Planning](#12-hardware-planning)
13. [Checklist: Before You Disconnect](#13-checklist-before-you-disconnect)

---

## 1. Overview: Why Air-Gap

Air-gapped deployments are required when:
- The network has no internet access (classified environments, SCIFs)
- Compliance requirements prohibit outbound data connections (NIST AC-4, SC-7)
- The deployment is on a tactical or mobile network with intermittent connectivity
- Regulatory frameworks mandate data sovereignty and network isolation

### What "Air-Gapped" Means for SRE

Every component that normally fetches content from the internet must have a local alternative:

| Component | Internet-Connected | Air-Gapped Alternative |
|-----------|-------------------|----------------------|
| Container images | Docker Hub, GHCR, Quay | Harbor (pre-loaded) |
| Helm charts | Public chart repos | Harbor OCI registry or ChartMuseum |
| Git repository | GitHub, GitLab.com | Internal GitLab/Gitea/Forgejo |
| TLS certificates | Let's Encrypt ACME | Internal CA via cert-manager |
| Keycloak federation | External LDAP/SAML IdPs | Local LDAP or manual user management |
| OS packages | Rocky Linux repos | Local RPM mirror or Satellite |
| CVE databases | Trivy DB from GitHub | Pre-downloaded Trivy DB bundle |
| NTP time sync | pool.ntp.org | Local NTP server or GPS clock |
| Flux GitOps | GitHub/GitLab.com Git | Internal Git server |

---

## 2. Architecture: Connected vs Air-Gapped

### Connected (Lab/Dev)

```
┌──────────────────────────────────────────────────────────────────┐
│  Internet                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Docker   │  │ GitHub   │  │ Let's        │  │ Trivy DB    │  │
│  │ Hub      │  │          │  │ Encrypt      │  │ (GitHub)    │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └──────┬──────┘  │
│       │              │               │                  │         │
└───────┼──────────────┼───────────────┼──────────────────┼─────────┘
        │              │               │                  │
        ▼              ▼               ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  SRE Cluster                                                      │
│  ┌────────┐  ┌──────┐  ┌─────────────┐  ┌───────┐  ┌─────────┐ │
│  │ Harbor  │  │ Flux │  │ cert-manager│  │ Trivy │  │ Apps    │ │
│  └────────┘  └──────┘  └─────────────┘  └───────┘  └─────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Air-Gapped

```
┌─────────────────────────────────────────────────────────────────────┐
│  Air-Gapped Network (No Internet)                                    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SRE Cluster                                                  │   │
│  │  ┌────────┐  ┌──────────┐  ┌─────────────┐  ┌───────────┐  │   │
│  │  │ Harbor  │  │ GitLab/  │  │ cert-manager│  │ NTP       │  │   │
│  │  │ (all    │  │ Gitea    │  │ (internal   │  │ (local)   │  │   │
│  │  │ images) │  │ (GitOps) │  │ CA)         │  │           │  │   │
│  │  └────────┘  └──────────┘  └─────────────┘  └───────────┘  │   │
│  │                                                               │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐ │   │
│  │  │ Keycloak   │  │ Kyverno  │  │ NeuVector│  │ Apps      │ │   │
│  │  │ (local DB) │  │          │  │          │  │           │ │   │
│  │  └────────────┘  └──────────┘  └──────────┘  └───────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────┐                                       │
│  │  Data Transfer Station   │◄── USB / Secure File Transfer         │
│  │  (import images, charts, │    from connected workstation          │
│  │   Git bundles, Trivy DB) │                                       │
│  └──────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Git Repository: Internal GitOps Source

### Why Flux Needs an Internal Git Server

Flux CD reconciles the cluster state by watching a Git repository. In a connected environment, this is GitHub or GitLab.com. In an air-gapped environment, Flux needs a Git server accessible from inside the cluster.

### Options

| Option | Complexity | Resources | Recommendation |
|--------|-----------|-----------|----------------|
| **Gitea** | Low | 256MB RAM, 1 CPU | Best for small/tactical deployments |
| **Forgejo** | Low | 256MB RAM, 1 CPU | Fork of Gitea, community-governed |
| **GitLab CE** | High | 4GB RAM, 2 CPU | Best for teams, CI/CD, issue tracking |

### Recommended: Gitea as Platform Addon

Gitea is lightweight, self-contained, and runs well as a Kubernetes deployment:

```yaml
# platform/addons/gitea/helmrelease.yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: gitea
  namespace: gitea
spec:
  chart:
    spec:
      chart: gitea
      version: "10.6.0"
      sourceRef:
        kind: HelmRepository
        name: gitea
  values:
    image:
      repository: harbor.sre.internal/platform/gitea    # From local Harbor
      tag: "1.22.6"
    gitea:
      config:
        server:
          DOMAIN: gitea.sre.yourdomain.com
          ROOT_URL: https://gitea.sre.yourdomain.com/
        repository:
          DEFAULT_BRANCH: main
    persistence:
      enabled: true
      size: 20Gi
    postgresql:
      enabled: true
      persistence:
        enabled: true
        size: 5Gi
```

### Flux Configuration for Internal Git

After deploying Gitea, reconfigure Flux to use the internal Git server:

```yaml
# platform/flux-system/gotk-sync.yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: sre-platform
  namespace: flux-system
spec:
  interval: 5m
  url: https://gitea.sre.yourdomain.com/platform/sre-platform.git
  ref:
    branch: main
  secretRef:
    name: gitea-credentials
```

### Git Bundle Transfer (Air-Gap Updates)

To update the air-gapped Git repo from a connected workstation:

**On connected workstation:**
```bash
# Clone or pull latest from GitHub
git clone https://github.com/your-org/sre-platform.git
cd sre-platform

# Create a bundle (contains all refs and objects)
git bundle create /tmp/sre-platform.bundle --all

# Transfer bundle to air-gapped network via approved media
```

**On air-gapped network:**
```bash
# Clone from the bundle (first time)
git clone /media/usb/sre-platform.bundle sre-platform
cd sre-platform
git remote set-url origin https://gitea.sre.yourdomain.com/platform/sre-platform.git
git push --all origin

# Or fetch incremental updates
cd sre-platform
git fetch /media/usb/sre-platform.bundle main:main
git push origin main
```

---

## 4. Harbor as Image Cache and Registry

Harbor serves as the single source of truth for all container images in an air-gapped environment. Every image referenced by any component must be pre-loaded into Harbor before deployment.

### Pre-Loading Strategy

```
Connected Workstation                     Air-Gapped Harbor
┌──────────────────────┐                ┌──────────────────────┐
│                      │                │                      │
│  1. Pull images from │   USB/SFTP     │  3. Import images    │
│     upstream          │───────────────►│     into Harbor      │
│                      │                │                      │
│  2. Export as OCI    │                │  4. Retag under      │
│     archive bundle   │                │     harbor.sre.      │
│                      │                │     internal/        │
└──────────────────────┘                └──────────────────────┘
```

### Image Inventory: Platform Components

All platform images that must be in Harbor:

```
# Core Infrastructure
harbor.sre.internal/platform/istio-pilot:1.24.x
harbor.sre.internal/platform/istio-proxyv2:1.24.x
harbor.sre.internal/platform/kyverno:1.12.x
harbor.sre.internal/platform/kyverno-background-controller:1.12.x
harbor.sre.internal/platform/kyverno-cleanup-controller:1.12.x
harbor.sre.internal/platform/kyverno-reports-controller:1.12.x

# Monitoring
harbor.sre.internal/platform/prometheus:2.x
harbor.sre.internal/platform/grafana:11.x
harbor.sre.internal/platform/alertmanager:0.27.x
harbor.sre.internal/platform/prometheus-operator:0.x

# Logging
harbor.sre.internal/platform/loki:3.x
harbor.sre.internal/platform/alloy:1.x

# Security
harbor.sre.internal/platform/neuvector-controller:5.x
harbor.sre.internal/platform/neuvector-enforcer:5.x
harbor.sre.internal/platform/neuvector-scanner:5.x
harbor.sre.internal/platform/neuvector-manager:5.x

# Identity
harbor.sre.internal/platform/keycloak:26.x
harbor.sre.internal/platform/postgresql:17.x

# Certificates
harbor.sre.internal/platform/cert-manager-controller:1.16.x
harbor.sre.internal/platform/cert-manager-cainjector:1.16.x
harbor.sre.internal/platform/cert-manager-webhook:1.16.x

# Secrets
harbor.sre.internal/platform/openbao:2.x
harbor.sre.internal/platform/external-secrets:0.x

# Backup
harbor.sre.internal/platform/velero:1.x

# GitOps
harbor.sre.internal/platform/flux-source-controller:1.x
harbor.sre.internal/platform/flux-kustomize-controller:1.x
harbor.sre.internal/platform/flux-helm-controller:1.x
harbor.sre.internal/platform/flux-notification-controller:1.x

# Auth
harbor.sre.internal/platform/oauth2-proxy:7.7.x

# Tracing
harbor.sre.internal/platform/tempo:2.x
```

### Using the Air-Gap Mirror Script

```bash
# On connected workstation: pull and export all platform images
./scripts/airgap-mirror-images.sh

# Creates: /tmp/sre-platform-airgap-bundle.tar.gz
# Contents:
#   - OCI image archives for all platform components
#   - manifest.json with image names and digests
#   - import.sh script for the air-gapped side

# Transfer to air-gapped network
# On air-gapped network:
tar xzf sre-platform-airgap-bundle.tar.gz
cd sre-platform-bundle
./import.sh harbor.sre.internal
```

### Harbor Replication (Semi-Connected)

If Harbor has intermittent internet access (e.g., a semi-connected edge environment), configure Harbor replication policies:

1. In Harbor admin > **Registries** > **New Endpoint**
   - Provider: Docker Hub
   - Endpoint URL: `https://hub.docker.com`
   - Access ID/Secret: Docker Hub credentials

2. In Harbor admin > **Replications** > **New Replication Rule**
   - Name: `platform-images`
   - Source: Docker Hub
   - Source filter: specific image names
   - Destination: Local
   - Trigger: Manual or Scheduled

### Trivy Database for Air-Gap

Trivy needs a vulnerability database to scan images. In air-gapped environments:

**On connected workstation:**
```bash
# Download the latest Trivy DB
trivy --download-db-only

# DB is saved to ~/.cache/trivy/db/trivy.db
# Copy this file to the air-gapped environment
cp ~/.cache/trivy/db/trivy.db /media/usb/trivy.db
```

**On air-gapped Harbor:**
Configure Harbor's Trivy scanner to use a local database. In the Harbor HelmRelease values:

```yaml
trivy:
  offlineScan: true
  skipUpdate: true
  # Mount the pre-downloaded DB via PV or ConfigMap
```

### Helm Charts in Air-Gap

Flux HelmReleases need chart repositories. In air-gap, use Harbor's OCI support:

**On connected workstation:**
```bash
# Pull chart from upstream
helm pull prometheus-community/kube-prometheus-stack --version 66.3.0

# Push to Harbor OCI registry
helm push kube-prometheus-stack-66.3.0.tgz oci://harbor.sre.internal/charts
```

**In Flux HelmRepository:**
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: HelmRepository
metadata:
  name: platform-charts
  namespace: flux-system
spec:
  type: oci
  interval: 10m
  url: oci://harbor.sre.internal/charts
```

---

## 5. TLS Certificates Without Internet

Let's Encrypt requires internet access for ACME challenges. In air-gapped environments, use an internal CA.

### Option A: cert-manager Self-Signed CA (Default)

The platform already includes a self-signed CA chain:

```
selfsigned-root (ClusterIssuer)
  └── sre-root-ca (Certificate, 10-year)
        └── sre-internal-ca (ClusterIssuer)
              └── sre-wildcard-tls (Certificate, 90-day, auto-renewed)
```

This works out of the box. The only requirement is distributing the root CA certificate to clients:

```bash
# Export the root CA certificate
kubectl get secret sre-root-ca-tls -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d > sre-root-ca.crt

# On client machines (Rocky Linux / RHEL):
sudo cp sre-root-ca.crt /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust

# On Ubuntu:
sudo cp sre-root-ca.crt /usr/local/share/ca-certificates/sre-root-ca.crt
sudo update-ca-certificates

# In browsers: import sre-root-ca.crt as a trusted CA
```

### Option B: Organizational CA

If your organization has an existing PKI infrastructure:

1. Obtain a subordinate CA certificate and key from your organizational CA
2. Import as a ClusterIssuer:

```bash
kubectl create secret tls org-sub-ca-tls \
  --namespace cert-manager \
  --cert=org-sub-ca.crt \
  --key=org-sub-ca.key
```

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: org-ca-issuer
spec:
  ca:
    secretName: org-sub-ca-tls
```

3. Update the gateway Certificate to use this issuer.

### Option C: DoD PKI / CAC Integration

For DoD deployments:
- Import the DoD Root CA chain as trusted certificates
- Use a DoD-issued subordinate CA for platform certificates
- Configure Keycloak for CAC/PIV authentication (X.509 client certificate)
- Istio can be configured for mutual TLS with client certificate verification at the gateway

---

## 6. Identity Provider: Keycloak in Air-Gap

### Local User Management

In air-gapped environments, Keycloak cannot federate to external identity providers (Okta, Azure AD, etc.). User management is local:

- Create users directly in Keycloak
- Import users from a CSV/JSON file via Keycloak REST API
- Use local LDAP if available on the air-gapped network

### Local LDAP Federation

If Active Directory or OpenLDAP is available on the air-gapped network:

1. In Keycloak admin > **User federation** > **Add LDAP provider**
2. Configure:
   - Connection URL: `ldap://ad.airgap.local:389`
   - Bind DN: `cn=sre-service,ou=service-accounts,dc=airgap,dc=local`
   - Users DN: `ou=users,dc=airgap,dc=local`
   - Group DN: `ou=groups,dc=airgap,dc=local`
3. Map LDAP groups to Keycloak groups
4. Enable periodic sync (e.g., every 5 minutes)

### Keycloak Themes and Extensions

Custom Keycloak themes or extensions must be pre-packaged into the Keycloak container image:

```dockerfile
FROM harbor.sre.internal/platform/keycloak:26.3.2
COPY themes/sre-theme /opt/keycloak/themes/sre-theme
```

Build and push to Harbor before deploying.

---

## 7. RPOC ATO Portal as Tenant App

The RPOC ATO Portal (Risk Point of Contact Authorization to Operate Portal) can be deployed as a tenant application on the SRE platform itself, providing a self-service compliance management interface.

### Deployment Architecture

```
┌──────────────────────────────────────────────────────┐
│  SRE Platform                                         │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Platform Services                              │  │
│  │  (Istio, Keycloak, Harbor, Monitoring, etc.)    │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Tenant: rpoc-ato-portal                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │  │
│  │  │ Frontend │  │ Backend  │  │ PostgreSQL   │ │  │
│  │  │ (React)  │  │ (API)    │  │ (with PGV)   │ │  │
│  │  └──────────┘  └──────────┘  └──────────────┘ │  │
│  │                                                 │  │
│  │  URL: portal.sre.yourdomain.com                │  │
│  │  Auth: Keycloak SSO (inherited)                │  │
│  │  Scanning: Harbor/Trivy (inherited)            │  │
│  │  Monitoring: Prometheus/Grafana (inherited)    │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Other Tenant Apps                              │  │
│  │  (Keystone, mission apps, etc.)                 │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Deploy via Dashboard

1. Open the SRE Dashboard
2. Go to **Deploy from Git**
3. Enter the RPOC ATO Portal Git URL (from the internal Gitea/GitLab)
4. The dashboard detects the project type and builds/deploys automatically
5. The portal inherits SSO, mTLS, and all platform security controls

### Integration Points

The ATO Portal can consume SRE platform data to auto-populate compliance evidence:

| Data Source | API | Use in Portal |
|-------------|-----|---------------|
| Kyverno policy reports | `kubectl get policyreport` | Auto-fill CM-7, AC-6 evidence |
| Harbor Trivy scans | Harbor API `/api/v2.0/projects/<name>/repositories/<repo>/artifacts/<tag>/scan` | Auto-fill RA-5 evidence |
| NeuVector alerts | NeuVector REST API | Auto-fill SI-4 evidence |
| Prometheus metrics | PromQL via Grafana API | Auto-fill CA-7 evidence |
| cert-manager certs | K8s API for Certificate resources | Auto-fill SC-12 evidence |
| Flux reconciliation | Flux API / kubectl | Auto-fill CM-2, CM-3 evidence |

---

## 8. Network Considerations

### DNS in Air-Gap

Without external DNS, you need an internal DNS server:

**Option A: CoreDNS Custom Zone**

RKE2 includes CoreDNS. Add a custom zone for platform services:

```yaml
# platform/core/coredns-custom/coredns-custom.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  sre.server: |
    sre.yourdomain.com:53 {
      file /etc/coredns/sre.db
      errors
      log
    }
  sre.db: |
    $ORIGIN sre.yourdomain.com.
    @       IN SOA  ns1.sre.yourdomain.com. admin.sre.yourdomain.com. 2024010101 3600 1800 604800 86400
    @       IN NS   ns1.sre.yourdomain.com.
    ns1     IN A    192.168.2.200
    *       IN A    192.168.2.200
```

This resolves `*.sre.yourdomain.com` to the gateway IP for all pods in the cluster.

**Option B: Dedicated DNS Server (dnsmasq or BIND)**

For client machines on the air-gapped network:

```bash
# dnsmasq configuration
address=/sre.yourdomain.com/192.168.2.200
```

**Option C: /etc/hosts on All Clients**

For small deployments:

```
192.168.2.200 dashboard.sre.yourdomain.com
192.168.2.200 keycloak.sre.yourdomain.com
192.168.2.200 harbor.sre.yourdomain.com
192.168.2.200 grafana.sre.yourdomain.com
192.168.2.200 portal.sre.yourdomain.com
```

### NTP in Air-Gap

Accurate time is critical for:
- TLS certificate validation
- Keycloak token expiry
- Audit log timestamps (NIST AU-8)
- Istio mTLS certificate rotation

**Options:**
1. **GPS clock** connected to one node, acting as stratum 1 NTP server
2. **Rubidium/cesium clock** for high-precision environments
3. **Manual time sync** via USB-connected NTP appliance
4. **chrony** configured with a local NTP server IP

```bash
# /etc/chrony.conf on all nodes
server ntp.airgap.local iburst
```

### Network Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Air-Gapped Network Segment                                   │
│                                                               │
│  ┌─────────────┐     ┌─────────────────────────────────────┐ │
│  │ User         │     │  SRE Cluster                         │ │
│  │ Workstations │     │                                      │ │
│  │              │     │  ┌─────────┐  ┌──────────┐          │ │
│  │ 192.168.1.0  │────►│  │ MetalLB │  │ Node 1   │          │ │
│  │  /24         │     │  │ Gateway │  │ (CP)     │          │ │
│  │              │     │  │ .2.200  │  │ .2.10    │          │ │
│  └─────────────┘     │  └─────────┘  └──────────┘          │ │
│                       │               ┌──────────┐          │ │
│  ┌─────────────┐     │               │ Node 2   │          │ │
│  │ NTP Server  │     │               │ (CP)     │          │ │
│  │ .1.5        │     │               │ .2.11    │          │ │
│  └─────────────┘     │               └──────────┘          │ │
│                       │               ┌──────────┐          │ │
│  ┌─────────────┐     │               │ Node 3   │          │ │
│  │ DNS Server  │     │               │ (Worker) │          │ │
│  │ .1.2        │     │               │ .2.12    │          │ │
│  └─────────────┘     │               └──────────┘          │ │
│                       └─────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────┐                                             │
│  │ Data Transfer│◄── USB / approved media from connected net  │
│  │ Station      │                                             │
│  │ .1.100       │                                             │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
```

### Firewall Rules (Internal)

Even in an air-gapped network, internal firewall rules should follow least-privilege:

| Source | Destination | Port | Purpose |
|--------|-------------|------|---------|
| User workstations | MetalLB IP (192.168.2.200) | 443 | HTTPS to all services |
| User workstations | MetalLB IP (192.168.2.200) | 80 | HTTP redirect |
| Cluster nodes | Cluster nodes | 6443 | Kubernetes API |
| Cluster nodes | Cluster nodes | 9345 | RKE2 join |
| Cluster nodes | Cluster nodes | 2379-2380 | etcd |
| Cluster nodes | Cluster nodes | 10250 | Kubelet |
| All | NTP server | 123/UDP | Time sync |
| All | DNS server | 53 | Name resolution |
| Data transfer station | Harbor (via cluster) | 443 | Image upload |

---

## 9. Suggested Architecture

### Small Deployment (Lab/Tactical)

**Nodes**: 3 (combined control plane + worker)
**Fit for**: 5-10 tenant apps, 10-50 users

```
Node 1 (CP + Worker):  Harbor, Keycloak, Gitea
Node 2 (CP + Worker):  Monitoring, Logging, Apps
Node 3 (CP + Worker):  Apps, NeuVector, Backup
```

All platform services (Harbor, Gitea, Keycloak) run on the same cluster. This minimizes hardware but creates a single-cluster dependency.

### Medium Deployment (Base/Enterprise)

**Nodes**: 6 (3 CP + 3 Workers) + 1 utility node
**Fit for**: 20-50 tenant apps, 50-200 users

```
Control Plane (3 nodes):
  Node 1-3: Kubernetes control plane, etcd

Workers (3 nodes):
  Node 4: Platform services (Istio, monitoring, logging)
  Node 5: Identity + Registry (Keycloak, Harbor, Gitea)
  Node 6: Tenant applications

Utility (1 node):
  Node 7: Data transfer station, NTP server, DNS server
           (not part of K8s cluster)
```

### Large Deployment (Multi-Enclave)

**Nodes**: 12+ across 2 clusters
**Fit for**: 50+ tenant apps, 200+ users, multiple classification levels

```
Management Cluster (3 CP + 2 Workers):
  - GitLab CE (full CI/CD)
  - Harbor (primary registry)
  - Keycloak (master realm)
  - Monitoring aggregation (Thanos/Mimir)

Workload Cluster (3 CP + 4+ Workers):
  - SRE platform services
  - Tenant applications
  - Connects to management cluster for GitOps, images, identity
```

---

## 10. Migration Path: Lab to Air-Gapped

### Phase 1: Develop on Connected Lab

1. Build and test on the connected lab (192.168.2.0/24 network)
2. All platform components work, all apps deploy successfully
3. Document every image, chart, and external dependency

### Phase 2: Inventory and Bundle

```bash
# List all images in use on the cluster
kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u > image-inventory.txt

# List all Helm charts in use
flux get helmreleases -A -o json | jq -r '.[] | .spec.chart.spec.chart + ":" + .spec.chart.spec.version' | sort -u > chart-inventory.txt

# Run the air-gap mirror script to bundle everything
./scripts/airgap-mirror-images.sh

# Create Git bundles
cd ~/sre/sre-platform
git bundle create /tmp/sre-platform.bundle --all
```

### Phase 3: Prepare Air-Gapped Environment

1. Provision nodes (OpenTofu + Ansible or manual)
2. Install RKE2 from offline tarball:
```bash
# Download RKE2 tarball on connected machine
curl -OL https://github.com/rancher/rke2/releases/download/v1.31.4+rke2r1/rke2-images.linux-amd64.tar.zst
curl -OL https://github.com/rancher/rke2/releases/download/v1.31.4+rke2r1/rke2.linux-amd64.tar.gz
curl -OL https://github.com/rancher/rke2/releases/download/v1.31.4+rke2r1/sha256sum-amd64.txt

# Transfer to air-gapped nodes and install
sudo mkdir -p /var/lib/rancher/rke2/agent/images/
sudo cp rke2-images.linux-amd64.tar.zst /var/lib/rancher/rke2/agent/images/
sudo tar xzf rke2.linux-amd64.tar.gz -C /usr/local
```

3. Bootstrap Flux with local Git source
4. Deploy Harbor first (needed for all other images)
5. Import all images into Harbor
6. Deploy remaining platform components

### Phase 4: Deploy and Validate

```
Deployment Order (Air-Gapped):
  1. Harbor (first — all other images come from here)
  2. Gitea (Flux GitOps source)
  3. cert-manager (internal CA for TLS)
  4. Istio (service mesh)
  5. Kyverno (admission control — update registry policy for harbor.sre.internal)
  6. Monitoring stack
  7. Logging stack
  8. Keycloak (identity)
  9. OAuth2 Proxy (authentication)
  10. NeuVector (runtime security)
  11. OpenBao + ESO (secrets)
  12. Velero (backup)
  13. Tenant apps
```

### Phase 5: Ongoing Updates

Establish a regular update cadence:

```
Connected Lab                    Air-Gapped
────────────                     ──────────
1. Pull new versions             4. Import images
2. Test on connected lab         5. Update Git repo
3. Create transfer bundle        6. Flux reconciles
                                 7. Validate
   ────── USB Transfer ──────►
```

---

## 11. Day-2 Operations in Air-Gap

### Updating Platform Components

1. On connected workstation: pull new chart versions and images
2. Bundle and transfer to air-gapped network
3. Import images into Harbor
4. Push Helm charts to Harbor OCI registry
5. Update HelmRelease versions in Git
6. Push to internal Gitea
7. Flux detects changes and reconciles

### Updating Trivy CVE Database

The Trivy vulnerability database must be updated regularly:

```bash
# On connected workstation (weekly recommended):
trivy image --download-db-only
cp ~/.cache/trivy/db/trivy.db /media/usb/trivy-db-$(date +%Y%m%d).db

# On air-gapped Harbor:
# Upload the DB file and configure Harbor's Trivy scanner to use it
```

### Certificate Rotation

cert-manager handles automatic rotation of the wildcard TLS certificate. The internal CA root certificate has a 10-year validity. Plan for root CA rotation well in advance:

1. Generate new root CA certificate
2. Deploy new ClusterIssuer alongside the old one
3. Gradually migrate services to the new CA
4. Distribute the new root CA to all clients
5. Remove the old CA after all certificates have been re-issued

### Backup and Disaster Recovery

Velero backups in air-gapped environments use local S3-compatible storage (MinIO):

```yaml
# Velero BackupStorageLocation
apiVersion: velero.io/v1
kind: BackupStorageLocation
metadata:
  name: default
  namespace: velero
spec:
  provider: aws
  objectStorage:
    bucket: velero-backups
  config:
    region: minio
    s3ForcePathStyle: "true"
    s3Url: http://minio.minio.svc.cluster.local:9000
```

---

## 12. Hardware Planning

### Minimum Requirements Per Node

| Role | CPU | RAM | Storage | Network |
|------|-----|-----|---------|---------|
| Control Plane | 4 vCPU | 16 GB | 100 GB SSD (OS) + 50 GB (etcd) | 1 Gbps |
| Worker | 8 vCPU | 32 GB | 100 GB SSD (OS) + 200 GB (container runtime) | 1 Gbps |
| Harbor storage | - | - | 500 GB - 2 TB (depends on image count) | - |
| Monitoring storage | - | - | 200 GB (Prometheus) + 500 GB (Loki) | - |

### Storage Considerations

| Data | Typical Size | Growth Rate | Retention |
|------|-------------|-------------|-----------|
| Container images (Harbor) | 50-200 GB | 5-10 GB/month | Pruned per policy |
| Prometheus metrics | 50-100 GB | 2-5 GB/day | 15 days in-cluster |
| Loki logs | 100-500 GB | 5-20 GB/day | 90 days |
| etcd | 5-10 GB | Slow | Compacted |
| Velero backups | 50-200 GB | 10-50 GB/backup | 7 daily, 4 weekly, 3 monthly |

### Network Bandwidth

| Traffic | Bandwidth Requirement |
|---------|----------------------|
| User access (HTTPS) | 100 Mbps per 100 concurrent users |
| Inter-node (etcd, API) | 1 Gbps minimum |
| Image pulls (Harbor) | 1 Gbps (burst during deployments) |
| Monitoring/logging | 100-500 Mbps continuous |

---

## 13. Checklist: Before You Disconnect

Before transitioning from a connected lab to an air-gapped deployment, verify:

### Images

- [ ] All platform images inventoried (`kubectl get pods -A` image list)
- [ ] All images pushed to Harbor
- [ ] Harbor garbage collection run to verify images are not dangling
- [ ] Trivy database downloaded and imported
- [ ] Kyverno registry restriction policy updated for air-gapped Harbor hostname

### Git

- [ ] All platform manifests committed and pushed to internal Git server
- [ ] Flux GitRepository source updated to internal Git server URL
- [ ] Flux successfully reconciling from internal Git (test by making a change)

### Certificates

- [ ] Internal CA chain deployed and functioning
- [ ] Wildcard certificate issued and applied to Istio gateway
- [ ] Root CA certificate distributed to all client machines
- [ ] cert-manager renewal verified (accelerate renewal to test)

### Identity

- [ ] Keycloak running with local user database or local LDAP
- [ ] All required users created and assigned to groups
- [ ] OAuth2 Proxy authenticating against local Keycloak
- [ ] SSO flow tested end-to-end (browser to app)

### DNS

- [ ] Internal DNS resolving `*.sre.yourdomain.com` to gateway IP
- [ ] All client machines using internal DNS
- [ ] CoreDNS custom zone configured for in-cluster resolution

### Time

- [ ] NTP server deployed on air-gapped network
- [ ] All nodes syncing to local NTP server
- [ ] Time drift under 1 second across all nodes

### Monitoring

- [ ] Prometheus scraping all targets (no "down" targets)
- [ ] Grafana dashboards rendering data
- [ ] Alertmanager configured with local notification channels
- [ ] Loki receiving logs from all nodes

### Backup

- [ ] Velero configured with local S3 storage
- [ ] Test backup created and verified
- [ ] Test restore performed to verify recovery works
- [ ] Backup schedule active

### Security

- [ ] Kyverno policies enforcing (or auditing with documented plan to enforce)
- [ ] NeuVector scanning all running containers
- [ ] NetworkPolicies in all tenant namespaces
- [ ] No external URLs in any platform configuration

### Documentation

- [ ] Air-gapped update procedure documented
- [ ] Image inventory document created
- [ ] Transfer procedure documented (who, how, approval process)
- [ ] Incident response runbook adapted for air-gap (no internet-based tools)
- [ ] Root CA certificate distribution procedure documented
