#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Access Services
# ============================================================================
# Opens port-forwards and prints access information for platform services.
#
# Usage:
#   ./scripts/sre-access.sh            # Show all service info
#   ./scripts/sre-access.sh grafana    # Port-forward Grafana only
#   ./scripts/sre-access.sh all        # Port-forward all services
#   ./scripts/sre-access.sh status     # Quick health check
#   ./scripts/sre-access.sh creds      # Show all credentials
#   ./scripts/sre-access.sh stop       # Stop all port-forwards
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()     { echo -e "${BLUE}[sre]${NC} $*"; }
success() { echo -e "${GREEN}[sre]${NC} $*"; }
warn()    { echo -e "${YELLOW}[sre]${NC} $*"; }
error()   { echo -e "${RED}[sre]${NC} $*" >&2; }

PF_PIDFILE="/tmp/sre-port-forwards.pids"

# ── Service Definitions ─────────────────────────────────────────────────────

# Format: name|namespace|service|local_port|remote_port|protocol
SERVICES=(
    "grafana|monitoring|svc/kube-prometheus-stack-grafana|3000|80|http"
    "prometheus|monitoring|svc/kube-prometheus-stack-prometheus|9090|9090|http"
    "alertmanager|monitoring|svc/kube-prometheus-stack-alertmanager|9093|9093|http"
    "neuvector|neuvector|svc/neuvector-service-webui|8443|8443|https"
    "openbao|openbao|svc/openbao|8200|8200|http"
)

# ── Functions ───────────────────────────────────────────────────────────────

get_field() {
    echo "$1" | cut -d'|' -f"$2"
}

check_service_running() {
    local ns="$1" svc="$2"
    kubectl get "$svc" -n "$ns" &>/dev/null 2>&1
}

start_port_forward() {
    local name ns svc local_port remote_port
    name=$(get_field "$1" 1)
    ns=$(get_field "$1" 2)
    svc=$(get_field "$1" 3)
    local_port=$(get_field "$1" 4)
    remote_port=$(get_field "$1" 5)

    # Check if already forwarding on this port
    if lsof -i :"$local_port" &>/dev/null 2>&1; then
        warn "$name is already accessible on port $local_port"
        return 0
    fi

    if ! check_service_running "$ns" "$svc"; then
        warn "$name service not found ($ns/$svc). Skipping."
        return 0
    fi

    kubectl port-forward -n "$ns" "$svc" "$local_port:$remote_port" &>/dev/null &
    local pid=$!
    echo "$pid" >> "$PF_PIDFILE"

    # Wait briefly and check if it's still running
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        success "$name ready"
        return 0
    else
        warn "$name port-forward failed"
        return 1
    fi
}

stop_port_forwards() {
    if [[ -f "$PF_PIDFILE" ]]; then
        while read -r pid; do
            kill "$pid" 2>/dev/null || true
        done < "$PF_PIDFILE"
        rm -f "$PF_PIDFILE"
        success "All port-forwards stopped"
    else
        log "No active port-forwards found"
    fi
}

