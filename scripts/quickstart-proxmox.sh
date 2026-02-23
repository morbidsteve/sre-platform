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
#   4. Downloads the Rocky Linux 9 cloud image to Proxmox storage
#   5. Generates an SSH key pair (if needed)
#   6. Builds a Rocky Linux 9 VM template (cloud image import + provisioning)
#   7. Provisions control plane + worker VMs with OpenTofu
#   8. Generates an Ansible inventory from the OpenTofu output
#   9. Hardens the OS and installs RKE2 with Ansible
#  10. Retrieves the kubeconfig
#  11. (Optionally) bootstraps Flux CD for GitOps
#
# The quickstart uses a cloud image import workflow (no Packer, no ISO boot)
# for speed and compatibility with nested virtualisation. For production
# environments or full STIG-hardened images, use the Packer-based workflow:
#   cd infrastructure/packer/rocky-linux-9-proxmox && packer build .
#
# Usage:
#   ./scripts/quickstart-proxmox.sh
#
# Zero-touch mode (recommended):
#   Provide only a Proxmox host IP and root password. The script will
#   auto-discover the node, storage, and network, create an API user/token,
#   and download the Rocky Linux 9 cloud image — fully automated.
#
# Advanced mode:
#   If PROXMOX_USER and PROXMOX_TOKEN are already set, the script skips
#   bootstrap and uses the provided credentials (backward compatible).
#
# Requirements:
#   - Proxmox VE 8.0+ with API access (8.2+ recommended for import-from)
#   - root@pam password OR a pre-existing API token
#
# Environment variable overrides (skip prompts):
#   PROXMOX_HOST         — Proxmox IP or hostname (zero-touch mode)
#   PROXMOX_AUTH_USER    — Authentication username (default: root@pam; e.g., user@pve)
#   PROXMOX_AUTH_PASS    — Authentication password (zero-touch mode, used once)
#   PROXMOX_ROOT_PASS    — Alias for PROXMOX_AUTH_PASS (backward compatible)
#   PROXMOX_URL          — https://pve.example.com:8006 (advanced mode)
#   PROXMOX_NODE         — Proxmox node name (e.g., pve)
#   PROXMOX_USER         — API user (e.g., packer@pve!packer-token)
#   PROXMOX_TOKEN        — API token secret
#   PROXMOX_STORAGE      — Storage pool (e.g., local-lvm)
#   PROXMOX_BRIDGE       — Network bridge (e.g., vmbr0)
#   SSH_KEY_PATH         — Path to SSH private key
#   SERVER_COUNT         — Control plane nodes (default: 1)
#   AGENT_COUNT          — Worker nodes (default: 2)
#   ROCKY_CLOUD_URL      — Override Rocky Linux GenericCloud qcow2 download URL
#   ROCKY_CLOUD_FNAME    — Cloud image filename on storage
#   TEMPLATE_VMID        — VM ID for the template (default: 9000)
#   TEMPLATE_BUILD_IP    — Static IP for template VM during build (auto-detected from bridge)
#   SKIP_TEMPLATE        — Set to 1 to skip template build (template already exists)
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
for tool in tofu ansible-playbook kubectl helm jq ssh-keygen curl; do
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
    echo "Quick install:"
    echo "  macOS:         brew install opentofu ansible kubectl helm jq"
    echo "  Linux (deb):   See docs/getting-started-proxmox.md for distro-specific commands"
    echo "  Windows:       Use WSL2 with Ubuntu, then follow the Linux instructions"
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

ROCKY_CLOUD_URL="${ROCKY_CLOUD_URL:-https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2}"
ROCKY_CLOUD_FNAME="${ROCKY_CLOUD_FNAME:-Rocky-9-GenericCloud.latest.x86_64.qcow2}"
TEMPLATE_VMID="${TEMPLATE_VMID:-9000}"
RKE2_VERSION="${RKE2_VERSION:-v1.28.6+rke2r1}"
RKE2_CHANNEL="${RKE2_CHANNEL:-stable}"
# Static IP assigned to the template VM during build (auto-detected from bridge subnet)
# Override this if auto-detection picks the wrong IP or you want a specific address.
TEMPLATE_BUILD_IP="${TEMPLATE_BUILD_IP:-}"

