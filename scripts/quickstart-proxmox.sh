#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Proxmox VE Quickstart
# ============================================================================
# Deploys the full Secure Runtime Environment to a Proxmox VE host in one run.
#
# What this script does:
#   1. Checks that all required CLI tools are installed
#   2. Prompts for Proxmox connection details
#   3. Generates an SSH key pair (if needed)
#   4. Builds a hardened Rocky Linux 9 VM template with Packer
#   5. Provisions control plane + worker VMs with OpenTofu
#   6. Generates an Ansible inventory from the OpenTofu output
#   7. Hardens the OS and installs RKE2 with Ansible
#   8. Retrieves the kubeconfig
#   9. (Optionally) bootstraps Flux CD for GitOps
#
# Usage:
#   ./scripts/quickstart-proxmox.sh
#
# Requirements:
#   - Proxmox VE 8.x with API access
#   - Rocky Linux 9 ISO uploaded to Proxmox storage
#   - An API token with PVEVMAdmin role (see docs/getting-started-proxmox.md)
#
# Environment variable overrides (skip prompts):
#   PROXMOX_URL          — https://pve.example.com:8006
#   PROXMOX_NODE         — Proxmox node name (e.g., pve)
#   PROXMOX_USER         — API user (e.g., packer@pve!packer-token)
#   PROXMOX_TOKEN        — API token secret
#   PROXMOX_ISO          — ISO path (e.g., local:iso/Rocky-9.5-x86_64-minimal.iso)
#   PROXMOX_STORAGE      — Storage pool (e.g., local-lvm)
#   PROXMOX_BRIDGE       — Network bridge (e.g., vmbr0)
#   SSH_KEY_PATH         — Path to SSH private key
#   SERVER_COUNT         — Control plane nodes (default: 1)
#   AGENT_COUNT          — Worker nodes (default: 2)
#   SKIP_PACKER          — Set to 1 to skip Packer build (template already exists)
#   SKIP_FLUX            — Set to 1 to skip Flux bootstrap
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Helpers ─────────────────────────────────────────────────────────────────

