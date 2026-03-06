#!/usr/bin/env bash
# ============================================================================
# SRE Platform — One-Button Deploy
# ============================================================================
# Deploys the full Secure Runtime Environment to any Kubernetes cluster.
#
# What this script does:
#   1. Validates prerequisites (kubectl, flux, git, helm)
#   2. Checks cluster connectivity and readiness
#   3. Installs local-path-provisioner (if no default StorageClass)
#   4. Loads kernel modules for Istio (if accessible)
#   4b. Configures firewalld to trust pod/service CIDRs (RKE2+Canal fix)
#   5. Bootstraps Flux CD from this Git repo
#   6. Waits for all platform components to become healthy
#   7. Creates bootstrap secrets (Grafana, etc.)
#   8. Prints access information
#
# Usage:
#   ./scripts/sre-deploy.sh
#
# Environment variable overrides:
#   KUBECONFIG            — Path to kubeconfig (default: ~/.kube/config)
#   GITHUB_TOKEN          — GitHub PAT for Flux bootstrap (will prompt if unset)
#   GITHUB_REPO           — GitHub repo (default: auto-detected from git remote)
#   GITHUB_OWNER          — GitHub owner/org (default: auto-detected)
#   SRE_BRANCH            — Git branch (default: main)
#   SRE_ENVIRONMENT       — Environment size: small, single-node (default: auto)
#   SKIP_STORAGE          — Set to 1 to skip StorageClass setup
#   SKIP_SECRETS          — Set to 1 to skip secret generation
#   SKIP_WAIT             — Set to 1 to skip waiting for components
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${BLUE}[sre]${NC} $*"; }
success() { echo -e "${GREEN}[sre]${NC} $*"; }
warn()    { echo -e "${YELLOW}[sre]${NC} $*"; }
error()   { echo -e "${RED}[sre]${NC} $*" >&2; }
fatal()   { error "$*"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================

header "SRE Platform — One-Button Deploy"

log "Checking prerequisites..."

MISSING=""
for tool in kubectl flux git; do
    if ! command -v "$tool" &>/dev/null; then
        MISSING="$MISSING $tool"
    fi
done

if [[ -n "$MISSING" ]]; then
    error "Missing required tools:$MISSING"
    echo
    echo "Install them:"
    echo "  kubectl: https://kubernetes.io/docs/tasks/tools/"
    echo "  flux:    curl -s https://fluxcd.io/install.sh | bash"
    echo "  git:     sudo apt install git (or brew install git)"
    exit 1
fi

success "All prerequisites found"

# ============================================================================
# Step 2: Check Cluster Connectivity
# ============================================================================

header "Checking Cluster"

if ! kubectl cluster-info &>/dev/null; then
    fatal "Cannot connect to Kubernetes cluster. Check your KUBECONFIG."
fi

NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)
if (( NODE_COUNT == 0 )); then
    fatal "No nodes found in the cluster."
fi

success "Connected to cluster with $NODE_COUNT node(s)"

# Auto-detect environment size
SRE_ENVIRONMENT="${SRE_ENVIRONMENT:-}"
if [[ -z "$SRE_ENVIRONMENT" ]]; then
    if (( NODE_COUNT == 1 )); then
        SRE_ENVIRONMENT="single-node"
        log "Auto-detected single-node environment"
    elif (( NODE_COUNT <= 3 )); then
        SRE_ENVIRONMENT="small"
        log "Auto-detected small environment ($NODE_COUNT nodes)"
    else
        SRE_ENVIRONMENT="default"
        log "Using default environment ($NODE_COUNT nodes)"
    fi
fi

# ── SSH Configuration (for node access) ───────────────────────────────────

SSH_USER="${SSH_USER:-sre-admin}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/sre-lab}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"
if [[ -f "$SSH_KEY" ]]; then
    SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

# ============================================================================
# Step 3: StorageClass Setup
# ============================================================================

if [[ "${SKIP_STORAGE:-}" != "1" ]]; then
    header "Storage Setup"

    DEFAULT_SC=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || echo "")

    if [[ -z "$DEFAULT_SC" ]]; then
        log "No default StorageClass found. Installing local-path-provisioner..."

        # Create namespace with privileged PSA (needed for helper pods)
        kubectl create namespace local-path-storage --dry-run=client -o yaml | kubectl apply -f -
        kubectl label namespace local-path-storage \
            pod-security.kubernetes.io/enforce=privileged \
            pod-security.kubernetes.io/audit=privileged \
            --overwrite

        # Install local-path-provisioner
        kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.30/deploy/local-path-provisioner.yaml

        # Set as default
        kubectl patch storageclass local-path \
            -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' \
            2>/dev/null || true

        # Configure for SELinux if applicable
        for node_ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
            ssh $SSH_OPTS "${SSH_USER}@${node_ip}" \
                "sudo mkdir -p /opt/local-path-provisioner && sudo chcon -R -t container_file_t /opt/local-path-provisioner" \
                2>/dev/null || true
        done

        success "local-path-provisioner installed as default StorageClass"
    else
        success "Default StorageClass already exists: $DEFAULT_SC"
    fi
