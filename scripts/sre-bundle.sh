#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# SRE Platform — Deployment Bundle Creator
#
# PURPOSE:  Create .bundle.tar.gz packages for offline deployment to the SRE
#           Platform. Walks developers through an interactive questionnaire,
#           exports container images, and packages everything for handoff.
#
# USAGE:
#   ./scripts/sre-bundle.sh                         # Interactive mode
#   ./scripts/sre-bundle.sh --from-manifest <file>  # From existing bundle.yaml
#   ./scripts/sre-bundle.sh --validate <bundle.tar.gz>
#   ./scripts/sre-bundle.sh --help
#
# OUTPUT:   <name>-v<version>.bundle.tar.gz in current directory (or --output-dir)
#
# REQUIRES: bash, tar, docker or podman
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source colors if available, otherwise define stubs
if [[ -f "${SCRIPT_DIR}/lib/colors.sh" ]]; then
  source "${SCRIPT_DIR}/lib/colors.sh"
else
  log()   { echo "[INFO] $*"; }
  warn()  { echo "[WARN] $*"; }
  error() { echo "[ERROR] $*" >&2; }
  info()  { echo "[INFO] $*"; }
  CYAN=''; GREEN=''; RED=''; YELLOW=''; BOLD=''; NC=''; DIM=''
fi
die() { error "$@"; exit 1; }

# ── Container runtime detection ──────────────────────────────────────────────
CONTAINER_RT=""
detect_runtime() {
  if command -v docker >/dev/null 2>&1; then
    CONTAINER_RT="docker"
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_RT="podman"
  else
    die "Neither docker nor podman found. Install one to export container images."
  fi
}

# ── Helpers ──────────────────────────────────────────────────────────────────
prompt() {
  local var="$1" msg="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    printf "${CYAN}%s${NC} [${DIM}%s${NC}]: " "$msg" "$default"
  else
    printf "${CYAN}%s${NC}: " "$msg"
  fi
  read -r input
  eval "$var=\"\${input:-$default}\""
}

prompt_yn() {
  local msg="$1" default="${2:-n}"
  local hint="y/N"; [[ "$default" == "y" ]] && hint="Y/n"
  printf "${CYAN}%s${NC} [%s]: " "$msg" "$hint"
  read -r yn
  yn="${yn:-$default}"
  [[ "$yn" =~ ^[Yy] ]]
}

menu() {
  local var="$1" msg="$2"; shift 2
  local options=("$@") i=1
  echo -e "${CYAN}${msg}${NC}"
  for opt in "${options[@]}"; do
    echo "  ${i}) ${opt}"
    i=$((i + 1))
  done
  printf "  Choice: "
  read -r choice
  choice="${choice:-1}"
  if [[ "$choice" -ge 1 && "$choice" -le "${#options[@]}" ]] 2>/dev/null; then
    eval "$var=\"\${options[$((choice - 1))]}\""
  else
    eval "$var=\"\${options[0]}\""
  fi
}

sanitize_name() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'; }

validate_kebab() { [[ "$1" =~ ^[a-z][a-z0-9-]*$ ]]; }

save_image() {
  local image_ref="$1" dest_path="$2"
  info "Saving image: ${image_ref} → ${dest_path}"
  if ! $CONTAINER_RT save -o "$dest_path" "$image_ref" 2>/dev/null; then
    # Maybe need to pull first
    info "Image not found locally, pulling..."
    $CONTAINER_RT pull "$image_ref" || die "Failed to pull image: ${image_ref}"
    $CONTAINER_RT save -o "$dest_path" "$image_ref" || die "Failed to save image: ${image_ref}"
  fi
  local size; size=$(du -h "$dest_path" | cut -f1)
  log "Saved: $(basename "$dest_path") (${size})"
}

# ── Output directory ─────────────────────────────────────────────────────────
OUTPUT_DIR="."

