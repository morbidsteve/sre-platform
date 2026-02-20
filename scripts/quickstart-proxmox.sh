#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Proxmox VE Quickstart
# ============================================================================
# Deploys the full Secure Runtime Environment to a Proxmox VE host in one run.
#
# What this script does:
#   1. Checks that all required CLI tools are installed
#   2. Connects to Proxmox and auto-discovers the environment
#   3. Creates a dedicated API user and token (if not provided)
#   4. Downloads the Rocky Linux 9 ISO to Proxmox storage (if not present)
#   5. Generates an SSH key pair (if needed)
#   6. Builds a hardened Rocky Linux 9 VM template with Packer
#   7. Provisions control plane + worker VMs with OpenTofu
#   8. Generates an Ansible inventory from the OpenTofu output
#   9. Hardens the OS and installs RKE2 with Ansible
#  10. Retrieves the kubeconfig
#  11. (Optionally) bootstraps Flux CD for GitOps
#
# Usage:
#   ./scripts/quickstart-proxmox.sh
#
# Zero-touch mode (recommended):
#   Provide only a Proxmox host IP and root password. The script will
#   auto-discover the node, storage, and network, create an API user/token,
#   and download the Rocky Linux 9 ISO — fully automated.
#
# Advanced mode:
#   If PROXMOX_USER and PROXMOX_TOKEN are already set, the script skips
#   bootstrap and uses the provided credentials (backward compatible).
#
# Requirements:
#   - Proxmox VE 7.2+ with API access (8.x recommended)
#   - root@pam password OR a pre-existing API token
#
# Environment variable overrides (skip prompts):
#   PROXMOX_HOST         — Proxmox IP or hostname (zero-touch mode)
#   PROXMOX_ROOT_PASS    — root@pam password (zero-touch mode, used once)
#   PROXMOX_URL          — https://pve.example.com:8006 (advanced mode)
#   PROXMOX_NODE         — Proxmox node name (e.g., pve)
#   PROXMOX_USER         — API user (e.g., packer@pve!packer-token)
#   PROXMOX_TOKEN        — API token secret
#   PROXMOX_ISO          — ISO path (e.g., local:iso/Rocky-9-latest-x86_64-minimal.iso)
#   PROXMOX_STORAGE      — Storage pool (e.g., local-lvm)
#   PROXMOX_BRIDGE       — Network bridge (e.g., vmbr0)
#   SSH_KEY_PATH         — Path to SSH private key
#   SERVER_COUNT         — Control plane nodes (default: 1)
#   AGENT_COUNT          — Worker nodes (default: 2)
#   ROCKY_ISO_URL        — Override Rocky Linux ISO download URL
#   ROCKY_ISO_FILENAME   — ISO filename on storage (default: Rocky-9-latest-x86_64-minimal.iso)
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
for tool in packer tofu ansible-playbook kubectl helm jq ssh-keygen curl; do
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
    echo "  brew tap hashicorp/tap"
    echo "  brew install hashicorp/tap/packer opentofu ansible kubectl helm jq"
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

# ── Proxmox API Helpers (Phase 1b) ────────────────────────────────────────
# These functions use the Proxmox REST API for zero-touch bootstrap.
# They are only called when PROXMOX_USER + PROXMOX_TOKEN are NOT provided.

ROCKY_ISO_URL="${ROCKY_ISO_URL:-https://download.rockylinux.org/pub/rocky/9/isos/x86_64/Rocky-9-latest-x86_64-minimal.iso}"
ROCKY_ISO_FILENAME="${ROCKY_ISO_FILENAME:-Rocky-9-latest-x86_64-minimal.iso}"

# Authenticate to Proxmox as root@pam, sets PVE_TICKET and PVE_CSRF
pve_authenticate() {
    local host="$1" password="$2"
    local url="https://${host}:8006/api2/json/access/ticket"
    local response

    response=$(curl -fsSk --connect-timeout 10 \
        --data-urlencode "username=root@pam" \
        --data-urlencode "password=${password}" \
        "$url" 2>&1) || {
        error "Failed to authenticate to Proxmox at ${host}."
        error "Check the host IP and root password."
        error "curl output: $response"
        return 1
    }

    PVE_TICKET=$(echo "$response" | jq -r '.data.ticket // empty')
    PVE_CSRF=$(echo "$response" | jq -r '.data.CSRFPreventionToken // empty')

    if [[ -z "$PVE_TICKET" || -z "$PVE_CSRF" ]]; then
        error "Authentication succeeded but no ticket received."
        error "Response: $response"
        return 1
    fi
}