show_status() {
    echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Status ═══${NC}\n"

    # HelmReleases
    local total=0 ready=0
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        total=$((total + 1))
        ns=$(echo "$line" | awk '{print $1}')
        name=$(echo "$line" | awk '{print $2}')
        status=$(echo "$line" | awk '{print $3}')
        if [[ "$status" == "True" ]]; then
            ready=$((ready + 1))
            echo -e "  ${GREEN}[OK]${NC}  $ns/$name"
        else
            echo -e "  ${RED}[!!]${NC}  $ns/$name"
        fi
    done < <(kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status' --no-headers 2>/dev/null || true)

    echo
    echo -e "  ${BOLD}$ready/$total${NC} HelmReleases healthy"

    # Problem pods
    PROBLEMS=$(kubectl get pods -A --no-headers 2>/dev/null | grep -v "Running\|Completed" | wc -l)
    if (( PROBLEMS > 0 )); then
        echo -e "  ${RED}$PROBLEMS${NC} pods not running:"
        kubectl get pods -A --no-headers 2>/dev/null | grep -v "Running\|Completed" | awk '{printf "    %-25s %-45s %s\n", $1, $2, $4}'
    else
        echo -e "  ${GREEN}All pods healthy${NC}"
    fi
    echo
}

show_credentials() {
    echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Credentials ═══${NC}\n"

    # Grafana
    GRAFANA_PASS=$(kubectl get secret grafana-admin-credentials -n monitoring -o jsonpath='{.data.adminPassword}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    if [[ -z "$GRAFANA_PASS" ]]; then
        # Try the chart's default secret
        GRAFANA_PASS=$(kubectl get secret kube-prometheus-stack-grafana -n monitoring -o jsonpath='{.data.admin-password}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    fi
    if [[ -n "$GRAFANA_PASS" ]]; then
        echo -e "  ${BOLD}Grafana${NC}"
        echo -e "    Username: admin"
        echo -e "    Password: $GRAFANA_PASS"
        echo
    fi

    # NeuVector (default)
    echo -e "  ${BOLD}NeuVector${NC}"
    echo -e "    Username: admin"
    echo -e "    Password: admin ${DIM}(change on first login)${NC}"
    echo

    # OpenBao
    OPENBAO_TOKEN=$(kubectl get secret openbao-init -n openbao -o jsonpath='{.data.root-token}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    if [[ -n "$OPENBAO_TOKEN" ]]; then
        echo -e "  ${BOLD}OpenBao${NC}"
        echo -e "    Root Token: $OPENBAO_TOKEN"
        echo
    else
        echo -e "  ${BOLD}OpenBao${NC}"
        echo -e "    ${DIM}Not initialized yet. Run: ./scripts/init-openbao.sh${NC}"
        echo
    fi
}

show_access_info() {
    echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Access Info ═══${NC}\n"

    echo -e "  ${BOLD}Services:${NC}"
    echo
    for svc_def in "${SERVICES[@]}"; do
        local name proto local_port
        name=$(get_field "$svc_def" 1)
        local_port=$(get_field "$svc_def" 4)
        proto=$(get_field "$svc_def" 6)
        printf "    %-15s %s://localhost:%s\n" "$name" "$proto" "$local_port"
    done

    echo
    echo -e "  ${BOLD}To open a service:${NC}"
    echo -e "    ${CYAN}./scripts/sre-access.sh grafana${NC}       # Open Grafana"
    echo -e "    ${CYAN}./scripts/sre-access.sh all${NC}           # Open everything"
    echo -e "    ${CYAN}./scripts/sre-access.sh stop${NC}          # Stop port-forwards"
    echo

    show_credentials
}

open_service() {
    local target="$1"

    echo -e "\n${BOLD}${CYAN}═══ SRE Platform — Opening $target ═══${NC}\n"

    for svc_def in "${SERVICES[@]}"; do
        local name proto local_port
        name=$(get_field "$svc_def" 1)
        local_port=$(get_field "$svc_def" 4)
        proto=$(get_field "$svc_def" 6)

        if [[ "$target" == "all" ]] || [[ "$target" == "$name" ]]; then
            start_port_forward "$svc_def"
        fi
    done

    echo

    # Show relevant URLs
    for svc_def in "${SERVICES[@]}"; do
        local name proto local_port
        name=$(get_field "$svc_def" 1)
        local_port=$(get_field "$svc_def" 4)
        proto=$(get_field "$svc_def" 6)

        if [[ "$target" == "all" ]] || [[ "$target" == "$name" ]]; then
            echo -e "  ${BOLD}$name:${NC} ${proto}://localhost:${local_port}"
        fi
    done

    echo
    show_credentials

    echo -e "  ${DIM}Port-forwards running in background. Stop with: ./scripts/sre-access.sh stop${NC}"
    echo -e "  ${DIM}Press Ctrl+C to stop all port-forwards.${NC}"
    echo

    # Keep the script running so port-forwards stay alive
    trap 'stop_port_forwards; exit 0' INT TERM
    wait
}

# ── Main ────────────────────────────────────────────────────────────────────

COMMAND="${1:-info}"

case "$COMMAND" in
    status)
        show_status
        ;;
    creds|credentials)
        show_credentials
        ;;
    stop)
        stop_port_forwards
        ;;
    info)
        show_access_info
        ;;
    all|grafana|prometheus|alertmanager|neuvector|openbao)
        open_service "$COMMAND"
        ;;
    *)
        echo "Usage: $0 {info|status|creds|all|grafana|prometheus|alertmanager|neuvector|openbao|stop}"
        exit 1
        ;;
esac
