#!/usr/bin/env bash
# sre-deploy-app.sh — Deploy an application to the SRE platform
#
# Interactive mode (default):
#   ./scripts/sre-deploy-app.sh
#
# Non-interactive mode (for scripting / bulk deploys):
#   ./scripts/sre-deploy-app.sh \
#     --name my-app \
#     --team team-alpha \
#     --image docker.io/myorg/my-app \
#     --tag v1.0.0 \
#     --port 8080 \
#     [--chart web-app] \
#     [--replicas 2] \
#     [--ingress my-app.apps.sre.example.com] \
#     [--hpa] \
#     [--metrics] \
#     [--no-commit]
#
# Bulk deploy example:
#   for app in api-gateway user-svc order-svc payment-svc; do
#     ./scripts/sre-deploy-app.sh \
#       --name "$app" --team my-team \
#       --image "docker.io/myorg/$app" --tag v1.0.0 \
#       --port 8080 --no-commit
#   done
#   git add apps/tenants/my-team/ && git commit -m "feat: deploy all services" && git push

set -euo pipefail

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# Resolve repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANTS_DIR="${REPO_ROOT}/apps/tenants"
TEMPLATES_DIR="${REPO_ROOT}/apps/templates"

# ---------- CLI argument parsing ----------

CLI_MODE=false
NO_COMMIT=false
APP_NAME="" TEAM="" IMAGE_REPO="" IMAGE_TAG="" APP_PORT="8080"
CHART_TYPE="web-app" REPLICAS="1" INGRESS_HOST="" HPA_ENABLED="false"
METRICS_ENABLED="false" LIVENESS_PATH="/" READINESS_PATH="/"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)     APP_NAME="$2"; CLI_MODE=true; shift 2 ;;
    --team)     TEAM="$2"; shift 2 ;;
    --image)    IMAGE_REPO="$2"; shift 2 ;;
    --tag)      IMAGE_TAG="$2"; shift 2 ;;
    --port)     APP_PORT="$2"; shift 2 ;;
    --chart)    CHART_TYPE="$2"; shift 2 ;;
    --replicas) REPLICAS="$2"; shift 2 ;;
    --ingress)  INGRESS_HOST="$2"; shift 2 ;;
    --hpa)      HPA_ENABLED="true"; shift ;;
    --metrics)  METRICS_ENABLED="true"; shift ;;
    --liveness) LIVENESS_PATH="$2"; shift 2 ;;
    --readiness) READINESS_PATH="$2"; shift 2 ;;
    --no-commit) NO_COMMIT=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--name NAME --team TEAM --image IMAGE --tag TAG] [options]"
      echo ""
      echo "Interactive mode (no args) or non-interactive with --name."
      echo ""
      echo "Required (non-interactive):"
      echo "  --name NAME       Application name"
      echo "  --team TEAM       Team namespace"
      echo "  --image IMAGE     Container image repository"
      echo "  --tag TAG         Image tag"
      echo ""
      echo "Optional:"
      echo "  --port PORT       Container port (default: 8080)"
      echo "  --chart CHART     Chart template: web-app|api-service|worker|cronjob (default: web-app)"
      echo "  --replicas N      Number of replicas (default: 1)"
      echo "  --ingress HOST    Enable ingress with hostname"
      echo "  --hpa             Enable autoscaling"
      echo "  --metrics         Enable Prometheus ServiceMonitor"
      echo "  --liveness PATH   Liveness probe path (default: /)"
      echo "  --readiness PATH  Readiness probe path (default: /)"
      echo "  --no-commit       Generate files only, don't commit to Git"
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

INGRESS_ENABLED="false"
if [[ -n "${INGRESS_HOST}" ]]; then
  INGRESS_ENABLED="true"
fi

# If CLI args provided, validate and skip to generation
if [[ "${CLI_MODE}" == "true" ]]; then
  for var in APP_NAME TEAM IMAGE_REPO IMAGE_TAG; do
    if [[ -z "${!var}" ]]; then
      error "Missing required flag: --$(echo "${var}" | tr '[:upper:]' '[:lower:]' | tr '_' '-')"
      error "Run $0 --help for usage."
      exit 1
    fi
  done
fi

# ---------- Functions ----------

show_banner() {
  echo -e "${BOLD}${CYAN}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║     SRE Platform — Deploy Application     ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "${RESET}"
}