# Generic Proxmox API call with ticket auth
# Usage: pve_api GET /nodes
#        pve_api GET /nodes/pve/storage/local/content --data-urlencode "content=iso"
#        pve_api POST /access/users --data-urlencode "userid=packer@pve"
pve_api() {
    local method="$1" path="$2"
    shift 2
    local url="https://${PROXMOX_HOST}:8006/api2/json${path}"

    # For GET requests, -G tells curl to append --data-urlencode params as
    # query string instead of sending them as a POST body (which causes 501).
    local -a method_args=(-X "$method")
    if [[ "$method" == "GET" ]]; then
        method_args+=(-G)
    fi

    curl -fsSk \
        "${method_args[@]}" \
        -b "PVEAuthCookie=${PVE_TICKET}" \
        -H "CSRFPreventionToken: ${PVE_CSRF}" \
        "$@" \
        "$url"
}

# Discover the first node name
pve_discover_node() {
    local nodes_json
    nodes_json=$(pve_api GET /nodes) || fatal "Failed to query Proxmox nodes."
    PROXMOX_NODE=$(echo "$nodes_json" | jq -r '.data[0].node // empty')
    if [[ -z "$PROXMOX_NODE" ]]; then
        fatal "No nodes found on this Proxmox host."
    fi
    success "Discovered node: $PROXMOX_NODE"
}