# ── Parse arguments ──────────────────────────────────────────────────────────
MODE="interactive"
MANIFEST_FILE=""
VALIDATE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-manifest) MODE="manifest"; MANIFEST_FILE="${2:-}"; shift 2 ;;
    --validate)      MODE="validate"; VALIDATE_FILE="${2:-}"; shift 2 ;;
    --output-dir)    OUTPUT_DIR="${2:-$OUTPUT_DIR}"; shift 2 ;;
    --help|-h)       MODE="help"; shift ;;
    *) die "Unknown argument: $1. Use --help for usage." ;;
  esac
done

# ── Help ─────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "help" ]]; then
  cat <<'HELPEOF'
SRE Platform — Deployment Bundle Creator

Usage:
  sre-bundle.sh                           Interactive mode (recommended)
  sre-bundle.sh --from-manifest <file>    Build bundle from existing bundle.yaml
  sre-bundle.sh --validate <bundle.tar.gz> Validate a bundle archive
  sre-bundle.sh --help                    Show this help

Options:
  --output-dir <path>   Directory for the output .tar.gz (default: current dir)

Interactive mode walks you through:
  1. App name, version, team, author
  2. App type, container image, port, resources
  3. Additional containers (worker, migration, etc.)
  4. Platform services (database, redis, SSO, storage)
  5. Environment variables
  6. External API access
  7. Source code inclusion for SAST scanning
  8. Security classification
  9. Review and generate

Requirements:
  - bash, tar
  - docker or podman (for saving container images)

Output:
  <name>-v<version>.bundle.tar.gz ready for upload to the SRE Platform
HELPEOF
  exit 0
fi

# ── Validate mode ────────────────────────────────────────────────────────────
if [[ "$MODE" == "validate" ]]; then
  [[ -n "$VALIDATE_FILE" ]] || die "Usage: sre-bundle.sh --validate <bundle.tar.gz>"
  [[ -f "$VALIDATE_FILE" ]] || die "File not found: $VALIDATE_FILE"
  TMPDIR_VAL=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_VAL"' EXIT
  info "Extracting bundle..."
  tar xzf "$VALIDATE_FILE" -C "$TMPDIR_VAL" 2>/dev/null || die "Not a valid .tar.gz archive"
  # Find bundle.yaml
  MANIFEST=""
  if [[ -f "$TMPDIR_VAL/bundle.yaml" ]]; then MANIFEST="$TMPDIR_VAL/bundle.yaml"
  else
    for d in "$TMPDIR_VAL"/*/; do
      [[ -f "${d}bundle.yaml" ]] && MANIFEST="${d}bundle.yaml" && break
    done
  fi
  [[ -n "$MANIFEST" ]] || die "bundle.yaml not found in archive"
  BASE=$(dirname "$MANIFEST")
  # Parse name and version (portable grep, no yq)
  NAME=$(grep '^\s*name:' "$MANIFEST" | head -1 | sed 's/.*name:\s*//' | tr -d '"' | tr -d "'" | xargs)
  VERSION=$(grep '^\s*version:' "$MANIFEST" | head -1 | sed 's/.*version:\s*//' | tr -d '"' | tr -d "'" | xargs)
  TEAM=$(grep '^\s*team:' "$MANIFEST" | head -1 | sed 's/.*team:\s*//' | tr -d '"' | tr -d "'" | xargs)
  echo ""
  log "Bundle validation: ${GREEN}PASSED${NC}"
  echo "  Name:    ${NAME:-unknown}"
  echo "  Version: ${VERSION:-unknown}"
  echo "  Team:    ${TEAM:-unknown}"
  # Count images
  IMG_COUNT=$(find "$BASE/images" -name "*.tar" 2>/dev/null | wc -l | tr -d ' ')
  echo "  Images:  ${IMG_COUNT}"
  HAS_SOURCE="no"; [[ -d "$BASE/source" ]] && HAS_SOURCE="yes"
  echo "  Source:  ${HAS_SOURCE}"
  HAS_ARTIFACTS="no"; [[ -d "$BASE/artifacts" ]] && HAS_ARTIFACTS="yes"
  echo "  Artifacts: ${HAS_ARTIFACTS}"
  SIZE=$(du -h "$VALIDATE_FILE" | cut -f1)
  echo "  Size:    ${SIZE}"
  echo ""
  exit 0