fi

# ============================================================================
# Step 4: Kernel Modules for Istio
# ============================================================================

header "Kernel Module Setup"

log "Loading Istio-required kernel modules on nodes..."
log "(SSH user: $SSH_USER, key: $SSH_KEY — override with SSH_USER and SSH_KEY env vars)"
MODULES_LOADED=0
for node_ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
    ssh $SSH_OPTS "${SSH_USER}@${node_ip}" \
        "sudo modprobe xt_REDIRECT 2>/dev/null; sudo modprobe xt_owner 2>/dev/null; \
         echo 'xt_REDIRECT' | sudo tee /etc/modules-load.d/istio.conf >/dev/null; \
         echo 'xt_owner' | sudo tee -a /etc/modules-load.d/istio.conf >/dev/null; \
         sudo sysctl -w fs.inotify.max_user_instances=512 >/dev/null 2>&1; \
         sudo sysctl -w fs.inotify.max_user_watches=524288 >/dev/null 2>&1" \
        2>/dev/null && MODULES_LOADED=$((MODULES_LOADED + 1)) || true
done

if (( MODULES_LOADED > 0 )); then
    success "Kernel modules loaded on $MODULES_LOADED node(s)"
else
    warn "Could not SSH to nodes to load kernel modules (may already be loaded)"
fi

# --- Firewalld: trust pod and service CIDRs ---
# On RKE2 with Canal (Calico + Flannel), Calico creates cali* veth interfaces
# per pod that are NOT in any firewalld zone. Firewalld's nftables rules run
# AFTER Calico's iptables rules and REJECT cross-node pod traffic.
# Fix: add pod/service CIDRs as trusted sources so firewalld allows the traffic.
log "Configuring firewalld trusted zone for pod/service CIDRs..."
FW_FIXED=0
for node_ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
    ssh $SSH_OPTS "${SSH_USER}@${node_ip}" \
        "if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then \
           sudo firewall-cmd --zone=trusted --add-source=10.42.0.0/16 --permanent 2>/dev/null; \
           sudo firewall-cmd --zone=trusted --add-source=10.43.0.0/16 --permanent 2>/dev/null; \
           sudo firewall-cmd --zone=trusted --add-source=10.42.0.0/16 2>/dev/null; \
           sudo firewall-cmd --zone=trusted --add-source=10.43.0.0/16 2>/dev/null; \
           echo 'firewalld configured'; \
         else \
           echo 'firewalld not active'; \
         fi" \
        2>/dev/null && FW_FIXED=$((FW_FIXED + 1)) || true
done

if (( FW_FIXED > 0 )); then
    success "Firewalld configured on $FW_FIXED node(s) — pod CIDRs trusted"
else
    warn "Could not configure firewalld on nodes (may not be running)"
fi

# ============================================================================
# Step 5: Detect GitHub Repo
# ============================================================================

header "Git Configuration"

# Auto-detect from git remote
REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")

if [[ -z "${GITHUB_OWNER:-}" ]] || [[ -z "${GITHUB_REPO:-}" ]]; then
    if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
        GITHUB_OWNER="${GITHUB_OWNER:-${BASH_REMATCH[1]}}"
        GITHUB_REPO="${GITHUB_REPO:-${BASH_REMATCH[2]}}"
    else
        fatal "Could not detect GitHub owner/repo from git remote. Set GITHUB_OWNER and GITHUB_REPO."
    fi
fi

SRE_BRANCH="${SRE_BRANCH:-main}"

log "Repository: ${GITHUB_OWNER}/${GITHUB_REPO} (branch: ${SRE_BRANCH})"

# Get GitHub token
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo
    echo -e "${CYAN}?${NC} GitHub Personal Access Token (needs repo scope):"
    echo -e "  Create one at: https://github.com/settings/tokens/new"
    echo -e "  Select scope: ${BOLD}repo${NC} (Full control of private repositories)"
    echo
    read -rsp "  Token: " GITHUB_TOKEN
    echo
    if [[ -z "$GITHUB_TOKEN" ]]; then
        fatal "GitHub token is required for Flux bootstrap."
    fi
fi
export GITHUB_TOKEN

success "GitHub configuration ready"