# Discover storage pools — finds one for ISOs and one for VM disks
pve_discover_storage() {
    local storage_json
    storage_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/storage") || fatal "Failed to query storage."

    # Find a storage that supports ISO content
    PVE_ISO_STORAGE=$(echo "$storage_json" | jq -r '
        [.data[] | select(.content // "" | test("iso")) | select(.active == 1)] | .[0].storage // empty
    ')
    if [[ -z "$PVE_ISO_STORAGE" ]]; then
        fatal "No ISO-capable storage found. Ensure a storage pool has 'iso' content type enabled."
    fi
    success "Discovered ISO storage: $PVE_ISO_STORAGE"

    # If PROXMOX_STORAGE is not set, find an images-capable storage for VM disks
    if [[ -z "${PROXMOX_STORAGE:-}" ]]; then
        PROXMOX_STORAGE=$(echo "$storage_json" | jq -r '
            [.data[] | select(.content // "" | test("images")) | select(.active == 1)] | .[0].storage // empty
        ')
        if [[ -z "$PROXMOX_STORAGE" ]]; then
            fatal "No images-capable storage found for VM disks."
        fi
        success "Discovered VM storage: $PROXMOX_STORAGE"
    else
        log "Using VM storage from environment: $PROXMOX_STORAGE"
    fi
}

# Discover the first active network bridge
pve_discover_bridge() {
    if [[ -n "${PROXMOX_BRIDGE:-}" ]]; then
        log "Using network bridge from environment: $PROXMOX_BRIDGE"
        return
    fi

    local net_json
    net_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/network") || fatal "Failed to query network."

    PROXMOX_BRIDGE=$(echo "$net_json" | jq -r '
        [.data[] | select(.type == "bridge") | select(.active == 1 or .active == null)] | .[0].iface // empty
    ')
    if [[ -z "$PROXMOX_BRIDGE" ]]; then
        fatal "No active network bridge found."
    fi
    success "Discovered bridge: $PROXMOX_BRIDGE"
}


# Create the packer@pve API user and token
pve_create_api_user() {
    local userid="packer@pve"
    local tokenid="packer-token"

    # Check if user already exists
    local user_exists
    user_exists=$(pve_api GET /access/users | jq -r ".data[] | select(.userid == \"${userid}\") | .userid // empty")

    if [[ -z "$user_exists" ]]; then
        log "Creating API user: $userid"
        pve_api POST /access/users \
            --data-urlencode "userid=${userid}" \
            --data-urlencode "comment=SRE Packer image builder (auto-created)" \
            > /dev/null || fatal "Failed to create API user ${userid}."
        success "Created user: $userid"
    else
        log "API user $userid already exists."
    fi

    # Always ensure correct permissions (covers first run and permission updates)
    log "Ensuring API user permissions..."
    pve_api PUT "/access/acl" \
        --data-urlencode "path=/" \
        --data-urlencode "users=${userid}" \
        --data-urlencode "roles=PVEVMAdmin,PVEDatastoreUser" \
        > /dev/null || fatal "Failed to set ACL for ${userid}."

    # SDN.Use is required on Proxmox 8.x for SDN-managed network bridges
    if pve_api PUT "/access/acl" \
        --data-urlencode "path=/sdn" \
        --data-urlencode "users=${userid}" \
        --data-urlencode "roles=PVESDNUser" \
        > /dev/null 2>&1; then
        success "Granted PVEVMAdmin + PVEDatastoreUser + PVESDNUser roles."
    else
        # PVESDNUser role may not exist on older Proxmox versions — not fatal
        success "Granted PVEVMAdmin + PVEDatastoreUser roles."
        warn "Could not grant PVESDNUser (may not be needed if SDN is not enabled)."
    fi

    # Delete existing token (secret cannot be retrieved), then recreate
    log "Creating API token: ${userid}!${tokenid}"
    # Attempt to delete — ignore errors if it does not exist
    pve_api DELETE "/access/users/${userid}/token/${tokenid}" > /dev/null 2>&1 || true

    local token_response
    token_response=$(pve_api POST "/access/users/${userid}/token/${tokenid}" \
        --data-urlencode "privsep=0" \
        --data-urlencode "comment=SRE quickstart token (auto-created)") \
        || fatal "Failed to create API token."

    PROXMOX_TOKEN=$(echo "$token_response" | jq -r '.data.value // empty')
    if [[ -z "$PROXMOX_TOKEN" ]]; then
        fatal "Token created but no secret returned. Response: $token_response"
    fi

    PROXMOX_USER="${userid}!${tokenid}"
    success "API token created: $PROXMOX_USER"
}

# Wait for a Proxmox task (UPID) to complete. Returns 0 on success, 1 on failure.
# Sets PVE_TASK_EXIT to the exit status string on failure.
pve_wait_task() {
    local upid="$1" label="$2" timeout="${3:-600}"
    local encoded_upid
    encoded_upid=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${upid}', safe=''))" 2>/dev/null \
        || echo "$upid" | sed 's/:/%3A/g; s/\//%2F/g')
    local status="" elapsed=0

    while [[ "$status" != "stopped" ]]; do
        if (( elapsed >= timeout )); then
            PVE_TASK_EXIT="timed out after ${timeout}s"
            return 1
        fi
        sleep 5
        elapsed=$((elapsed + 5))
        printf "\r  %s (%ds elapsed)" "$label" "$elapsed"

        local task_status
        task_status=$(pve_api GET "/nodes/${PROXMOX_NODE}/tasks/${encoded_upid}/status" 2>/dev/null) || continue
        status=$(echo "$task_status" | jq -r '.data.status // empty')

        local exitstatus
        exitstatus=$(echo "$task_status" | jq -r '.data.exitstatus // empty')
        if [[ "$status" == "stopped" && "$exitstatus" != "OK" ]]; then
            echo
            PVE_TASK_EXIT="$exitstatus"
            return 1
        fi
    done
    echo
    return 0
}

# Upload an ISO from the local workstation to Proxmox via the API
pve_upload_iso() {
    local storage="$1" filepath="$2" filename="$3"
    local url="https://${PROXMOX_HOST}:8006/api2/json/nodes/${PROXMOX_NODE}/storage/${storage}/upload"
    local filesize
    filesize=$(du -h "$filepath" | cut -f1)

    log "Uploading ISO to Proxmox storage ($filesize)..."
    curl -fSk --progress-bar \
        -b "PVEAuthCookie=${PVE_TICKET}" \
        -H "CSRFPreventionToken: ${PVE_CSRF}" \
        -F "content=iso" \
        -F "filename=@${filepath};filename=${filename}" \
        "$url" > /dev/null || return 1
}

# Ensure the Rocky Linux 9 ISO exists on Proxmox storage
pve_ensure_iso() {
    local storage="$PVE_ISO_STORAGE"

    # Check if ISO already exists — first by exact filename match, then by
    # any Rocky-9 minimal ISO on the storage (covers renamed or versioned files)
    local content_json
    content_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/storage/${storage}/content" \
        --data-urlencode "content=iso") || fatal "Failed to query storage content."

    # Exact match on the expected filename
    local iso_volid="${storage}:iso/${ROCKY_ISO_FILENAME}"
    local existing
    existing=$(echo "$content_json" | jq -r ".data[] | select(.volid == \"${iso_volid}\") | .volid // empty")

    if [[ -n "$existing" ]]; then
        success "ISO already exists: $iso_volid"
        PROXMOX_ISO="$iso_volid"
        return
    fi

    # Fuzzy match: any Rocky-9 minimal ISO (e.g., Rocky-9.7, Rocky-9-latest, Rocky-9.5)
    local fuzzy_match
    fuzzy_match=$(echo "$content_json" | jq -r '
        [.data[] | select(.volid | test("Rocky-9.*minimal\\.iso$"))] | .[0].volid // empty
    ')

    if [[ -n "$fuzzy_match" ]]; then
        success "Found existing Rocky 9 ISO: $fuzzy_match"
        PROXMOX_ISO="$fuzzy_match"
        return
    fi

    log "Downloading Rocky Linux 9 ISO to Proxmox storage..."
    log "URL: $ROCKY_ISO_URL"
    log "This may take a few minutes depending on your connection."

    # Strategy 1: Use the download-url API (Proxmox downloads directly — fastest)
    local pve_download_ok=false
    local download_response
    download_response=$(pve_api POST "/nodes/${PROXMOX_NODE}/storage/${storage}/download-url" \
        --data-urlencode "url=${ROCKY_ISO_URL}" \
        --data-urlencode "content=iso" \
        --data-urlencode "filename=${ROCKY_ISO_FILENAME}" \
        --data-urlencode "verify-certificates=0" 2>&1) && {

        local upid
        upid=$(echo "$download_response" | jq -r '.data // empty')
        if [[ -n "$upid" ]]; then
            if pve_wait_task "$upid" "Downloading ISO on Proxmox..." 600; then
                pve_download_ok=true
            else
                warn "Proxmox-side download failed: $PVE_TASK_EXIT"
            fi
        fi
    }

    # Strategy 2: Download locally and upload via API
    if [[ "$pve_download_ok" != "true" ]]; then
        warn "Falling back to local download + upload to Proxmox..."

        # Use a stable cache path so re-runs don't re-download a 2.5 GB file
        local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/sre-platform"
        mkdir -p "$cache_dir"
        local cached_iso="${cache_dir}/${ROCKY_ISO_FILENAME}"

        if [[ -f "$cached_iso" ]]; then
            local cached_size
            cached_size=$(wc -c < "$cached_iso")
            # Sanity check: ISO should be at least 1 GB (avoids using truncated files)
            if (( cached_size > 1073741824 )); then
                success "Using cached ISO: $cached_iso ($(du -h "$cached_iso" | cut -f1))"
            else
                warn "Cached ISO looks truncated ($(du -h "$cached_iso" | cut -f1)), re-downloading..."
                rm -f "$cached_iso"
            fi
        fi

        if [[ ! -f "$cached_iso" ]]; then
            log "Downloading ISO to local cache (curl -4 -L)..."
            if ! curl -4 -fSL --progress-bar -o "$cached_iso" "$ROCKY_ISO_URL"; then
                rm -f "$cached_iso"
                fatal "Failed to download ISO locally. Check your internet connection and URL: $ROCKY_ISO_URL"
            fi
            success "ISO downloaded to cache ($(du -h "$cached_iso" | cut -f1))."
        fi

        if ! pve_upload_iso "$storage" "$cached_iso" "$ROCKY_ISO_FILENAME"; then
            fatal "Failed to upload ISO to Proxmox."
        fi
    fi

    PROXMOX_ISO="$iso_volid"
    success "ISO available: $PROXMOX_ISO"
}

# ============================================================================
# Phase 1: Gather Configuration
# ============================================================================

header "Phase 1: Proxmox Configuration"

# Detect mode: if PROXMOX_USER + PROXMOX_TOKEN are set, use advanced mode
if [[ -n "${PROXMOX_USER:-}" && -n "${PROXMOX_TOKEN:-}" ]]; then
    # ── Advanced Mode ─────────────────────────────────────────────────────
    log "Advanced mode: using provided API credentials."
    echo

    prompt       PROXMOX_URL     "Proxmox API URL (e.g., https://192.168.1.100:8006)"
    prompt       PROXMOX_NODE    "Proxmox node name" "pve"
    log "Using PROXMOX_USER from environment: $PROXMOX_USER"
    log "Using PROXMOX_TOKEN from environment: [hidden]"
    prompt       PROXMOX_ISO     "Rocky Linux 9 ISO path on Proxmox storage" "local:iso/${ROCKY_ISO_FILENAME}"
    prompt       PROXMOX_STORAGE "Storage pool for VM disks" "local-lvm"
    prompt       PROXMOX_BRIDGE  "Network bridge" "vmbr0"
else
    # ── Zero-Touch Mode ───────────────────────────────────────────────────
    echo "Zero-touch mode: the script will auto-discover your Proxmox environment,"
    echo "create an API user, and download the Rocky Linux 9 ISO."
    echo
    echo "You only need the Proxmox host IP and root password."
    echo

    prompt        PROXMOX_HOST      "Proxmox host IP or hostname"
    prompt_secret PROXMOX_ROOT_PASS "root@pam password (used once, then discarded)"

    # ── Phase 1b: Proxmox API Bootstrap ───────────────────────────────────

    header "Phase 1b: Proxmox API Bootstrap"

    log "Authenticating to Proxmox at $PROXMOX_HOST..."
    pve_authenticate "$PROXMOX_HOST" "$PROXMOX_ROOT_PASS" || exit 1
    success "Authenticated to Proxmox."

    # Discard root password from memory immediately
    unset PROXMOX_ROOT_PASS

    log "Auto-discovering environment..."
    pve_discover_node
    pve_discover_storage
    pve_discover_bridge

    echo
    log "Creating API credentials..."
    pve_create_api_user

    echo
    log "Ensuring Rocky Linux 9 ISO is available..."
    pve_ensure_iso

    # Clean up PVE session credentials
    unset PVE_TICKET PVE_CSRF

    # Set the URL from the host
    PROXMOX_URL="https://${PROXMOX_HOST}:8006"

    echo
    success "Bootstrap complete. Proxmox environment is ready."
fi

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

    # Build the common Packer var args
    PACKER_VARS=(
        -var "proxmox_url=$PROXMOX_URL_PACKER"
        -var "proxmox_username=$PROXMOX_USER"
        -var "proxmox_token=$PROXMOX_TOKEN"
        -var "proxmox_node=$PROXMOX_NODE"
        -var "iso_file=$PROXMOX_ISO"
        -var "vm_storage_pool=$PROXMOX_STORAGE"
        -var "vm_network_bridge=$PROXMOX_BRIDGE"
        -var "proxmox_insecure_skip_tls_verify=true"
    )

    log "Validating Packer template..."
    validate_output=""
    if ! validate_output=$(packer validate "${PACKER_VARS[@]}" . 2>&1); then
        error "Packer validation failed:"
        echo "$validate_output"
        fatal "Fix the errors above and re-run."
    fi
    success "Packer template validated."

    log "Building VM template (this takes 15-30 minutes)..."
    echo

    # Try with KVM first. If it fails with a KVM error, retry with QEMU emulation.
    set +e
    packer_output=$(packer build "${PACKER_VARS[@]}" -var "image_version=1.0.0" . 2>&1)
    packer_exit=$?
    set -e

    if [[ $packer_exit -ne 0 ]]; then
        if echo "$packer_output" | grep -qi "KVM.*not available\|kvm virtualisation"; then
            echo "$packer_output" | tail -5
            echo
            warn "KVM hardware virtualisation is not available on this host."
            log "Retrying with QEMU emulation (build will be slower)..."
            echo
            packer build "${PACKER_VARS[@]}" -var "image_version=1.0.0" -var "vm_disable_kvm=true" .
        else
            # Not a KVM error — show output and fail
            echo "$packer_output"
            fatal "Packer build failed. See errors above."
        fi
    else
        echo "$packer_output"
    fi

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