fi

# ── From-manifest mode ───────────────────────────────────────────────────────
if [[ "$MODE" == "manifest" ]]; then
  [[ -n "$MANIFEST_FILE" ]] || die "Usage: sre-bundle.sh --from-manifest <bundle.yaml>"
  [[ -f "$MANIFEST_FILE" ]] || die "File not found: $MANIFEST_FILE"
  detect_runtime
  MANIFEST_DIR="$(cd "$(dirname "$MANIFEST_FILE")" && pwd)"
  # Parse key fields
  NAME=$(grep '^\s*name:' "$MANIFEST_FILE" | head -1 | sed 's/.*name:\s*//' | tr -d '"' | tr -d "'" | xargs)
  VERSION=$(grep '^\s*version:' "$MANIFEST_FILE" | head -1 | sed 's/.*version:\s*//' | tr -d '"' | tr -d "'" | xargs)
  [[ -n "$NAME" ]] || die "metadata.name is required in manifest"
  [[ -n "$VERSION" ]] || die "metadata.version is required in manifest"
  VERSION="${VERSION#v}"
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  mkdir -p "$BUILD_DIR/images"
  cp "$MANIFEST_FILE" "$BUILD_DIR/bundle.yaml"
  # Process image references from manifest
  IMAGE_REFS=$(grep 'image:' "$MANIFEST_FILE" | sed 's/.*image:\s*//' | tr -d '"' | tr -d "'" | xargs -I{} echo {})
  while IFS= read -r img; do
    [[ -z "$img" ]] && continue
    if [[ "$img" == images/* ]]; then
      src="$MANIFEST_DIR/$img"
      [[ -f "$src" ]] || die "Image file not found: $src"
      cp "$src" "$BUILD_DIR/images/"
    elif [[ "$img" == */* ]]; then
      tarname="$(sanitize_name "$(basename "${img%%:*}")").tar"
      save_image "$img" "$BUILD_DIR/images/$tarname"
    fi
  done <<< "$IMAGE_REFS"
  # Copy optional directories
  [[ -d "$MANIFEST_DIR/source" ]] && cp -r "$MANIFEST_DIR/source" "$BUILD_DIR/"
  [[ -d "$MANIFEST_DIR/artifacts" ]] && cp -r "$MANIFEST_DIR/artifacts" "$BUILD_DIR/"
  [[ -d "$MANIFEST_DIR/helm" ]] && cp -r "$MANIFEST_DIR/helm" "$BUILD_DIR/"
  # Package
  BUNDLE_FILE="${OUTPUT_DIR}/${NAME}-v${VERSION}.bundle.tar.gz"
  tar czf "$BUNDLE_FILE" -C "$BUILD_DIR" .
  SIZE=$(du -h "$BUNDLE_FILE" | cut -f1)
  echo ""
  log "Bundle created: ${BUNDLE_FILE} (${SIZE})"
  info "Upload via DSOP wizard or give to your SRE platform operator."
  exit 0
fi

# ── Interactive mode ─────────────────────────────────────────────────────────
detect_runtime

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    SRE Platform — Deployment Bundle Creator  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: App basics
echo -e "${BOLD}── Step 1: App Information ──${NC}"
echo ""
while true; do
  prompt APP_NAME "App name (kebab-case)" ""
  validate_kebab "$APP_NAME" && break
  warn "Must be lowercase letters, numbers, and hyphens (e.g., order-service)"
done