prompt() {
  local var_name="$1" prompt_text="$2" default="${3:-}"
  if [[ -n "${default}" ]]; then
    echo -en "  ${CYAN}${prompt_text}${RESET} ${DIM}[${default}]${RESET}: "
  else
    echo -en "  ${CYAN}${prompt_text}${RESET}: "
  fi
  read -r input
  if [[ -z "${input}" && -n "${default}" ]]; then
    eval "${var_name}=\"${default}\""
  elif [[ -z "${input}" ]]; then
    error "This field is required."
    prompt "${var_name}" "${prompt_text}" "${default}"
  else
    eval "${var_name}=\"${input}\""
  fi
}

prompt_choice() {
  local var_name="$1" prompt_text="$2"
  shift 2
  local options=("$@")

  echo -e "  ${CYAN}${prompt_text}${RESET}"
  for i in "${!options[@]}"; do
    echo -e "    ${BOLD}$((i + 1)))${RESET} ${options[$i]}"
  done
  echo -en "  ${CYAN}Choose${RESET} ${DIM}[1]${RESET}: "
  read -r choice
  choice="${choice:-1}"
  if [[ "${choice}" -ge 1 && "${choice}" -le "${#options[@]}" ]]; then
    eval "${var_name}=\"${options[$((choice - 1))]}\""
  else
    eval "${var_name}=\"${options[0]}\""
  fi
}

# ---------- Pre-flight checks ----------

# Check we're in the repo
if [[ ! -f "${REPO_ROOT}/CLAUDE.md" ]]; then
  error "Must be run from the sre-platform repository."
  exit 1
fi

# List available teams
TEAMS=()
if [[ -d "${TENANTS_DIR}" ]]; then
  while IFS= read -r d; do
    team_name="$(basename "$d")"
    TEAMS+=("${team_name}")
  done < <(find "${TENANTS_DIR}" -mindepth 1 -maxdepth 1 -type d | sort)
fi