# ============================================================================
# Step 6: Bootstrap Flux CD
# ============================================================================

header "Bootstrapping Flux CD"

# Check if Flux is already installed
if kubectl get namespace flux-system &>/dev/null && kubectl get deployment source-controller -n flux-system &>/dev/null; then
    warn "Flux is already installed. Reconciling..."
    flux reconcile source git flux-system 2>/dev/null || true
else
    log "Installing Flux CD..."
    flux bootstrap github \
        --owner="$GITHUB_OWNER" \
        --repository="$GITHUB_REPO" \
        --branch="$SRE_BRANCH" \
        --path=platform/flux-system \
        --personal \
        --token-auth

    success "Flux CD bootstrapped"
fi

# ============================================================================
# Step 7: Apply Environment Overrides
# ============================================================================

if [[ "$SRE_ENVIRONMENT" != "default" ]] && [[ -d "$REPO_ROOT/platform/environments/$SRE_ENVIRONMENT" ]]; then
    header "Applying Environment: $SRE_ENVIRONMENT"

    log "Deploying environment-specific ConfigMaps..."
    kubectl apply -f "$REPO_ROOT/platform/environments/$SRE_ENVIRONMENT/" --recursive 2>/dev/null || true

    success "Environment overrides applied"
fi

# ============================================================================
# Step 8: Bootstrap Secrets
# ============================================================================

if [[ "${SKIP_SECRETS:-}" != "1" ]]; then
    header "Creating Platform Secrets"

    if [[ -x "$SCRIPT_DIR/bootstrap-secrets.sh" ]]; then
        bash "$SCRIPT_DIR/bootstrap-secrets.sh"
    else
        warn "bootstrap-secrets.sh not found. Skipping secret creation."
    fi
fi

# ============================================================================
# Step 9: Wait for Components
# ============================================================================