# Authenticate to Proxmox, sets PVE_TICKET and PVE_CSRF
# Uses PROXMOX_AUTH_USER (default: root@pam) for the authentication realm.
pve_authenticate() {
    local host="$1" password="$2"
    local auth_user="${PROXMOX_AUTH_USER:-root@pam}"
    local url="https://${host}:8006/api2/json/access/ticket"
    local response

    log "Authenticating as ${auth_user}..."
    response=$(curl -fsSk --connect-timeout 10 \
        --data-urlencode "username=${auth_user}" \
        --data-urlencode "password=${password}" \
        "$url" 2>&1) || {
        error "Failed to authenticate to Proxmox at ${host}."
        error "Check the host IP, username (${auth_user}), and password."
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

# Discover the bridge's subnet and compute a static IP for the template build.
# The template VM needs a known IP for SSH provisioning (guest agent is not
# available on GenericCloud images until we enable it during provisioning).
# Sets: PVE_BRIDGE_IP, PVE_BRIDGE_MASK, PVE_BRIDGE_GW, TEMPLATE_BUILD_IP
pve_discover_bridge_subnet() {
    local net_json
    net_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/network") || return 1

    local bridge_info
    bridge_info=$(echo "$net_json" | jq -r \
        ".data[] | select(.iface == \"${PROXMOX_BRIDGE}\") | \"\(.address // \"\") \(.netmask // \"24\") \(.gateway // \"\")\"")

    PVE_BRIDGE_IP=$(echo "$bridge_info" | awk '{print $1}')
    PVE_BRIDGE_MASK=$(echo "$bridge_info" | awk '{print $2}')
    PVE_BRIDGE_GW=$(echo "$bridge_info" | awk '{print $3}')

    if [[ -z "$PVE_BRIDGE_IP" ]]; then
        warn "Could not detect bridge subnet. Template VM will use DHCP."
        return 1
    fi

    # If TEMPLATE_BUILD_IP is not set, derive it from the bridge subnet (.200)
    if [[ -z "${TEMPLATE_BUILD_IP:-}" ]]; then
        TEMPLATE_BUILD_IP=$(echo "$PVE_BRIDGE_IP" | sed 's/\.[0-9]*$/.200/')
    fi

    success "Bridge subnet: ${PVE_BRIDGE_IP}/${PVE_BRIDGE_MASK} (gw ${PVE_BRIDGE_GW})"
    log "Template build IP: ${TEMPLATE_BUILD_IP}"
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
# NOTE: This function is NOT used by the quickstart cloud image workflow.
# It is retained for backward compatibility with manual/Packer-based builds.
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

# ── Cloud Image Helpers (Phase 2 — quickstart template build) ──────────────
# These functions build a VM template from a Rocky Linux GenericCloud qcow2
# image via the Proxmox REST API. No Packer, no ISO boot, no KVM required.
# For production STIG-hardened templates, use the Packer workflow instead.

# Upload a disk image to Proxmox using content=import (Proxmox 8.1+)
# This accepts .qcow2, .raw, .vmdk — unlike content=iso which only takes .iso/.img
pve_upload_import() {
    local storage="$1" filepath="$2" filename="$3"
    local url="https://${PROXMOX_HOST}:8006/api2/json/nodes/${PROXMOX_NODE}/storage/${storage}/upload"
    local filesize
    filesize=$(du -h "$filepath" | cut -f1)

    log "Uploading disk image to Proxmox storage ($filesize)..."
    local response
    response=$(curl -fSk --progress-bar \
        -b "PVEAuthCookie=${PVE_TICKET}" \
        -H "CSRFPreventionToken: ${PVE_CSRF}" \
        -F "content=import" \
        -F "filename=@${filepath};filename=${filename}" \
        "$url" 2>&1) || return 1

    # The upload may return a UPID for the import task
    local upid
    upid=$(echo "$response" | jq -r '.data // empty' 2>/dev/null || true)
    if [[ -n "$upid" && "$upid" != "null" ]]; then
        pve_wait_task "$upid" "Processing uploaded image..." 300 || true
    fi
}

# Download Rocky 9 GenericCloud qcow2 to Proxmox storage.
# Sets PVE_CLOUD_IMAGE_PATH to the filesystem path on Proxmox for import-from.
pve_ensure_cloud_image() {
    # The .img filename variant — Proxmox upload API accepts .img with content=iso
    local img_fname="${ROCKY_CLOUD_FNAME%.qcow2}.img"

    # Check if cloud image already exists on storage
    # Check import content (from content=import upload/download)
    local existing=""
    local import_content_json
    import_content_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/storage/${PVE_ISO_STORAGE}/content" \
        --data-urlencode "content=import" 2>/dev/null) || true

    if [[ -n "$import_content_json" ]]; then
        existing=$(echo "$import_content_json" | jq -r "
            [.data[] | select(.volid | test(\"${ROCKY_CLOUD_FNAME}\"))] | .[0].volid // empty
        " 2>/dev/null || true)
    fi

    if [[ -n "$existing" ]]; then
        success "Cloud image already exists: $existing"
        PVE_CLOUD_IMAGE_PATH="$(pve_get_storage_path "$PVE_ISO_STORAGE")/import/${ROCKY_CLOUD_FNAME}"
        return
    fi

    # Also check ISO storage (from .img fallback upload)
    local iso_content_json
    iso_content_json=$(pve_api GET "/nodes/${PROXMOX_NODE}/storage/${PVE_ISO_STORAGE}/content" \
        --data-urlencode "content=iso" 2>/dev/null) || true

    if [[ -n "$iso_content_json" ]]; then
        existing=$(echo "$iso_content_json" | jq -r "
            [.data[] | select(.volid | test(\"${img_fname}\"))] | .[0].volid // empty
        " 2>/dev/null || true)
    fi

    if [[ -n "$existing" ]]; then
        success "Cloud image already exists: $existing"
        local actual_fname="${existing#*:iso/}"
        PVE_CLOUD_IMAGE_PATH="$(pve_get_storage_path "$PVE_ISO_STORAGE")/template/iso/${actual_fname}"
        return
    fi

    log "Downloading Rocky Linux 9 GenericCloud image to Proxmox storage..."
    log "URL: $ROCKY_CLOUD_URL"
    log "This is ~900 MB and takes a few minutes depending on your connection."

    # Strategy 1: Use the download-url API (Proxmox downloads directly — fastest)
    # Use content=import which accepts .qcow2 files (requires storage with import support)
    local pve_download_ok=false
    local download_response
    download_response=$(pve_api POST "/nodes/${PROXMOX_NODE}/storage/${PVE_ISO_STORAGE}/download-url" \
        --data-urlencode "url=${ROCKY_CLOUD_URL}" \
        --data-urlencode "content=import" \
        --data-urlencode "filename=${ROCKY_CLOUD_FNAME}" \
        --data-urlencode "verify-certificates=0" 2>&1) && {

        local upid
        upid=$(echo "$download_response" | jq -r '.data // empty')
        if [[ -n "$upid" ]]; then
            if pve_wait_task "$upid" "Downloading cloud image on Proxmox..." 600; then
                pve_download_ok=true
                PVE_CLOUD_IMAGE_PATH="$(pve_get_storage_path "$PVE_ISO_STORAGE")/import/${ROCKY_CLOUD_FNAME}"
            else
                warn "Proxmox-side download failed: ${PVE_TASK_EXIT:-unknown}"
            fi
        fi
    }

    if [[ "$pve_download_ok" == "true" ]]; then
        success "Cloud image available on Proxmox."
        return
    fi

    # Strategy 2: Download locally, then upload to Proxmox
    warn "Proxmox could not download the image directly. Falling back to local download + upload..."

    local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/sre-platform"
    mkdir -p "$cache_dir"
    local cached_img="${cache_dir}/${ROCKY_CLOUD_FNAME}"

    if [[ -f "$cached_img" ]]; then
        local cached_size
        cached_size=$(wc -c < "$cached_img")
        # Cloud image should be at least 500 MB
        if (( cached_size > 536870912 )); then
            success "Using cached cloud image: $cached_img ($(du -h "$cached_img" | cut -f1))"
        else
            warn "Cached image looks truncated ($(du -h "$cached_img" | cut -f1)), re-downloading..."
            rm -f "$cached_img"
        fi
    fi

    if [[ ! -f "$cached_img" ]]; then
        log "Downloading cloud image to local cache..."
        if ! curl -4 -fSL --progress-bar -o "$cached_img" "$ROCKY_CLOUD_URL"; then
            rm -f "$cached_img"
            fatal "Failed to download cloud image. Check your internet connection and URL: $ROCKY_CLOUD_URL"
        fi
        success "Cloud image downloaded to cache ($(du -h "$cached_img" | cut -f1))."
    fi

    # Strategy 2a: Upload with content=import (Proxmox 8.1+, accepts .qcow2 natively)
    local upload_ok=false
    log "Attempting upload with content=import (Proxmox 8.1+)..."
    if pve_upload_import "$PVE_ISO_STORAGE" "$cached_img" "$ROCKY_CLOUD_FNAME" 2>/dev/null; then
        upload_ok=true
        PVE_CLOUD_IMAGE_PATH="$(pve_get_storage_path "$PVE_ISO_STORAGE")/import/${ROCKY_CLOUD_FNAME}"
    fi

    # Strategy 2b: Rename to .img and upload as content=iso
    # Proxmox upload API with content=iso accepts .iso and .img but not .qcow2
    if [[ "$upload_ok" != "true" ]]; then
        warn "content=import upload not supported. Trying .img rename workaround..."
        local cached_img_renamed="${cache_dir}/${img_fname}"

        # Create a copy/link with .img extension if not already there
        if [[ ! -f "$cached_img_renamed" ]]; then
            ln -f "$cached_img" "$cached_img_renamed" 2>/dev/null \
                || cp "$cached_img" "$cached_img_renamed"
        fi

        if pve_upload_iso "$PVE_ISO_STORAGE" "$cached_img_renamed" "$img_fname"; then
            upload_ok=true
            PVE_CLOUD_IMAGE_PATH="$(pve_get_storage_path "$PVE_ISO_STORAGE")/template/iso/${img_fname}"
        fi
    fi

    if [[ "$upload_ok" != "true" ]]; then
        error "Failed to upload cloud image to Proxmox."
        echo
        error "You can manually copy the image to your Proxmox host:"
        error "  scp ${cached_img} root@${PROXMOX_HOST}:/var/lib/vz/template/iso/${ROCKY_CLOUD_FNAME}"
        error "Then re-run this script."
        fatal "Cloud image upload failed."
    fi

    success "Cloud image uploaded to Proxmox."
}

# Get the filesystem path for a Proxmox storage pool
pve_get_storage_path() {
    local storage="$1"
    local storage_cfg
    storage_cfg=$(pve_api GET "/nodes/${PROXMOX_NODE}/storage/${storage}/status" 2>/dev/null) || true
    local spath
    spath=$(echo "$storage_cfg" | jq -r '.data.path // empty' 2>/dev/null || true)
    if [[ -z "$spath" ]]; then
        # Common default for 'local' storage
        echo "/var/lib/vz"
    else
        echo "$spath"
    fi
}

# Check if KVM hardware virtualisation is available on the Proxmox node
pve_kvm_available() {
    local cpu_info
    cpu_info=$(pve_api GET "/nodes/${PROXMOX_NODE}/status" 2>/dev/null) || true
    local kvm_avail
    # Check the KVM flag from /proc/cpuinfo via node capabilities
    kvm_avail=$(echo "$cpu_info" | jq -r '.data.kvm // empty' 2>/dev/null || true)
    # Alternatively, check cpuinfo for vmx/svm
    if [[ "$kvm_avail" == "true" || "$kvm_avail" == "1" ]]; then
        return 0
    fi
    # If we can't determine, try to start a test and see
    return 1
}

# Create a VM with the cloud image imported as its disk, configure cloud-init
pve_create_template_vm() {
    local vmid="$TEMPLATE_VMID"
    local template_name="sre-rocky9-rke2"

    # Check if the VMID already exists
    local existing_vm
    existing_vm=$(pve_api GET "/nodes/${PROXMOX_NODE}/qemu/${vmid}/status/current" 2>/dev/null) && {
        local existing_name
        existing_name=$(echo "$existing_vm" | jq -r '.data.name // empty')
        if [[ -n "$existing_name" ]]; then
            # Check if it is already a template
            local is_template
            is_template=$(echo "$existing_vm" | jq -r '.data.template // 0')
            if [[ "$is_template" == "1" ]]; then
                success "Template VM $vmid ($existing_name) already exists. Skipping build."
                PVE_TEMPLATE_EXISTS=true
                return
            fi
            warn "VM $vmid ($existing_name) exists but is not a template. Destroying and rebuilding..."
            pve_api POST "/nodes/${PROXMOX_NODE}/qemu/${vmid}/status/stop" > /dev/null 2>&1 || true
            sleep 5
            pve_api DELETE "/nodes/${PROXMOX_NODE}/qemu/${vmid}" > /dev/null 2>&1 || true
            sleep 3
        fi
    }

    PVE_TEMPLATE_EXISTS=false

    log "Creating VM $vmid with imported cloud image disk..."

    # PVE_CLOUD_IMAGE_PATH is set by pve_ensure_cloud_image() and points to
    # the actual filesystem path on Proxmox where the qcow2/img file lives.
    local import_path="${PVE_CLOUD_IMAGE_PATH}"
    if [[ -z "$import_path" ]]; then
        fatal "PVE_CLOUD_IMAGE_PATH is not set. Run pve_ensure_cloud_image first."
    fi

    # Convert filesystem path to Proxmox volume ID for non-root API users.
    # Proxmox rejects filesystem paths for non-root: "Only root can pass arbitrary filesystem paths."
    # Volume ID format: <storage>:import/<filename> or <storage>:iso/<filename>
    if [[ "$import_path" == /* ]]; then
        local import_fname
        import_fname=$(basename "$import_path")
        if [[ "$import_path" == *"/import/"* ]]; then
            import_path="${PVE_ISO_STORAGE}:import/${import_fname}"
        elif [[ "$import_path" == *"/iso/"* ]]; then
            import_path="${PVE_ISO_STORAGE}:iso/${import_fname}"
        fi
    fi
    log "Importing disk from: $import_path"

    # Detect KVM availability — nested virtualisation often lacks KVM
    local kvm_flag="1" cpu_type="host"
    local node_caps
    node_caps=$(pve_api GET "/nodes/${PROXMOX_NODE}/capabilities/qemu/cpu" 2>/dev/null) || true
    # Simple heuristic: try to check /sys/module/kvm via node status
    # The most reliable way is to just create the VM and handle start failure,
    # but we can check the node's reported KVM support
    local node_status
    node_status=$(pve_api GET "/nodes/${PROXMOX_NODE}/status" 2>/dev/null) || true
    local kvm_supported
    kvm_supported=$(echo "$node_status" | jq -r '.data.ksm.shared // 0' 2>/dev/null || echo "0")
    # A more reliable check: look for 'kvm' in cpuinfo flags or check if /dev/kvm exists
    # Since we can't SSH to the host, we'll create the VM and retry without KVM if start fails
    log "KVM will be auto-detected at VM start (disabled automatically if unavailable)."

    # URL-encode the SSH public key (Proxmox API requires pre-encoded sshkeys)
    local ssh_encoded
    ssh_encoded=$(printf '%s' "$SSH_PUBLIC_KEY" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')

    # Determine ipconfig0: use static IP from bridge subnet if available,
    # otherwise fall back to DHCP (guest agent + slower polling).
    local ipconfig_val="ip=dhcp"
    if [[ -n "${TEMPLATE_BUILD_IP:-}" && -n "${PVE_BRIDGE_MASK:-}" && -n "${PVE_BRIDGE_GW:-}" ]]; then
        ipconfig_val="ip=${TEMPLATE_BUILD_IP}/${PVE_BRIDGE_MASK},gw=${PVE_BRIDGE_GW}"
        log "Template VM will use static IP: ${TEMPLATE_BUILD_IP}"
    else
        log "Template VM will use DHCP (guest agent required for IP discovery)."
    fi

    # Create VM with imported disk via API
    local create_response
    create_response=$(pve_api POST "/nodes/${PROXMOX_NODE}/qemu" \
        --data-urlencode "vmid=${vmid}" \
        --data-urlencode "name=${template_name}" \
        --data-urlencode "description=SRE Rocky Linux 9 - RKE2 pre-staged - Built by quickstart" \
        --data-urlencode "ostype=l26" \
        --data-urlencode "cpu=host" \
        --data-urlencode "cores=2" \
        --data-urlencode "memory=4096" \
        --data-urlencode "scsihw=virtio-scsi-pci" \
        --data-urlencode "scsi0=${PROXMOX_STORAGE}:0,import-from=${import_path}" \
        --data-urlencode "ide2=${PROXMOX_STORAGE}:cloudinit" \
        --data-urlencode "boot=order=scsi0" \
        --data-urlencode "net0=virtio,bridge=${PROXMOX_BRIDGE}" \
        --data-urlencode "serial0=socket" \
        --data-urlencode "vga=serial0" \
        --data-urlencode "agent=enabled=1" \
        --data-urlencode "ipconfig0=${ipconfig_val}" \
        --data-urlencode "ciuser=sre-admin" \
        --data-urlencode "sshkeys=${ssh_encoded}" \
        2>&1) || {
        # If import-from fails, provide a clear error
        error "Failed to create VM with import-from. This requires Proxmox 8.x."
        error "API response: $create_response"
        echo
        error "If your Proxmox version does not support import-from, you can:"
        error "  1. Upgrade to Proxmox 8.2+"
        error "  2. Use the Packer-based workflow instead:"
        error "     cd infrastructure/packer/rocky-linux-9-proxmox && packer build ."
        fatal "Template build failed."
    }

    # The create call may return a UPID for the disk import task
    local upid
    upid=$(echo "$create_response" | jq -r '.data // empty' 2>/dev/null || true)
    if [[ -n "$upid" && "$upid" != "null" ]]; then
        if ! pve_wait_task "$upid" "Importing disk into VM ${vmid}..." 300; then
            fatal "Disk import task failed: ${PVE_TASK_EXIT:-unknown}"
        fi
    fi

    # Resize disk to 40G (cloud images ship with ~10G)
    log "Resizing disk to 40G..."
    pve_api PUT "/nodes/${PROXMOX_NODE}/qemu/${vmid}/resize" \
        --data-urlencode "disk=scsi0" \
        --data-urlencode "size=40G" \
        > /dev/null 2>&1 || warn "Disk resize failed (may already be correct size)."

    success "VM $vmid created with imported cloud image disk."
}

# Wait for QEMU guest agent to report a network interface with an IP
pve_wait_for_guestagent() {
    local vmid="$1"
    local timeout="${2:-300}"
    local elapsed=0

    log "Waiting for QEMU guest agent on VM $vmid to report IP..."

    while (( elapsed < timeout )); do
        local agent_response
        agent_response=$(pve_api GET "/nodes/${PROXMOX_NODE}/qemu/${vmid}/agent/network-get-interfaces" 2>/dev/null) || true

        if [[ -n "$agent_response" ]]; then
            # Look for a non-loopback interface with an IPv4 address
            local ip
            ip=$(echo "$agent_response" | jq -r '
                [.data.result[] |
                    select(.name != "lo") |
                    .["ip-addresses"][]? |
                    select(.["ip-address-type"] == "ipv4") |
                    .["ip-address"]
                ] | first // empty
            ' 2>/dev/null || true)

            if [[ -n "$ip" && "$ip" != "null" ]]; then
                PVE_VM_IP="$ip"
                success "VM $vmid is up at $PVE_VM_IP"
                return 0
            fi
        fi

        sleep 5
        elapsed=$((elapsed + 5))
        printf "\r  Waiting for guest agent... (%ds/%ds)" "$elapsed" "$timeout"
    done

    echo
    fatal "Timed out waiting for guest agent on VM $vmid after ${timeout}s."
}

# SSH into the template VM and run provisioning (RKE2 install, SELinux, cleanup)
pve_run_provisioning() {
    local ip="$1"

    log "Running provisioning on $ip via SSH..."
    log "This installs RKE2, stages air-gap images, and prepares the template."

    # Common SSH options for provisioning
    local ssh_opts=(-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -i "$SSH_KEY_PATH")

    # Wait for SSH to actually accept connections (guest agent IP may be up before sshd)
    local ssh_wait=0
    while ! ssh "${ssh_opts[@]}" sre-admin@"$ip" "exit 0" 2>/dev/null; do
        if (( ssh_wait >= 120 )); then
            fatal "Timed out waiting for SSH on $ip"
        fi
        sleep 5
        ssh_wait=$((ssh_wait + 5))
        printf "\r  Waiting for SSH on %s... (%ds)" "$ip" "$ssh_wait"
    done
    echo
    success "SSH connection established."

    # Run provisioning commands via SSH
    ssh "${ssh_opts[@]}" sre-admin@"$ip" "sudo bash -s" <<'PROVISION_EOF'
set -euo pipefail

echo "=== Enabling QEMU guest agent ==="
# Rocky GenericCloud has qemu-guest-agent installed but not enabled.
# Enable it so cloned VMs will have it running on first boot.
systemctl enable qemu-guest-agent 2>/dev/null || true
systemctl start qemu-guest-agent 2>/dev/null || true

echo "=== Waiting for cloud-init to finish ==="
cloud-init status --wait 2>/dev/null || sleep 30

echo "=== Installing RKE2 (server + agent packages) ==="
# Install via RPM for proper systemd units and /usr/bin/rke2 path.
# Install BOTH server and agent so cloned VMs can serve either role.
dnf install -y container-selinux
curl -sfL https://get.rke2.io -o /tmp/rke2-install.sh
chmod 700 /tmp/rke2-install.sh
INSTALL_RKE2_CHANNEL='stable' INSTALL_RKE2_TYPE='server' /tmp/rke2-install.sh
INSTALL_RKE2_CHANNEL='stable' INSTALL_RKE2_TYPE='agent' /tmp/rke2-install.sh
rm -f /tmp/rke2-install.sh
echo "RKE2 server + agent installed."

# Determine rke2 binary path (RPM installs to /usr/bin, script to /usr/local/bin)
RKE2_BIN=$(command -v rke2 2>/dev/null || echo "/usr/bin/rke2")

echo "=== Downloading RKE2 air-gap images ==="
mkdir -p /var/lib/rancher/rke2/agent/images
RKE2_FULL_VERSION=$($RKE2_BIN --version 2>/dev/null | head -1 | awk '{print $3}' || echo "")
if [[ -n "$RKE2_FULL_VERSION" ]]; then
    # GitHub release tags use + not - (URL-encode the +)
    RKE2_RELEASE=$(echo "$RKE2_FULL_VERSION" | sed 's/+/%2B/')
    curl -sfL -o /var/lib/rancher/rke2/agent/images/rke2-images-core.linux-amd64.tar.zst \
        "https://github.com/rancher/rke2/releases/download/${RKE2_RELEASE}/rke2-images-core.linux-amd64.tar.zst" \
        || echo "WARN: Could not download core images tarball"
    curl -sfL -o /var/lib/rancher/rke2/agent/images/rke2-images-canal.linux-amd64.tar.zst \
        "https://github.com/rancher/rke2/releases/download/${RKE2_RELEASE}/rke2-images-canal.linux-amd64.tar.zst" \
        || echo "WARN: Could not download canal images tarball"
    echo "Air-gap images staged."
    ls -lh /var/lib/rancher/rke2/agent/images/ || true
else
    echo "WARN: Could not detect RKE2 version for air-gap image download"
fi

echo "=== Installing RKE2 SELinux policy ==="
dnf install -y rke2-selinux || echo "WARN: rke2-selinux not available via dnf, will be installed at first RKE2 start"

echo "=== Configuring kernel modules for RKE2 ==="
tee /etc/modules-load.d/rke2.conf > /dev/null <<MODEOF
br_netfilter
overlay
MODEOF

echo "=== Ensuring sre-admin user is configured ==="
# sre-admin was created by cloud-init, ensure it has correct sudo
echo 'sre-admin ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/sre-admin
chmod 0440 /etc/sudoers.d/sre-admin

echo "=== Cleaning up for template snapshot ==="
dnf clean all
rm -rf /var/cache/dnf /tmp/* /var/tmp/*
truncate -s 0 /var/log/messages /var/log/secure /var/log/audit/audit.log 2>/dev/null || true
rm -f /etc/ssh/ssh_host_*
rm -f /root/.bash_history /home/sre-admin/.bash_history
cloud-init clean --logs --seed 2>/dev/null || true
# Remove RKE2 runtime state (binary stays, config stays, no node identity)
rm -rf /var/lib/rancher/rke2/server /var/lib/rancher/rke2/agent/pod-manifests
rm -f /etc/rancher/rke2/rke2.yaml
echo "=== Template cleanup complete ==="
PROVISION_EOF

    success "Provisioning complete."
}

# Stop VM and convert to template
pve_convert_to_template() {
    local vmid="$1"

    log "Stopping VM $vmid..."
    pve_api POST "/nodes/${PROXMOX_NODE}/qemu/${vmid}/status/stop" > /dev/null 2>&1 || true

    # Wait for VM to actually stop
    local stop_wait=0
    while (( stop_wait < 60 )); do
        local status_response
        status_response=$(pve_api GET "/nodes/${PROXMOX_NODE}/qemu/${vmid}/status/current" 2>/dev/null) || true
        local vm_status
        vm_status=$(echo "$status_response" | jq -r '.data.status // empty' 2>/dev/null || true)
        if [[ "$vm_status" == "stopped" ]]; then
            break
        fi
        sleep 3
        stop_wait=$((stop_wait + 3))
    done

    log "Converting VM $vmid to template..."
    pve_api POST "/nodes/${PROXMOX_NODE}/qemu/${vmid}/template" > /dev/null \
        || fatal "Failed to convert VM $vmid to template."

    success "VM $vmid converted to template."
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
    prompt       PROXMOX_STORAGE "Storage pool for VM disks" "local-lvm"
    prompt       PROXMOX_BRIDGE  "Network bridge" "vmbr0"

    # Derive host from URL for API calls
    PROXMOX_HOST=$(echo "$PROXMOX_URL" | sed -E 's|^https?://||; s|:[0-9]+.*||')

    # Advanced mode needs ticket auth for template build (API token may lack create perms)
    # Try to authenticate — if it fails, we'll just need SKIP_TEMPLATE=1
    if [[ -z "${PVE_TICKET:-}" ]]; then
        warn "Advanced mode: cloud image template build requires root@pam authentication."
        warn "Set SKIP_TEMPLATE=1 if you already have a template, or provide PROXMOX_AUTH_PASS."
        if [[ -n "${PROXMOX_AUTH_PASS:-${PROXMOX_ROOT_PASS:-}}" ]]; then
            pve_authenticate "$PROXMOX_HOST" "${PROXMOX_AUTH_PASS:-$PROXMOX_ROOT_PASS}" || true
            unset PROXMOX_AUTH_PASS PROXMOX_ROOT_PASS
        fi
    fi

    # Discover ISO storage for cloud image download
    if [[ -z "${PVE_ISO_STORAGE:-}" && -n "${PVE_TICKET:-}" ]]; then
        pve_discover_storage
    else
        PVE_ISO_STORAGE="${PVE_ISO_STORAGE:-local}"
    fi

    # Discover bridge subnet for template build static IP
    if [[ -n "${PVE_TICKET:-}" && -n "${PROXMOX_NODE:-}" ]]; then
        pve_discover_bridge_subnet || warn "Bridge subnet auto-detection failed."
    fi
else
    # ── Zero-Touch Mode ───────────────────────────────────────────────────
    echo "Zero-touch mode: the script will auto-discover your Proxmox environment,"
    echo "create an API user, and download the Rocky Linux 9 cloud image."
    echo
    echo "You only need the Proxmox host IP and root password."
    echo

    prompt        PROXMOX_HOST      "Proxmox host IP or hostname"

    # Support PROXMOX_ROOT_PASS as backward-compatible alias
    if [[ -n "${PROXMOX_ROOT_PASS:-}" && -z "${PROXMOX_AUTH_PASS:-}" ]]; then
        PROXMOX_AUTH_PASS="$PROXMOX_ROOT_PASS"
    fi

    prompt        PROXMOX_AUTH_USER "Proxmox username (e.g., root@pam, user@pve)" "root@pam"
    prompt_secret PROXMOX_AUTH_PASS "Password for ${PROXMOX_AUTH_USER} (used once, then discarded)"

    # ── Phase 1b: Proxmox API Bootstrap ───────────────────────────────────

    header "Phase 1b: Proxmox API Bootstrap"

    log "Authenticating to Proxmox at $PROXMOX_HOST..."
    pve_authenticate "$PROXMOX_HOST" "$PROXMOX_AUTH_PASS" || exit 1
    success "Authenticated to Proxmox."

    # Discard password from memory immediately
    unset PROXMOX_AUTH_PASS PROXMOX_ROOT_PASS

    log "Auto-discovering environment..."
    pve_discover_node
    pve_discover_storage
    pve_discover_bridge
    pve_discover_bridge_subnet || warn "Bridge subnet auto-detection failed."

    echo
    log "Creating API credentials..."
    pve_create_api_user

    echo
    log "Ensuring Rocky Linux 9 cloud image is available..."
    pve_ensure_cloud_image

    # Keep PVE_TICKET and PVE_CSRF for Phase 2 (template build uses root API)
    # They will be cleaned up after Phase 2.

    # Set the URL from the host
    PROXMOX_URL="https://${PROXMOX_HOST}:8006"

    echo
    success "Bootstrap complete. Proxmox environment is ready."
fi

echo
header "Deployment Profile"
echo "  Select a deployment profile for the platform services."
echo "  This controls replicas, persistence, and service exposure."
echo
echo "  1) single-node  — All-in-one (1 host, no persistence, dev mode secrets)"
echo "  2) small         — Small cluster (2-3 hosts, persistence, standalone secrets)"
echo "  3) production    — HA deployment (4+ hosts, full persistence, HA secrets)"
echo
prompt       DEPLOY_PROFILE  "Select profile (1/2/3)" "2"

# Map number to profile name
case "$DEPLOY_PROFILE" in
    1|single-node)  DEPLOY_PROFILE="single-node" ;;
    2|small)        DEPLOY_PROFILE="small" ;;
    3|production)   DEPLOY_PROFILE="production" ;;
    *)              warn "Unknown profile '$DEPLOY_PROFILE', defaulting to 'small'."; DEPLOY_PROFILE="small" ;;
esac

success "Deployment profile: $DEPLOY_PROFILE"

# Set default node counts based on profile
case "$DEPLOY_PROFILE" in
    single-node)  DEFAULT_SERVERS=1; DEFAULT_AGENTS=0 ;;
    small)        DEFAULT_SERVERS=1; DEFAULT_AGENTS=2 ;;
    production)   DEFAULT_SERVERS=3; DEFAULT_AGENTS=3 ;;
esac

echo
log "Cluster sizing (adjust for your hardware):"
prompt       SERVER_COUNT    "Control plane nodes" "$DEFAULT_SERVERS"
prompt       AGENT_COUNT     "Worker nodes" "$DEFAULT_AGENTS"

# Warn on profile/node mismatch
TOTAL_NODES=$((SERVER_COUNT + AGENT_COUNT))
case "$DEPLOY_PROFILE" in
    production)
        if (( TOTAL_NODES < 4 )); then
            warn "Production profile selected but only $TOTAL_NODES node(s). HA may be degraded."
        fi
        ;;
    single-node)
        if (( TOTAL_NODES > 1 )); then
            warn "Single-node profile selected but $TOTAL_NODES nodes configured. Profile still uses minimal resources."
        fi
        ;;
esac

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
echo "  Storage pool:     $PROXMOX_STORAGE"
echo "  Network bridge:   $PROXMOX_BRIDGE"
echo "  Template VMID:    $TEMPLATE_VMID"
echo "  Deploy profile:   $DEPLOY_PROFILE"
echo "  Server nodes:     $SERVER_COUNT"
echo "  Worker nodes:     $AGENT_COUNT"
echo "  SSH key:          $SSH_KEY_PATH"
echo

if ! prompt_yesno "Proceed with deployment?"; then
    log "Aborted."
    exit 0
fi

# Normalize the Proxmox URL (strip trailing slash)
PROXMOX_URL_BASE="${PROXMOX_URL%/}"
# Tofu uses the base URL without /api2/json
PROXMOX_URL_TOFU="$PROXMOX_URL_BASE"

# ============================================================================
# Phase 2: Build VM Template (Cloud Image Import)
# ============================================================================
# This uses the Proxmox REST API to import a Rocky Linux GenericCloud qcow2
# image, boot it with cloud-init, provision via SSH, and convert to template.
# No Packer, no ISO boot, no KVM dependency.
#
# For full STIG-hardened production templates, use the Packer workflow:
#   cd infrastructure/packer/rocky-linux-9-proxmox && packer build .

if [[ "${SKIP_TEMPLATE:-${SKIP_PACKER:-0}}" == "1" ]]; then
    warn "Skipping template build (SKIP_TEMPLATE=1)"
else
    header "Phase 2: Building VM Template (Cloud Image Import)"
    log "This imports a Rocky Linux 9 cloud image, provisions it, and creates a template."
    log "This step takes 10-15 minutes (no KVM required)."
    echo

    # Ensure we have API credentials for template build
    if [[ -z "${PVE_TICKET:-}" ]]; then
        # In advanced mode, we may need to authenticate for template build
        if [[ -n "${PROXMOX_AUTH_PASS:-${PROXMOX_ROOT_PASS:-}}" ]]; then
            pve_authenticate "$PROXMOX_HOST" "${PROXMOX_AUTH_PASS:-$PROXMOX_ROOT_PASS}" || fatal "Authentication failed."
            unset PROXMOX_AUTH_PASS PROXMOX_ROOT_PASS
        else
            warn "No root@pam session available for template build."
            warn "Attempting template build with API token (may fail if permissions are insufficient)."
        fi
    fi

    # Step 1: Ensure cloud image is on Proxmox storage
    if [[ -z "${PVE_CLOUD_IMAGE_PATH:-}" ]]; then
        pve_ensure_cloud_image
    fi

    # Step 2: Create VM with imported disk and cloud-init
    pve_create_template_vm

    if [[ "${PVE_TEMPLATE_EXISTS:-false}" != "true" ]]; then
        # Step 3: Start the VM (with KVM auto-detection)
        log "Starting VM $TEMPLATE_VMID..."
        start_response=""
        start_upid=""
        start_ok=false
        start_response=$(pve_api POST "/nodes/${PROXMOX_NODE}/qemu/${TEMPLATE_VMID}/status/start" 2>&1) || true
        start_upid=$(echo "$start_response" | jq -r '.data // empty' 2>/dev/null || true)

        if [[ -n "$start_upid" ]]; then
            if pve_wait_task "$start_upid" "Starting VM..." 60; then
                start_ok=true
            else
                start_err="${PVE_TASK_EXIT:-unknown}"
                if echo "$start_err" | grep -qi "KVM.*not available\|KVM virtualisation"; then
                    warn "KVM hardware virtualisation is not available."
                    warn "This is normal when Proxmox runs inside VMware/VirtualBox/Hyper-V."
                    log "Switching to QEMU emulation mode..."
                    # Use cpu=max for best QEMU emulation compatibility.
                    # Rocky Linux 9 needs x86-64-v2; specific CPU types like
                    # qemu64 or x86-64-v2-AES can hang without KVM. cpu=max
                    # exposes all features QEMU can software-emulate.
                    pve_api PUT "/nodes/${PROXMOX_NODE}/qemu/${TEMPLATE_VMID}/config" \
                        --data-urlencode "kvm=0" \
                        --data-urlencode "cpu=max" \
                        > /dev/null 2>&1 || warn "Failed to set kvm=0"

                    log "Starting VM $TEMPLATE_VMID with QEMU emulation..."
                    start_response=$(pve_api POST "/nodes/${PROXMOX_NODE}/qemu/${TEMPLATE_VMID}/status/start" 2>&1) || true
                    start_upid=$(echo "$start_response" | jq -r '.data // empty' 2>/dev/null || true)
                    if [[ -n "$start_upid" ]]; then
                        if pve_wait_task "$start_upid" "Starting VM (QEMU emulation)..." 60; then
                            start_ok=true
                        fi
                    fi
                fi
            fi
        fi

        if [[ "$start_ok" != "true" ]]; then
            fatal "Failed to start VM $TEMPLATE_VMID. Check the Proxmox task log."
        fi

        # Step 4: Wait for VM to become reachable via SSH
        # Strategy: if we have a static IP (from bridge subnet detection), poll SSH
        # directly — no guest agent needed. Otherwise, fall back to guest agent.
        if [[ -n "${TEMPLATE_BUILD_IP:-}" ]]; then
            # Static IP: poll SSH directly (no guest agent dependency)
            log "Waiting for SSH on ${TEMPLATE_BUILD_IP}..."
            log "(QEMU emulation is slow — this may take several minutes)"
            ssh_wait=0
            ssh_timeout=600
            while ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes \
                    -i "$SSH_KEY_PATH" sre-admin@"${TEMPLATE_BUILD_IP}" "exit 0" 2>/dev/null; do
                if (( ssh_wait >= ssh_timeout )); then
                    fatal "Timed out waiting for SSH on ${TEMPLATE_BUILD_IP} after ${ssh_timeout}s."
                fi
                sleep 10
                ssh_wait=$((ssh_wait + 10))
                printf "\r  Waiting for SSH on %s... (%ds/%ds)" "$TEMPLATE_BUILD_IP" "$ssh_wait" "$ssh_timeout"
            done
            echo
            success "SSH connection established at ${TEMPLATE_BUILD_IP}."
            PVE_VM_IP="$TEMPLATE_BUILD_IP"
        else
            # DHCP: fall back to guest agent IP discovery (slower, may not work
            # on GenericCloud images without cicustom snippet)
            warn "No static IP available — falling back to guest agent for IP discovery."
            warn "This requires qemu-guest-agent to be running in the VM."
            pve_wait_for_guestagent "$TEMPLATE_VMID" 600
        fi

        # Step 5: Provision via SSH
        pve_run_provisioning "$PVE_VM_IP"

        # Step 6: Reset cloud-init to DHCP before converting to template.
        # The template used a static IP for provisioning; cloned VMs should
        # get their IPs from DHCP or per-clone ipconfig0 (set by OpenTofu).
        log "Resetting cloud-init network to DHCP for template..."
        pve_api PUT "/nodes/${PROXMOX_NODE}/qemu/${TEMPLATE_VMID}/config" \
            --data-urlencode "ipconfig0=ip=dhcp" \
            > /dev/null 2>&1 || warn "Could not reset ipconfig0 (non-fatal)."

        # Step 7: Convert to template
        pve_convert_to_template "$TEMPLATE_VMID"
    fi

    success "VM template built successfully."

    # Clean up PVE session credentials (no longer needed)
    unset PVE_TICKET PVE_CSRF 2>/dev/null || true
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

# Note: rke2_server_url is computed automatically by install-rke2.yml from the
# inventory (first control_plane host initializes, others join it).
# Do NOT pass rke2_server_url via --extra-vars — it would override the per-host logic.
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
    FLUX_BOOTSTRAPPED=false
else
    FLUX_BOOTSTRAPPED=false
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
            FLUX_BOOTSTRAPPED=true

            # ── Apply deployment profile ──────────────────────────────────
            log "Applying deployment profile: $DEPLOY_PROFILE"

            # Configure domain — use sslip.io for automatic DNS resolution
            SRE_DOMAIN="${FIRST_SERVER_IP}.sslip.io"
            log "Setting SRE_DOMAIN to: $SRE_DOMAIN"

            # Apply the environment profile Flux Kustomization
            kubectl apply -f - <<PROFILE_EOF
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: sre-environment
  namespace: flux-system
spec:
  interval: 10m
  path: ./platform/environments/${DEPLOY_PROFILE}
  prune: true
  sourceRef:
    kind: GitRepository
    name: sre-platform
PROFILE_EOF
            success "Environment profile applied: $DEPLOY_PROFILE"

            # Patch the domain ConfigMap with the actual node IP
            kubectl create configmap sre-domain-config \
                --from-literal="SRE_DOMAIN=${SRE_DOMAIN}" \
                -n flux-system \
                --dry-run=client -o yaml | kubectl apply -f -
            success "Domain configured: $SRE_DOMAIN"

            log "Platform services will begin deploying via GitOps."
            log "Monitor progress with: flux get kustomizations -A --watch"
        fi
    else
        warn "Flux CLI not installed — skipping Flux bootstrap."
        warn "Install it and run manually: flux bootstrap github --owner=morbidsteve --repository=sre-platform --path=platform/flux-system --branch=main --personal"
    fi
fi

# ============================================================================
# Phase 8: Post-Flux Configuration
# ============================================================================

if [[ "$FLUX_BOOTSTRAPPED" == "true" ]]; then
    header "Phase 8: Post-Flux Configuration"

    # ── Wait for core components to deploy ────────────────────────────────
    log "Waiting for Flux to reconcile core components..."
    log "This may take 10-20 minutes for all HelmReleases to deploy."
    echo

    # Wait for the monitoring namespace to exist (indicates Flux is deploying)
    FLUX_WAIT=0
    while ! kubectl get namespace monitoring > /dev/null 2>&1; do
        if (( FLUX_WAIT >= 300 )); then
            warn "Monitoring namespace not created after 300s. Continuing anyway."
            break
        fi
        sleep 15
        FLUX_WAIT=$((FLUX_WAIT + 15))
        printf "\r  Waiting for Flux to create namespaces... (%ds)" "$FLUX_WAIT"
    done
    echo

    # Wait for key deployments to be available
    for deploy_info in \
        "monitoring/kube-prometheus-stack-grafana" \
        "kyverno/kyverno-admission-controller"; do

        ns="${deploy_info%%/*}"
        deploy="${deploy_info##*/}"

        if kubectl get namespace "$ns" > /dev/null 2>&1; then
            log "Waiting for $ns/$deploy..."
            kubectl wait --for=condition=Available deployment/"$deploy" -n "$ns" --timeout=600s 2>/dev/null \
                || warn "$ns/$deploy not ready yet (non-fatal, may still be deploying)"
        fi
    done

    # ── Bootstrap secrets ─────────────────────────────────────────────────
    log "Creating platform secrets..."
    "$REPO_ROOT/scripts/bootstrap-secrets.sh" || warn "bootstrap-secrets.sh had errors (non-fatal)"

    # ── Initialize OpenBao ────────────────────────────────────────────────
    if kubectl get namespace openbao > /dev/null 2>&1; then
        # Wait for OpenBao pods
        log "Waiting for OpenBao to deploy..."
        kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=openbao -n openbao --timeout=300s 2>/dev/null \
            || warn "OpenBao pods not ready yet"

        "$REPO_ROOT/scripts/init-openbao.sh" || warn "init-openbao.sh had errors (non-fatal)"
    fi

    # ── Verify deployment ─────────────────────────────────────────────────
    echo
    log "Running deployment verification..."
    SRE_DOMAIN="${SRE_DOMAIN:-}" "$REPO_ROOT/scripts/verify-deployment.sh" || warn "Some verification checks failed."

    success "Phase 8 complete."
fi

# ============================================================================
# Done
# ============================================================================

header "Deployment Complete"

echo -e "  ${BOLD}Cluster:${NC}        $EXPECTED_NODES nodes ($SERVER_COUNT server + $AGENT_COUNT worker)"
echo -e "  ${BOLD}Profile:${NC}        $DEPLOY_PROFILE"
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

if [[ "$FLUX_BOOTSTRAPPED" == "true" && -n "${SRE_DOMAIN:-}" ]]; then
    echo "Platform UIs (via Istio Gateway):"
    if [[ "$DEPLOY_PROFILE" == "single-node" ]]; then
        echo "  Grafana:    http://$FIRST_SERVER_IP:30080"
        echo "  OpenBao:    http://$FIRST_SERVER_IP:30200"
        echo "  NeuVector:  https://$FIRST_SERVER_IP:30300"
    else
        GW_PORT=$(kubectl get svc istio-gateway -n istio-system -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "31443")
        echo "  Grafana:    https://grafana.${SRE_DOMAIN}:${GW_PORT}"
        echo "  OpenBao:    https://openbao.${SRE_DOMAIN}:${GW_PORT}"
        echo "  NeuVector:  https://neuvector.${SRE_DOMAIN}:${GW_PORT}"
        echo "  Harbor:     https://harbor.${SRE_DOMAIN}:${GW_PORT}"
        echo "  Keycloak:   https://keycloak.${SRE_DOMAIN}:${GW_PORT}"
    fi
    echo
    echo "  Note: Use -k with curl (or accept the self-signed certificate in your browser)"
    echo "        The internal CA certificate is auto-generated by cert-manager."
    echo
else
    echo "To access Grafana (after Flux deploys monitoring):"
    echo "  kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80"
    echo "  Then open http://localhost:3000 in your browser"
    echo
fi

echo "Next steps:"
echo "  1. Read the Operator Guide:    docs/operator-guide.md"
echo "  2. Onboard a team:             docs/onboarding-guide.md"
echo "  3. Deploy an app:              docs/getting-started-developer.md"
echo

success "SRE platform is ready."