if [[ ${#TEAMS[@]} -eq 0 ]]; then
  error "No tenant teams found in ${TENANTS_DIR}"
  error "Create a team first: ./scripts/sre-new-tenant.sh <team-name>"
  exit 1
fi

# ---------- Interactive prompts (skipped in CLI mode) ----------

if [[ "${CLI_MODE}" == "false" ]]; then
  show_banner

  echo -e "${BOLD}  Step 1: Application Details${RESET}\n"

  prompt APP_NAME "Application name (e.g., my-api)"
  prompt_choice TEAM "Which team?" "${TEAMS[@]}"

  TEAM_DIR="${TENANTS_DIR}/${TEAM}"
  APP_FILE="${TEAM_DIR}/apps/${APP_NAME}.yaml"

  if [[ -f "${APP_FILE}" ]]; then
    error "Application '${APP_NAME}' already exists for team '${TEAM}'."
    error "File: ${APP_FILE}"
    exit 1
  fi

  echo ""
  echo -e "${BOLD}  Step 2: Container Image${RESET}\n"

  prompt IMAGE_REPO "Image repository (e.g., docker.io/myorg/myapp)"
  prompt IMAGE_TAG "Image tag (e.g., v1.0.0, 1.27.3-alpine)" "latest"

  if [[ "${IMAGE_TAG}" == "latest" ]]; then
    warn "Using 'latest' tag is discouraged. Pin a specific version for production."
    echo -en "  ${CYAN}Continue anyway?${RESET} ${DIM}[y/N]${RESET}: "
    read -r confirm
    if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
      prompt IMAGE_TAG "Image tag"
    fi
  fi

  prompt APP_PORT "Container port" "8080"

  echo ""
  echo -e "${BOLD}  Step 3: Chart Type${RESET}\n"

  # List available chart templates
  CHART_TYPES=()
  while IFS= read -r d; do
    chart_name="$(basename "$d")"
    if [[ -f "${d}/Chart.yaml" ]]; then
      CHART_TYPES+=("${chart_name}")
    fi
  done < <(find "${TEMPLATES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort)

  prompt_choice CHART_TYPE "Chart template" "${CHART_TYPES[@]}"

  echo ""
  echo -e "${BOLD}  Step 4: Configuration${RESET}\n"

  prompt REPLICAS "Replicas" "1"

  echo -en "  ${CYAN}Enable external ingress?${RESET} ${DIM}[y/N]${RESET}: "
  read -r enable_ingress
  INGRESS_ENABLED="false"
  INGRESS_HOST=""
  if [[ "${enable_ingress}" == "y" || "${enable_ingress}" == "Y" ]]; then
    INGRESS_ENABLED="true"
    prompt INGRESS_HOST "Hostname (e.g., ${APP_NAME}.apps.sre.local)"
  fi

  echo -en "  ${CYAN}Enable autoscaling (HPA)?${RESET} ${DIM}[y/N]${RESET}: "
  read -r enable_hpa
  HPA_ENABLED="false"
  if [[ "${enable_hpa}" == "y" || "${enable_hpa}" == "Y" ]]; then
    HPA_ENABLED="true"
  fi

  echo -en "  ${CYAN}Enable Prometheus metrics?${RESET} ${DIM}[y/N]${RESET}: "
  read -r enable_metrics
  METRICS_ENABLED="false"
  if [[ "${enable_metrics}" == "y" || "${enable_metrics}" == "Y" ]]; then
    METRICS_ENABLED="true"
  fi

  echo ""
  echo -e "${BOLD}  Step 5: Health Probes${RESET}\n"
  prompt LIVENESS_PATH "Liveness probe path" "/"
  prompt READINESS_PATH "Readiness probe path" "/"

  # Summary
  echo ""
  echo -e "${BOLD}  ── Summary ──${RESET}"
  echo ""
  echo -e "  App:       ${BOLD}${APP_NAME}${RESET}"
  echo -e "  Team:      ${TEAM}"
  echo -e "  Image:     ${IMAGE_REPO}:${IMAGE_TAG}"
  echo -e "  Port:      ${APP_PORT}"
  echo -e "  Chart:     ${CHART_TYPE}"
  echo -e "  Replicas:  ${REPLICAS}"
  echo -e "  Ingress:   ${INGRESS_ENABLED}${INGRESS_HOST:+ (${INGRESS_HOST})}"
  echo -e "  HPA:       ${HPA_ENABLED}"
  echo -e "  Metrics:   ${METRICS_ENABLED}"
  echo -e "  Probes:    liveness=${LIVENESS_PATH} readiness=${READINESS_PATH}"
  echo ""
  echo -en "  ${CYAN}Deploy this application?${RESET} ${DIM}[Y/n]${RESET}: "
  read -r confirm
  if [[ "${confirm}" == "n" || "${confirm}" == "N" ]]; then
    info "Aborted."
    exit 0
  fi
fi

# Set computed paths
TEAM_DIR="${TENANTS_DIR}/${TEAM}"
APP_FILE="${TEAM_DIR}/apps/${APP_NAME}.yaml"

# Validate in CLI mode
if [[ "${CLI_MODE}" == "true" && -f "${APP_FILE}" ]]; then
  error "Application '${APP_NAME}' already exists for team '${TEAM}'."
  exit 1
fi

# ---------- Generate HelmRelease ----------

info "Generating HelmRelease manifest..."

mkdir -p "${TEAM_DIR}/apps"

cat > "${APP_FILE}" <<EOF
---
# ${APP_NAME} — deployed via sre-deploy-app.sh
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: ${APP_NAME}
  namespace: ${TEAM}
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: ${TEAM}
spec:
  interval: 10m
  chart:
    spec:
      chart: ./apps/templates/${CHART_TYPE}
      sourceRef:
        kind: GitRepository
        name: flux-system
        namespace: flux-system
  install:
    createNamespace: false
    remediation:
      retries: 3
  upgrade:
    cleanupOnFail: true
    remediation:
      retries: 3
  values:
    app:
      name: "${APP_NAME}"
      team: "${TEAM}"
      image:
        repository: "${IMAGE_REPO}"
        tag: "${IMAGE_TAG}"
        pullPolicy: IfNotPresent
      port: ${APP_PORT}
      replicas: ${REPLICAS}
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 200m
          memory: 256Mi
      probes:
        liveness:
          path: "${LIVENESS_PATH}"
          initialDelaySeconds: 10
          periodSeconds: 10
        readiness:
          path: "${READINESS_PATH}"
          initialDelaySeconds: 5
          periodSeconds: 5
      env: []
    ingress:
      enabled: ${INGRESS_ENABLED}
EOF

# Add ingress host if enabled
if [[ "${INGRESS_ENABLED}" == "true" ]]; then
  cat >> "${APP_FILE}" <<EOF
      host: "${INGRESS_HOST}"
EOF
fi

cat >> "${APP_FILE}" <<EOF
    autoscaling:
      enabled: ${HPA_ENABLED}
    serviceMonitor:
      enabled: ${METRICS_ENABLED}
    networkPolicy:
      enabled: true
    podDisruptionBudget:
      enabled: false
EOF

success "Created ${APP_FILE#"${REPO_ROOT}/"}"

# ---------- Register in kustomization.yaml ----------

TEAM_KUSTOMIZATION="${TEAM_DIR}/kustomization.yaml"

if [[ -f "${TEAM_KUSTOMIZATION}" ]]; then
  APP_ENTRY="apps/${APP_NAME}.yaml"
  if grep -q "${APP_ENTRY}" "${TEAM_KUSTOMIZATION}" 2>/dev/null; then
    info "App already listed in kustomization.yaml"
  else
    # Add the app entry before the last line or at the end of resources
    echo "  - ${APP_ENTRY}" >> "${TEAM_KUSTOMIZATION}"
    success "Added to ${TEAM_KUSTOMIZATION#"${REPO_ROOT}/"}"
  fi
fi

# ---------- Git operations ----------

if [[ "${NO_COMMIT}" == "true" ]]; then
  info "Skipping Git commit (--no-commit). Files generated only."
elif [[ "${CLI_MODE}" == "true" ]]; then
  # Non-interactive: auto-commit
  cd "${REPO_ROOT}"
  git add "${APP_FILE}" "${TEAM_KUSTOMIZATION}"
  git commit -m "feat(apps): deploy ${APP_NAME} to ${TEAM}

Chart: ${CHART_TYPE}
Image: ${IMAGE_REPO}:${IMAGE_TAG}
Ingress: ${INGRESS_ENABLED}"
  success "Committed to Git"
else
  # Interactive: ask
  echo ""
  echo -e "${BOLD}  ── Git ──${RESET}"
  echo ""

  echo -en "  ${CYAN}Commit and push to Git?${RESET} ${DIM}[Y/n]${RESET}: "
  read -r do_git
  if [[ "${do_git}" != "n" && "${do_git}" != "N" ]]; then
    cd "${REPO_ROOT}"
    git add "${APP_FILE}" "${TEAM_KUSTOMIZATION}"
    git commit -m "feat(apps): deploy ${APP_NAME} to ${TEAM}

Chart: ${CHART_TYPE}
Image: ${IMAGE_REPO}:${IMAGE_TAG}
Ingress: ${INGRESS_ENABLED}"
    success "Committed to Git"

    echo -en "  ${CYAN}Push to remote?${RESET} ${DIM}[Y/n]${RESET}: "
    read -r do_push
    if [[ "${do_push}" != "n" && "${do_push}" != "N" ]]; then
      git push
      success "Pushed to remote"
    fi
  fi
fi

# ---------- Done ----------

echo ""
echo -e "${GREEN}${BOLD}Application '${APP_NAME}' deployed!${RESET}"
echo ""
info "What happens next:"
echo -e "  1. Flux detects the new HelmRelease (within ~10 minutes)"
echo -e "  2. The chart template creates: Deployment, Service, NetworkPolicy, ServiceAccount"
if [[ "${INGRESS_ENABLED}" == "true" ]]; then
  echo -e "  3. Istio VirtualService routes traffic from ${BOLD}https://${INGRESS_HOST}${RESET}"
fi
echo ""
info "Check deployment status:"
echo -e "  ${DIM}kubectl get helmrelease ${APP_NAME} -n ${TEAM}${RESET}"
echo -e "  ${DIM}kubectl get pods -n ${TEAM} -l app.kubernetes.io/name=${APP_NAME}${RESET}"
echo ""
info "View logs:"
echo -e "  ${DIM}kubectl logs -n ${TEAM} -l app.kubernetes.io/name=${APP_NAME} -f${RESET}"
echo ""
info "Force immediate deploy:"
echo -e "  ${DIM}flux reconcile kustomization sre-tenants --with-source${RESET}"
echo ""