if [[ "${SKIP_WAIT:-}" != "1" ]]; then
    header "Waiting for Platform Components"

    log "This may take 5-15 minutes on first deploy..."
    echo

    COMPONENTS=(
        "istio-system/istio-base"
        "istio-system/istiod"
        "istio-system/istio-gateway"
        "cert-manager/cert-manager"
        "kyverno/kyverno"
        "monitoring/kube-prometheus-stack"
        "logging/loki"
        "logging/alloy"
        "openbao/openbao"
        "external-secrets/external-secrets"
        "neuvector/neuvector"
        "tempo/tempo"
        "velero/velero"
    )

    MAX_WAIT=900  # 15 minutes
    START_TIME=$(date +%s)
    ALL_READY=false

    while true; do
        ELAPSED=$(( $(date +%s) - START_TIME ))
        if (( ELAPSED > MAX_WAIT )); then
            warn "Timeout waiting for all components after ${MAX_WAIT}s"
            break
        fi

        READY_COUNT=0
        TOTAL=${#COMPONENTS[@]}

        for comp in "${COMPONENTS[@]}"; do
            ns="${comp%%/*}"
            name="${comp##*/}"
            status=$(kubectl get helmrelease "$name" -n "$ns" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
            if [[ "$status" == "True" ]]; then
                READY_COUNT=$((READY_COUNT + 1))
            fi
        done

        printf "\r  [%3ds] %d/%d HelmReleases ready" "$ELAPSED" "$READY_COUNT" "$TOTAL"

        if (( READY_COUNT == TOTAL )); then
            ALL_READY=true
            echo
            break
        fi

        sleep 10
    done

    if $ALL_READY; then
        success "All platform components are healthy!"
    else
        echo
        warn "Some components are not ready yet. Check with: flux get helmreleases -A"
    fi
fi

# ============================================================================
# Step 10: Print Access Info
# ============================================================================

header "Deployment Complete!"

echo -e "${BOLD}Your SRE platform is deployed.${NC}"
echo
echo -e "  ${BOLD}Quick commands:${NC}"
echo -e "    View status:      ${CYAN}flux get helmreleases -A${NC}"
echo -e "    Verify deploy:    ${CYAN}./scripts/verify-deployment.sh${NC}"
echo -e "    Access services:  ${CYAN}./scripts/sre-access.sh${NC}"
echo -e "    Grafana:          ${CYAN}./scripts/sre-access.sh grafana${NC}"
echo

# Show Grafana credentials if available
GRAFANA_PASS=$(kubectl get secret grafana-admin-credentials -n monitoring -o jsonpath='{.data.adminPassword}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$GRAFANA_PASS" ]]; then
    echo -e "  ${BOLD}Grafana:${NC}"
    echo -e "    Username: admin"
    echo -e "    Password: $GRAFANA_PASS"
    echo
fi

# ── Deploy SRE Dashboard ──────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
    log "Building and deploying SRE Dashboard..."
    DASHBOARD_DIR="$(cd "$(dirname "$0")/../apps/dashboard" && pwd)"
    if [[ -f "$DASHBOARD_DIR/Dockerfile" ]]; then
        (cd "$DASHBOARD_DIR" && docker build -t sre-dashboard:v1.2.0 . 2>/dev/null) && \
        docker save sre-dashboard:v1.2.0 -o /tmp/sre-dashboard.tar 2>/dev/null && \
        for node_ip in $(kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'); do
            scp $SSH_OPTS /tmp/sre-dashboard.tar "${SSH_USER}@${node_ip}:/tmp/sre-dashboard.tar" 2>/dev/null && \
            ssh $SSH_OPTS "${SSH_USER}@${node_ip}" \
                "sudo /var/lib/rancher/rke2/bin/ctr --address /run/k3s/containerd/containerd.sock --namespace k8s.io images import /tmp/sre-dashboard.tar && rm -f /tmp/sre-dashboard.tar" 2>/dev/null || true
        done
        rm -f /tmp/sre-dashboard.tar
        kubectl apply -f "$DASHBOARD_DIR/k8s/" 2>/dev/null && \
        kubectl rollout status deployment/sre-dashboard -n sre-dashboard --timeout=60s 2>/dev/null && \
        success "SRE Dashboard deployed" || warn "Dashboard deploy failed (non-critical, deploy manually later with apps/dashboard/build-and-deploy.sh)"
    fi
else
    warn "Docker not found — skipping SRE Dashboard build. Deploy manually later with apps/dashboard/build-and-deploy.sh"
fi

# ============================================================================
# Step 11: Print Full Access Guide
# ============================================================================

header "How to Access Your Platform"

# Get a node IP and the HTTPS NodePort
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "YOUR_NODE_IP")
HTTPS_PORT=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "31443")

echo -e "${BOLD}Step 1: Add DNS entries to your machine${NC}"
echo
echo -e "  Run this on the machine where you'll open a browser:"
echo
echo -e "  ${CYAN}echo \"${NODE_IP}  dashboard.apps.sre.example.com grafana.apps.sre.example.com prometheus.apps.sre.example.com alertmanager.apps.sre.example.com harbor.apps.sre.example.com keycloak.apps.sre.example.com neuvector.apps.sre.example.com\" | sudo tee -a /etc/hosts${NC}"
echo

echo -e "${BOLD}Step 2: Open the Dashboard${NC}"
echo
echo -e "  ${CYAN}https://dashboard.apps.sre.example.com:${HTTPS_PORT}${NC}"
echo
echo -e "  (Accept the self-signed certificate warning in your browser)"
echo

echo -e "${BOLD}All Platform UIs:${NC}"
echo
printf "  %-15s %s\n" "Dashboard" "https://dashboard.apps.sre.example.com:${HTTPS_PORT}"
printf "  %-15s %s  (%s)\n" "Grafana" "https://grafana.apps.sre.example.com:${HTTPS_PORT}" "admin / prom-operator"
printf "  %-15s %s\n" "Prometheus" "https://prometheus.apps.sre.example.com:${HTTPS_PORT}"
printf "  %-15s %s\n" "Alertmanager" "https://alertmanager.apps.sre.example.com:${HTTPS_PORT}"
printf "  %-15s %s  (%s)\n" "Harbor" "https://harbor.apps.sre.example.com:${HTTPS_PORT}" "admin / Harbor12345"
printf "  %-15s %s  (%s)\n" "Keycloak" "https://keycloak.apps.sre.example.com:${HTTPS_PORT}" "admin / auto-generated"
printf "  %-15s %s  (%s)\n" "NeuVector" "https://neuvector.apps.sre.example.com:${HTTPS_PORT}" "admin / admin"
echo

echo -e "${BOLD}Useful commands:${NC}"
echo
echo -e "  ${CYAN}./scripts/sre-access.sh${NC}           # Show all URLs and credentials"
echo -e "  ${CYAN}./scripts/sre-access.sh status${NC}    # Health check"
echo -e "  ${CYAN}./scripts/sre-access.sh creds${NC}     # Show all passwords"
echo -e "  ${CYAN}./scripts/sre-new-tenant.sh my-team${NC}  # Create a new team namespace"
echo

echo -e "${BOLD}Cluster nodes (use any IP for DNS):${NC}"
echo
kubectl get nodes -o jsonpath='{range .items[*]}  {.metadata.name}{"  "}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' 2>/dev/null
echo

success "SRE Platform deployment complete. Open the dashboard to get started!"