while true; do
  prompt APP_VERSION "Version" "1.0.0"
  [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  warn "Use semver format: MAJOR.MINOR.PATCH (e.g., 1.0.0)"
done

while true; do
  prompt TEAM "Team name" "team-alpha"
  [[ "$TEAM" == team-* ]] || TEAM="team-${TEAM}"
  [[ "$TEAM" =~ ^team-[a-z][a-z0-9-]*$ ]] && break
  warn "Must be team-<lowercase-name>"
done

prompt AUTHOR "Author name (optional)" ""
prompt AUTHOR_EMAIL "Author email (optional)" ""
prompt DESCRIPTION "One-line description (optional)" ""

AUTHOR_FULL=""
if [[ -n "$AUTHOR" && -n "$AUTHOR_EMAIL" ]]; then AUTHOR_FULL="${AUTHOR} <${AUTHOR_EMAIL}>"
elif [[ -n "$AUTHOR" ]]; then AUTHOR_FULL="$AUTHOR"; fi

# Step 2: App type and image
echo ""
echo -e "${BOLD}── Step 2: App Type & Container Image ──${NC}"
echo ""
APP_TYPES=("web-app" "api-service" "worker" "cronjob")
menu APP_TYPE "App type:" "${APP_TYPES[@]}"

echo ""
echo -e "${CYAN}Container image source:${NC}"
echo "  1) Image is built locally (docker images)"
echo "  2) Image is in a registry (will pull)"
printf "  Choice [1]: "
read -r img_source; img_source="${img_source:-1}"

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/images"

PRIMARY_TAR="${APP_NAME}.tar"
if [[ "$img_source" == "2" ]]; then
  prompt IMAGE_REF "Full image reference (e.g., docker.io/vendor/app:v2.0)" ""
  [[ -n "$IMAGE_REF" ]] || die "Image reference is required"
  save_image "$IMAGE_REF" "$BUILD_DIR/images/${PRIMARY_TAR}"
else
  prompt IMAGE_REF "Local image name:tag (e.g., myapp:v1.0.0)" "${APP_NAME}:v${APP_VERSION}"
  save_image "$IMAGE_REF" "$BUILD_DIR/images/${PRIMARY_TAR}"
fi

PORT=8080
if [[ "$APP_TYPE" == "web-app" || "$APP_TYPE" == "api-service" ]]; then
  prompt PORT "Port" "8080"
fi

RESOURCES_OPTS=("small" "medium" "large")
menu RESOURCES "Resource size:" "${RESOURCES_OPTS[@]}"

INGRESS=""
if [[ "$APP_TYPE" == "web-app" ]]; then
  prompt INGRESS "Ingress hostname" "${APP_NAME}.apps.sre.example.com"
fi

LIVENESS="/healthz"; READINESS="/readyz"
if [[ "$APP_TYPE" == "web-app" || "$APP_TYPE" == "api-service" ]]; then
  prompt LIVENESS "Liveness probe path" "/healthz"
  prompt READINESS "Readiness probe path" "/readyz"
fi

SCHEDULE=""
if [[ "$APP_TYPE" == "cronjob" ]]; then
  prompt SCHEDULE "Cron schedule (e.g., 0 3 * * *)" ""
fi

# Step 3: Additional containers
echo ""
echo -e "${BOLD}── Step 3: Additional Containers ──${NC}"
echo ""
COMPONENTS_YAML=""
COMP_COUNT=0
if prompt_yn "Does your app have additional containers? (worker, migration, etc.)"; then
  while true; do
    COMP_COUNT=$((COMP_COUNT + 1))
    prompt COMP_NAME "Component name" ""
    [[ -n "$COMP_NAME" ]] || break
    COMP_NAME="$(sanitize_name "$COMP_NAME")"
    menu COMP_TYPE "Component type:" "worker" "cronjob" "api-service"
    echo -e "${CYAN}Component image source:${NC}"
    echo "  1) Local   2) Registry"
    printf "  Choice [1]: "
    read -r comp_src; comp_src="${comp_src:-1}"
    COMP_TAR="${COMP_NAME}.tar"
    if [[ "$comp_src" == "2" ]]; then
      prompt COMP_IMG "Image reference" ""
      save_image "$COMP_IMG" "$BUILD_DIR/images/${COMP_TAR}"
    else
      prompt COMP_IMG "Local image name:tag" "${COMP_NAME}:v${APP_VERSION}"
      save_image "$COMP_IMG" "$BUILD_DIR/images/${COMP_TAR}"
    fi
    menu COMP_RES "Resource size:" "small" "medium" "large"
    COMP_SCHEDULE=""
    if [[ "$COMP_TYPE" == "cronjob" ]]; then
      prompt COMP_SCHEDULE "Cron schedule" ""
    fi
    COMPONENTS_YAML="${COMPONENTS_YAML}
    - name: ${COMP_NAME}
      type: ${COMP_TYPE}
      image: images/${COMP_TAR}
      resources: ${COMP_RES}"
    [[ -n "$COMP_SCHEDULE" ]] && COMPONENTS_YAML="${COMPONENTS_YAML}
      schedule: \"${COMP_SCHEDULE}\""
    prompt_yn "Add another component?" || break
  done
fi

# Step 4: Platform services
echo ""
echo -e "${BOLD}── Step 4: Platform Services ──${NC}"
echo ""
DB_ENABLED="false"; DB_SIZE="small"
if prompt_yn "Need a PostgreSQL database?"; then
  DB_ENABLED="true"
  menu DB_SIZE "Database size:" "small" "medium" "large"
fi
REDIS_ENABLED="false"; REDIS_SIZE="small"
if prompt_yn "Need Redis cache?"; then
  REDIS_ENABLED="true"
  menu REDIS_SIZE "Redis size:" "small" "medium" "large"
fi
SSO_ENABLED="false"
prompt_yn "Need SSO/authentication?" && SSO_ENABLED="true"
STORAGE_ENABLED="false"
prompt_yn "Need S3-compatible object storage?" && STORAGE_ENABLED="true"

# Step 5: Environment variables
echo ""
echo -e "${BOLD}── Step 5: Environment Variables ──${NC}"
echo ""
ENV_YAML=""
if prompt_yn "Configure environment variables?"; then
  while true; do
    prompt ENV_NAME "Variable name (e.g., LOG_LEVEL)" ""
    [[ -n "$ENV_NAME" ]] || break
    prompt ENV_VAL "Value (or 'secret:<name>' for sensitive)" ""
    if [[ "$ENV_VAL" == secret:* ]]; then
      SECRET_NAME="${ENV_VAL#secret:}"
      ENV_YAML="${ENV_YAML}
    - name: ${ENV_NAME}
      secret: ${SECRET_NAME}"
    else
      ENV_YAML="${ENV_YAML}
    - name: ${ENV_NAME}
      value: \"${ENV_VAL}\""
    fi
    prompt_yn "Add another variable?" || break
  done
fi

# Step 6: External APIs
echo ""
echo -e "${BOLD}── Step 6: External API Access ──${NC}"
echo ""
EXT_APIS_YAML=""
if prompt_yn "Does your app call external APIs?"; then
  while true; do
    prompt API_HOST "API hostname (e.g., api.stripe.com)" ""
    [[ -n "$API_HOST" ]] || break
    EXT_APIS_YAML="${EXT_APIS_YAML}
    - ${API_HOST}"
    prompt_yn "Add another API?" || break
  done
fi

# Step 7: Source code
echo ""
echo -e "${BOLD}── Step 7: Source Code ──${NC}"
echo ""
SOURCE_INCLUDED="false"; SOURCE_LANG="other"
if prompt_yn "Include source code for security scanning?"; then
  SOURCE_INCLUDED="true"
  prompt SOURCE_DIR "Source directory path" "."
  [[ -d "$SOURCE_DIR" ]] || die "Directory not found: $SOURCE_DIR"
  mkdir -p "$BUILD_DIR/source"
  info "Copying source code..."
  # Use tar to copy, excluding common large directories
  tar cf - -C "$SOURCE_DIR" \
    --exclude='node_modules' --exclude='.git' --exclude='vendor' \
    --exclude='__pycache__' --exclude='.venv' --exclude='target' \
    --exclude='bin' --exclude='obj' --exclude='dist' --exclude='build' \
    . 2>/dev/null | tar xf - -C "$BUILD_DIR/source" 2>/dev/null || true
  LANGS=("nodejs" "python" "go" "java" "dotnet" "other")
  menu SOURCE_LANG "Primary language:" "${LANGS[@]}"
fi

# Step 8: Classification
echo ""
echo -e "${BOLD}── Step 8: Security Classification ──${NC}"
echo ""
CLASS_OPTS=("UNCLASSIFIED" "CUI" "CONFIDENTIAL" "SECRET")
menu CLASSIFICATION "Security classification:" "${CLASS_OPTS[@]}"

# Step 9: Review and generate
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║              Bundle Summary                  ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════╣${NC}"
printf "  %-16s %s\n" "Name:" "$APP_NAME"
printf "  %-16s %s\n" "Version:" "$APP_VERSION"
printf "  %-16s %s\n" "Team:" "$TEAM"
[[ -n "$AUTHOR_FULL" ]] && printf "  %-16s %s\n" "Author:" "$AUTHOR_FULL"
[[ -n "$DESCRIPTION" ]] && printf "  %-16s %s\n" "Description:" "$DESCRIPTION"
printf "  %-16s %s\n" "Type:" "$APP_TYPE"
printf "  %-16s %s\n" "Resources:" "$RESOURCES"
[[ "$APP_TYPE" != "worker" && "$APP_TYPE" != "cronjob" ]] && printf "  %-16s %s\n" "Port:" "$PORT"
[[ -n "$INGRESS" ]] && printf "  %-16s %s\n" "Ingress:" "$INGRESS"
[[ -n "$SCHEDULE" ]] && printf "  %-16s %s\n" "Schedule:" "$SCHEDULE"
IMG_COUNT=$(find "$BUILD_DIR/images" -name "*.tar" 2>/dev/null | wc -l | tr -d ' ')
printf "  %-16s %s\n" "Images:" "${IMG_COUNT}"
[[ "$COMP_COUNT" -gt 0 ]] && printf "  %-16s %s\n" "Components:" "$COMP_COUNT"
SVCS=""
[[ "$DB_ENABLED" == "true" ]] && SVCS="${SVCS}PostgreSQL(${DB_SIZE}) "
[[ "$REDIS_ENABLED" == "true" ]] && SVCS="${SVCS}Redis(${REDIS_SIZE}) "
[[ "$SSO_ENABLED" == "true" ]] && SVCS="${SVCS}SSO "
[[ "$STORAGE_ENABLED" == "true" ]] && SVCS="${SVCS}Storage "
[[ -n "$SVCS" ]] && printf "  %-16s %s\n" "Services:" "$SVCS"
printf "  %-16s %s\n" "Source:" "$SOURCE_INCLUDED"
printf "  %-16s %s\n" "Classification:" "$CLASSIFICATION"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

prompt_yn "Generate bundle?" "y" || { info "Cancelled."; exit 0; }

# Generate bundle.yaml
CREATED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$BUILD_DIR/bundle.yaml" <<MANIFEST
apiVersion: sre.io/v1alpha1
kind: DeploymentBundle
metadata:
  name: ${APP_NAME}
  version: "${APP_VERSION}"
  team: ${TEAM}
  created: "${CREATED}"
MANIFEST
[[ -n "$AUTHOR_FULL" ]] && echo "  author: \"${AUTHOR_FULL}\"" >> "$BUILD_DIR/bundle.yaml"
[[ -n "$DESCRIPTION" ]] && echo "  description: \"${DESCRIPTION}\"" >> "$BUILD_DIR/bundle.yaml"

cat >> "$BUILD_DIR/bundle.yaml" <<MANIFEST

spec:
  app:
    type: ${APP_TYPE}
    image: images/${PRIMARY_TAR}
    port: ${PORT}
    resources: ${RESOURCES}
MANIFEST
[[ -n "$INGRESS" ]] && echo "    ingress: ${INGRESS}" >> "$BUILD_DIR/bundle.yaml"
cat >> "$BUILD_DIR/bundle.yaml" <<MANIFEST
    probes:
      liveness: ${LIVENESS}
      readiness: ${READINESS}
MANIFEST
[[ -n "$SCHEDULE" ]] && echo "    schedule: \"${SCHEDULE}\"" >> "$BUILD_DIR/bundle.yaml"

if [[ -n "$COMPONENTS_YAML" ]]; then
  echo "" >> "$BUILD_DIR/bundle.yaml"
  echo "  components:${COMPONENTS_YAML}" >> "$BUILD_DIR/bundle.yaml"
fi

cat >> "$BUILD_DIR/bundle.yaml" <<MANIFEST

  services:
    database:
      enabled: ${DB_ENABLED}
      size: ${DB_SIZE}
    redis:
      enabled: ${REDIS_ENABLED}
      size: ${REDIS_SIZE}
    sso:
      enabled: ${SSO_ENABLED}
    storage:
      enabled: ${STORAGE_ENABLED}
MANIFEST

if [[ -n "$ENV_YAML" ]]; then
  echo "" >> "$BUILD_DIR/bundle.yaml"
  echo "  env:${ENV_YAML}" >> "$BUILD_DIR/bundle.yaml"
fi

if [[ -n "$EXT_APIS_YAML" ]]; then
  echo "" >> "$BUILD_DIR/bundle.yaml"
  echo "  externalApis:${EXT_APIS_YAML}" >> "$BUILD_DIR/bundle.yaml"
fi

cat >> "$BUILD_DIR/bundle.yaml" <<MANIFEST

  source:
    included: ${SOURCE_INCLUDED}
    language: ${SOURCE_LANG}

  classification: ${CLASSIFICATION}
MANIFEST

# Generate README
cat > "$BUILD_DIR/README.md" <<README
# ${APP_NAME} v${APP_VERSION}

${DESCRIPTION:-Deployment bundle for the SRE Platform.}

**Team:** ${TEAM}
**Created:** ${CREATED}
$([ -n "$AUTHOR_FULL" ] && echo "**Author:** ${AUTHOR_FULL}")

## How to Deploy

Upload this bundle to the SRE Platform through one of:
- **DSOP Wizard**: Select "Upload Bundle" in Step 1
- **SRE Portal**: Quick Deploy → Upload Bundle tab
- **CLI**: \`task deploy-app\` with the extracted manifest

## Contents

- \`bundle.yaml\` — Deployment manifest
- \`images/\` — ${IMG_COUNT} container image(s)
$([ "$SOURCE_INCLUDED" = "true" ] && echo "- \`source/\` — Source code for SAST scanning")
- \`README.md\` — This file
README

# Package
BUNDLE_FILE="${OUTPUT_DIR}/${APP_NAME}-v${APP_VERSION}.bundle.tar.gz"
info "Packaging bundle..."
tar czf "$BUNDLE_FILE" -C "$BUILD_DIR" .
SIZE=$(du -h "$BUNDLE_FILE" | cut -f1)

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           ${GREEN}Bundle Created Successfully${NC}${BOLD}        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  File: ${BUNDLE_FILE}"
echo "  Size: ${SIZE}"
echo ""
info "Next steps:"
echo "  1. Transfer this file to your SRE platform operator"
echo "  2. They will upload it through the DSOP wizard"
echo "  3. The platform runs security scans and ISSM review"
echo "  4. After approval, your app deploys automatically"
echo ""