log()     { echo -e "${BLUE}[SRE]${NC} $*"; }
success() { echo -e "${GREEN}[SRE]${NC} $*"; }
warn()    { echo -e "${YELLOW}[SRE]${NC} $*"; }
error()   { echo -e "${RED}[SRE]${NC} $*" >&2; }
fatal()   { error "$*"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

prompt() {
    local var_name="$1" prompt_text="$2" default="${3:-}"
    # If the variable is already set via env, use it
    local current_val="${!var_name:-}"
    if [[ -n "$current_val" ]]; then
        log "Using $var_name from environment: $current_val"
        return
    fi
    if [[ -n "$default" ]]; then
        read -rp "$(echo -e "${CYAN}?${NC}") $prompt_text [$default]: " input
        eval "$var_name=\"${input:-$default}\""
    else
        while true; do
            read -rp "$(echo -e "${CYAN}?${NC}") $prompt_text: " input
            if [[ -n "$input" ]]; then
                eval "$var_name=\"$input\""
                return
            fi
            warn "This field is required."
        done
    fi
}

prompt_secret() {
    local var_name="$1" prompt_text="$2"
    local current_val="${!var_name:-}"
    if [[ -n "$current_val" ]]; then
        log "Using $var_name from environment: [hidden]"
        return
    fi
    while true; do
        read -srp "$(echo -e "${CYAN}?${NC}") $prompt_text: " input
        echo
        if [[ -n "$input" ]]; then
            eval "$var_name=\"$input\""
            return
        fi
        warn "This field is required."
    done
}

prompt_yesno() {
    local prompt_text="$1" default="${2:-y}"
    local yn
    read -rp "$(echo -e "${CYAN}?${NC}") $prompt_text [${default}]: " yn
    yn="${yn:-$default}"
    [[ "$yn" =~ ^[Yy] ]]
}

spin() {
    local pid=$1 msg="$2"
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while kill -0 "$pid" 2>/dev/null; do
        for (( i=0; i<${#spinstr}; i++ )); do
            printf "\r  ${CYAN}%s${NC} %s" "${spinstr:$i:1}" "$msg"
            sleep 0.1
        done
    done
    printf "\r  ${GREEN}✓${NC} %s\n" "$msg"
    wait "$pid"
}

# ── Find repo root ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO_ROOT/CLAUDE.md" ]]; then
    fatal "Cannot find the SRE platform repository. Run this script from within the repo."
fi

cd "$REPO_ROOT"

# ============================================================================
# Phase 0: Check Prerequisites
# ============================================================================

header "Phase 0: Checking Prerequisites"

MISSING_TOOLS=()
for tool in packer tofu ansible-playbook kubectl helm jq ssh-keygen; do
    if ! command -v "$tool" &>/dev/null; then
        MISSING_TOOLS+=("$tool")
    fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
    error "Missing required tools: ${MISSING_TOOLS[*]}"
    echo
    echo "Install them following the guide:"
    echo "  https://github.com/morbidsteve/sre-platform/blob/main/docs/getting-started-proxmox.md#local-workstation-tools"
    echo
    echo "Quick install (macOS):"
    echo "  brew install opentofu packer ansible kubectl helm jq"
    echo
    echo "Quick install (Linux):"
    echo "  See the getting-started-proxmox.md guide for distro-specific commands."
    exit 1
fi

success "All required tools found."

# Check optional tools
for tool in flux cosign trivy; do
    if ! command -v "$tool" &>/dev/null; then
        warn "Optional tool '$tool' not found — some features may not be available."
    fi
done

# ============================================================================
# Phase 1: Gather Configuration
# ============================================================================

header "Phase 1: Proxmox Configuration"

echo "Enter your Proxmox VE connection details."
echo "If you haven't created an API token yet, see:"
echo "  docs/getting-started-proxmox.md#12-create-a-packer-api-user"
echo

prompt       PROXMOX_URL     "Proxmox API URL (e.g., https://192.168.1.100:8006)"
prompt       PROXMOX_NODE    "Proxmox node name" "pve"
prompt       PROXMOX_USER    "API user (e.g., packer@pve!packer-token)" "packer@pve!packer-token"
prompt_secret PROXMOX_TOKEN  "API token secret"
prompt       PROXMOX_ISO     "Rocky Linux 9 ISO path on Proxmox storage" "local:iso/Rocky-9.5-x86_64-minimal.iso"
prompt       PROXMOX_STORAGE "Storage pool for VM disks" "local-lvm"
prompt       PROXMOX_BRIDGE  "Network bridge" "vmbr0"

echo
log "Cluster sizing (adjust for your hardware):"
prompt       SERVER_COUNT    "Control plane nodes (1 for lab, 3 for HA)" "1"
prompt       AGENT_COUNT     "Worker nodes" "2"

# ── SSH Key ─────────────────────────────────────────────────────────────────

echo
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/sre-proxmox-lab}"

if [[ ! -f "$SSH_KEY_PATH" ]]; then
    log "No SSH key found at $SSH_KEY_PATH"
    if prompt_yesno "Generate a new SSH key pair?"; then
        ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "sre-admin@proxmox-lab" -q
        success "SSH key generated: $SSH_KEY_PATH"
    else
        prompt SSH_KEY_PATH "Path to your existing SSH private key"
        if [[ ! -f "$SSH_KEY_PATH" ]]; then
            fatal "SSH key not found at $SSH_KEY_PATH"
        fi
    fi
else
    success "Using existing SSH key: $SSH_KEY_PATH"
fi

SSH_PUBLIC_KEY="$(cat "${SSH_KEY_PATH}.pub")"

# ── Summary ─────────────────────────────────────────────────────────────────

echo
header "Configuration Summary"
echo "  Proxmox URL:      $PROXMOX_URL"
echo "  Proxmox node:     $PROXMOX_NODE"
echo "  API user:         $PROXMOX_USER"
echo "  ISO:              $PROXMOX_ISO"
echo "  Storage pool:     $PROXMOX_STORAGE"
echo "  Network bridge:   $PROXMOX_BRIDGE"
echo "  Server nodes:     $SERVER_COUNT"
echo "  Worker nodes:     $AGENT_COUNT"
echo "  SSH key:          $SSH_KEY_PATH"
echo

if ! prompt_yesno "Proceed with deployment?"; then
    log "Aborted."
    exit 0
fi

# Normalize the Proxmox URL (strip trailing slash, ensure /api2/json for Packer)
PROXMOX_URL_BASE="${PROXMOX_URL%/}"
PROXMOX_URL_PACKER="${PROXMOX_URL_BASE}/api2/json"
# Tofu uses the base URL without /api2/json
PROXMOX_URL_TOFU="$PROXMOX_URL_BASE"

# ============================================================================
# Phase 2: Build VM Template with Packer
# ============================================================================

if [[ "${SKIP_PACKER:-0}" == "1" ]]; then
    warn "Skipping Packer build (SKIP_PACKER=1)"
else
    header "Phase 2: Building VM Template with Packer"
    log "This creates a hardened Rocky Linux 9 template with RKE2 pre-staged."
    log "This step takes 15-30 minutes."
    echo

    cd "$REPO_ROOT/infrastructure/packer/rocky-linux-9-proxmox"

    log "Initializing Packer plugins..."
    packer init . > /dev/null 2>&1
    success "Packer plugins initialized."

    log "Validating Packer template..."
    packer validate \
        -var "proxmox_url=$PROXMOX_URL_PACKER" \
        -var "proxmox_username=$PROXMOX_USER" \
        -var "proxmox_token=$PROXMOX_TOKEN" \
        -var "proxmox_node=$PROXMOX_NODE" \
        -var "iso_file=$PROXMOX_ISO" \
        -var "vm_storage_pool=$PROXMOX_STORAGE" \
        -var "vm_network_bridge=$PROXMOX_BRIDGE" \
        -var "proxmox_insecure_skip_tls_verify=true" \
        . > /dev/null 2>&1
    success "Packer template validated."

    log "Building VM template (this takes 15-30 minutes)..."
    echo
    packer build \
        -var "proxmox_url=$PROXMOX_URL_PACKER" \
        -var "proxmox_username=$PROXMOX_USER" \
        -var "proxmox_token=$PROXMOX_TOKEN" \
        -var "proxmox_node=$PROXMOX_NODE" \
        -var "iso_file=$PROXMOX_ISO" \
        -var "vm_storage_pool=$PROXMOX_STORAGE" \
        -var "vm_network_bridge=$PROXMOX_BRIDGE" \
        -var "proxmox_insecure_skip_tls_verify=true" \
        -var "image_version=1.0.0" \
        .

    success "VM template built successfully."
fi

cd "$REPO_ROOT"

# ============================================================================
# Phase 3: Provision VMs with OpenTofu
# ============================================================================

header "Phase 3: Provisioning VMs with OpenTofu"

TOFU_DIR="$REPO_ROOT/infrastructure/tofu/environments/proxmox-lab"
cd "$TOFU_DIR"

# Write tfvars file with the collected values
cat > terraform.tfvars <<TFVARS
# Generated by quickstart-proxmox.sh at $(date -u +"%Y-%m-%dT%H:%M:%SZ")
proxmox_endpoint = "${PROXMOX_URL_TOFU}"
proxmox_insecure = true
proxmox_node     = "${PROXMOX_NODE}"
storage_pool     = "${PROXMOX_STORAGE}"
template_name    = "sre-rocky9-rke2"

server_count  = ${SERVER_COUNT}
agent_count   = ${AGENT_COUNT}
server_cores  = 4
server_memory = 8192
agent_cores   = 4
agent_memory  = 8192

network_bridge = "${PROXMOX_BRIDGE}"
ip_config      = "dhcp"
TFVARS

log "Initializing OpenTofu..."
tofu init -input=false > /dev/null 2>&1
success "OpenTofu initialized."

log "Planning infrastructure..."
export TF_VAR_proxmox_api_token="${PROXMOX_USER}=${PROXMOX_TOKEN}"
export TF_VAR_ssh_public_key="$SSH_PUBLIC_KEY"

tofu plan -input=false -out=tfplan > /dev/null 2>&1
success "Plan complete."

log "Applying infrastructure (creating ${SERVER_COUNT} server + ${AGENT_COUNT} worker VMs)..."
echo
tofu apply -input=false tfplan
rm -f tfplan

# ── Extract outputs ─────────────────────────────────────────────────────────

log "Extracting VM IP addresses from OpenTofu output..."

SERVER_IPS_JSON=$(tofu output -json server_ips)
AGENT_IPS_JSON=$(tofu output -json agent_ips)
API_ENDPOINT=$(tofu output -raw api_server_endpoint 2>/dev/null || echo "")

# Parse IPs into arrays
readarray -t SERVER_IPS < <(echo "$SERVER_IPS_JSON" | jq -r '.[]')
readarray -t AGENT_IPS < <(echo "$AGENT_IPS_JSON" | jq -r '.[]')

FIRST_SERVER_IP="${SERVER_IPS[0]}"

success "Server IPs: ${SERVER_IPS[*]}"
success "Agent IPs:  ${AGENT_IPS[*]}"

cd "$REPO_ROOT"

# ============================================================================
# Phase 4: Wait for VMs and Generate Ansible Inventory
# ============================================================================

header "Phase 4: Generating Ansible Inventory"

INVENTORY_DIR="$REPO_ROOT/infrastructure/ansible/inventory/proxmox-lab"
INVENTORY_FILE="$INVENTORY_DIR/hosts.yml"

# Build the inventory YAML dynamically
{
    cat <<INVENTORY_HEADER
---
# Generated by quickstart-proxmox.sh at $(date -u +"%Y-%m-%dT%H:%M:%SZ")
all:
  children:
    control_plane:
      hosts:
INVENTORY_HEADER

    for i in "${!SERVER_IPS[@]}"; do
        echo "        cp-$((i+1)):"
        echo "          ansible_host: ${SERVER_IPS[$i]}"
    done

    cat <<INVENTORY_MID
    workers:
      hosts:
INVENTORY_MID

    for i in "${!AGENT_IPS[@]}"; do
        echo "        worker-$((i+1)):"
        echo "          ansible_host: ${AGENT_IPS[$i]}"
    done

    cat <<INVENTORY_FOOTER
  vars:
    ansible_user: sre-admin
    ansible_ssh_private_key_file: "${SSH_KEY_PATH}"
INVENTORY_FOOTER
} > "$INVENTORY_FILE"

success "Ansible inventory written to: $INVENTORY_FILE"

# ── Wait for SSH ────────────────────────────────────────────────────────────

log "Waiting for VMs to finish cloud-init and accept SSH connections..."
echo

ALL_IPS=("${SERVER_IPS[@]}" "${AGENT_IPS[@]}")
MAX_WAIT=300  # 5 minutes
WAIT_INTERVAL=10

for ip in "${ALL_IPS[@]}"; do
    elapsed=0
    while ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes \
            -i "$SSH_KEY_PATH" sre-admin@"$ip" "exit 0" 2>/dev/null; do
        if (( elapsed >= MAX_WAIT )); then
            fatal "Timed out waiting for SSH on $ip after ${MAX_WAIT}s"
        fi
        printf "  Waiting for %s... (%ds)\r" "$ip" "$elapsed"
        sleep "$WAIT_INTERVAL"
        elapsed=$((elapsed + WAIT_INTERVAL))
    done
    success "SSH ready: $ip"
done

echo
success "All VMs are reachable."

# ============================================================================
# Phase 5: Harden OS and Install RKE2 with Ansible
# ============================================================================

header "Phase 5: Hardening OS and Installing RKE2"
log "This applies DISA STIG hardening and bootstraps the Kubernetes cluster."
log "This step takes 10-20 minutes."
echo

cd "$REPO_ROOT/infrastructure/ansible"

# Generate a random RKE2 cluster token
RKE2_TOKEN=$(openssl rand -hex 32)

ansible-playbook playbooks/site.yml \
    -i inventory/proxmox-lab/hosts.yml \
    --extra-vars "rke2_token=$RKE2_TOKEN" \
    -e "ansible_ssh_common_args='-o StrictHostKeyChecking=no'"

success "RKE2 cluster deployed and hardened."

cd "$REPO_ROOT"

# ============================================================================
# Phase 6: Retrieve Kubeconfig
# ============================================================================

header "Phase 6: Retrieving Kubeconfig"

KUBECONFIG_DIR="$HOME/.kube"
KUBECONFIG_FILE="$KUBECONFIG_DIR/sre-proxmox-lab.yaml"
mkdir -p "$KUBECONFIG_DIR"

ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
    sre-admin@"$FIRST_SERVER_IP" \
    "sudo cat /etc/rancher/rke2/rke2.yaml" > "$KUBECONFIG_FILE"

# Replace localhost with the actual server IP
sed -i.bak "s/127\.0\.0\.1/$FIRST_SERVER_IP/g" "$KUBECONFIG_FILE"
rm -f "${KUBECONFIG_FILE}.bak"
chmod 600 "$KUBECONFIG_FILE"

export KUBECONFIG="$KUBECONFIG_FILE"

success "Kubeconfig saved to: $KUBECONFIG_FILE"

# ── Verify cluster ──────────────────────────────────────────────────────────

log "Verifying cluster..."
echo

EXPECTED_NODES=$((SERVER_COUNT + AGENT_COUNT))
READY_TIMEOUT=180
READY_ELAPSED=0

while true; do
    READY_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready" || true)
    if (( READY_COUNT >= EXPECTED_NODES )); then
        break
    fi
    if (( READY_ELAPSED >= READY_TIMEOUT )); then
        warn "Only $READY_COUNT/$EXPECTED_NODES nodes are Ready after ${READY_TIMEOUT}s."
        warn "Some nodes may still be initializing. Continuing anyway."
        break
    fi
    printf "  Waiting for nodes... (%d/%d Ready, %ds)\r" "$READY_COUNT" "$EXPECTED_NODES" "$READY_ELAPSED"
    sleep 10
    READY_ELAPSED=$((READY_ELAPSED + 10))
done

echo
kubectl get nodes
echo
success "Kubernetes cluster is running."

# ============================================================================
# Phase 7: Bootstrap Flux CD (Optional)
# ============================================================================

if [[ "${SKIP_FLUX:-0}" == "1" ]]; then
    warn "Skipping Flux bootstrap (SKIP_FLUX=1)"
else
    echo
    if command -v flux &>/dev/null; then
        if prompt_yesno "Bootstrap Flux CD for GitOps? (requires GitHub PAT with 'repo' scope)" "y"; then
            header "Phase 7: Bootstrapping Flux CD"

            prompt       GITHUB_OWNER "GitHub username or org" "morbidsteve"
            prompt       GITHUB_REPO  "GitHub repository name" "sre-platform"
            prompt_secret GITHUB_TOKEN "GitHub personal access token (repo scope)"

            export GITHUB_TOKEN

            log "Running Flux pre-flight checks..."
            flux check --pre 2>&1 || warn "Some pre-flight checks failed. Attempting bootstrap anyway."

            log "Bootstrapping Flux CD..."
            echo
            flux bootstrap github \
                --owner="$GITHUB_OWNER" \
                --repository="$GITHUB_REPO" \
                --path=platform/flux-system \
                --branch=main \
                --personal

            success "Flux CD bootstrapped."
            log "Platform services will begin deploying via GitOps."
            log "Monitor progress with: flux get kustomizations -A --watch"
        fi
    else
        warn "Flux CLI not installed — skipping Flux bootstrap."
        warn "Install it and run manually: flux bootstrap github --owner=morbidsteve --repository=sre-platform --path=platform/flux-system --branch=main --personal"
    fi
fi

# ============================================================================
# Done
# ============================================================================

header "Deployment Complete"

echo -e "  ${BOLD}Cluster:${NC}        $EXPECTED_NODES nodes ($SERVER_COUNT server + $AGENT_COUNT worker)"
echo -e "  ${BOLD}API Server:${NC}     https://$FIRST_SERVER_IP:6443"
echo -e "  ${BOLD}Kubeconfig:${NC}     $KUBECONFIG_FILE"
echo -e "  ${BOLD}SSH Key:${NC}        $SSH_KEY_PATH"
echo -e "  ${BOLD}Ansible Inv:${NC}    $INVENTORY_FILE"
echo

echo "To use kubectl:"
echo "  export KUBECONFIG=$KUBECONFIG_FILE"
echo "  kubectl get nodes"
echo

if [[ "${SKIP_FLUX:-0}" != "1" ]] && command -v flux &>/dev/null; then
    echo "To monitor Flux deployments:"
    echo "  export KUBECONFIG=$KUBECONFIG_FILE"
    echo "  flux get kustomizations -A --watch"
    echo
fi

echo "To access Grafana (after Flux deploys monitoring):"
echo "  kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80"
echo "  open http://localhost:3000"
echo

echo "Next steps:"
echo "  1. Read the Operator Guide:    docs/operator-guide.md"
echo "  2. Onboard a team:             docs/onboarding-guide.md"
echo "  3. Deploy an app:              docs/getting-started-developer.md"
echo

success "SRE platform is ready."
