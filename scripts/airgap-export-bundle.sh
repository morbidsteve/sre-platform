#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# airgap-export-bundle.sh — Export all SRE platform images to a portable bundle
# =============================================================================
#
# PURPOSE:
#   Creates a self-contained tar.gz bundle of all SRE platform container images
#   that can be transferred to an air-gapped environment via USB, DVD, or
#   one-way file transfer. Includes an import script and image manifest.
#
# PREREQUISITES:
#   - docker or podman CLI available
#   - Sufficient disk space (~15-25 GB in /tmp for the bundle)
#   - OR: skopeo installed (preferred for registry-to-directory copies)
#   - Run airgap-mirror-images.sh first to pull all images, OR ensure
#     all images are available locally
#
# USAGE:
#   # 1. Pull all images first (if not already done)
#   SKIP_PUSH=true ./scripts/airgap-mirror-images.sh
#
#   # 2. Export to bundle
#   ./scripts/airgap-export-bundle.sh
#
#   # 3. Transfer bundle to air-gapped environment
#   scp /tmp/sre-platform-airgap-bundle.tar.gz airgap-host:/transfer/
#
#   # 4. On the air-gapped host, extract and run the import script
#   tar xzf sre-platform-airgap-bundle.tar.gz
#   cd sre-platform-airgap-bundle/
#   ./import-images.sh --registry harbor.airgap.local
#
# ENVIRONMENT VARIABLES:
#   OUTPUT_DIR       — Directory for the bundle (default: /tmp)
#   BUNDLE_NAME      — Bundle name (default: sre-platform-airgap-bundle)
#   CONTAINER_TOOL   — Container CLI (default: auto-detect docker/podman)
#   USE_SKOPEO       — Use skopeo dir transport (default: false)
#   DRY_RUN          — Print actions without executing (default: false)
#
# OUTPUT:
#   /tmp/sre-platform-airgap-bundle.tar.gz containing:
#     - images/         — Individual image tar files (or skopeo dirs)
#     - manifest.json   — Machine-readable manifest of all images
#     - import-images.sh — Script to load images into an air-gapped registry
#     - README.txt      — Quick-start instructions
#
# =============================================================================

OUTPUT_DIR="${OUTPUT_DIR:-/tmp}"
BUNDLE_NAME="${BUNDLE_NAME:-sre-platform-airgap-bundle}"
CONTAINER_TOOL="${CONTAINER_TOOL:-}"
USE_SKOPEO="${USE_SKOPEO:-false}"
DRY_RUN="${DRY_RUN:-false}"

BUNDLE_DIR="${OUTPUT_DIR}/${BUNDLE_NAME}"
BUNDLE_TAR="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
IMAGES_DIR="${BUNDLE_DIR}/images"
MANIFEST_FILE="${BUNDLE_DIR}/manifest.json"

# =============================================================================
# Same image list as airgap-mirror-images.sh — keep in sync
# =============================================================================

declare -a PLATFORM_IMAGES=(
  # Istio 1.25.2
  "docker.io/istio/pilot:1.25.2"
  "docker.io/istio/proxyv2:1.25.2"

  # cert-manager 1.14.4
  "quay.io/jetstack/cert-manager-controller:v1.14.4"
  "quay.io/jetstack/cert-manager-webhook:v1.14.4"
  "quay.io/jetstack/cert-manager-cainjector:v1.14.4"
  "quay.io/jetstack/cert-manager-startupapicheck:v1.14.4"

  # Kyverno 3.3.7
  "ghcr.io/kyverno/kyverno:v1.13.4"
  "ghcr.io/kyverno/kyvernopre:v1.13.4"
  "ghcr.io/kyverno/background-controller:v1.13.4"
  "ghcr.io/kyverno/cleanup-controller:v1.13.4"
  "ghcr.io/kyverno/reports-controller:v1.13.4"

  # Monitoring — kube-prometheus-stack 72.6.2
  "quay.io/prometheus/prometheus:v2.54.1"
  "quay.io/prometheus/alertmanager:v0.27.0"
  "quay.io/prometheus-operator/prometheus-operator:v0.77.1"
  "quay.io/prometheus-operator/prometheus-config-reloader:v0.77.1"
  "docker.io/grafana/grafana:11.3.0"
  "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0"
  "quay.io/prometheus/node-exporter:v1.8.2"
  "docker.io/jimmidyson/configmap-reload:v0.13.1"
  "quay.io/kiwigrid/k8s-sidecar:1.27.6"

  # Logging — Loki 6.29.0 + Alloy 0.12.2
  "docker.io/grafana/loki:3.3.2"
  "docker.io/grafana/alloy:v1.5.1"

  # Tempo 1.18.2
  "docker.io/grafana/tempo:2.6.1"

  # OpenBao 0.9.0
  "quay.io/openbao/openbao:2.1.0"

  # External Secrets Operator 0.9.13
  "ghcr.io/external-secrets/external-secrets:v0.9.13"

  # Harbor 1.16.3
  "docker.io/goharbor/harbor-core:v2.11.2"
  "docker.io/goharbor/harbor-portal:v2.11.2"
  "docker.io/goharbor/harbor-jobservice:v2.11.2"
  "docker.io/goharbor/harbor-registryctl:v2.11.2"
  "docker.io/goharbor/registry-photon:v2.11.2"
  "docker.io/goharbor/harbor-db:v2.11.2"
  "docker.io/goharbor/redis-photon:v2.11.2"
  "docker.io/goharbor/trivy-adapter-photon:v2.11.2"

  # NeuVector 2.8.6
  "docker.io/neuvector/controller:5.4.0"
  "docker.io/neuvector/enforcer:5.4.0"
  "docker.io/neuvector/manager:5.4.0"
  "docker.io/neuvector/scanner:latest"
  "docker.io/neuvector/updater:latest"

  # Keycloak 24.8.1 (Bitnami chart)
  "docker.io/bitnamilegacy/keycloak:26.3.2-debian-12-r0"
  "docker.io/bitnamilegacy/postgresql:17.4.0-debian-12-r17"

  # Velero 11.3.2
  "docker.io/velero/velero:v1.14.1"
  "docker.io/velero/velero-plugin-for-aws:v1.9.1"
  "docker.io/bitnamilegacy/kubectl:1.33.4-debian-12-r0"

  # MetalLB 0.14.9
  "quay.io/metallb/controller:v0.14.9"
  "quay.io/metallb/speaker:v0.14.9"

  # Flux CD 2.8.1
  "ghcr.io/fluxcd/source-controller:v1.5.0"
  "ghcr.io/fluxcd/kustomize-controller:v1.5.0"
  "ghcr.io/fluxcd/helm-controller:v1.2.0"
  "ghcr.io/fluxcd/notification-controller:v1.5.0"
)

# =============================================================================
# Helper Functions
# =============================================================================

detect_container_tool() {
  if [[ -n "${CONTAINER_TOOL}" ]]; then
    echo "${CONTAINER_TOOL}"
    return
  fi
  if command -v docker &>/dev/null; then
    echo "docker"
  elif command -v podman &>/dev/null; then
    echo "podman"
  else
    echo "ERROR: Neither docker nor podman found in PATH." >&2
    exit 1
  fi
}

# Convert image reference to a safe filename
image_to_filename() {
  local img="$1"
  # Remove registry prefix and replace special chars
  echo "${img}" | sed 's|[/:]|_|g'
}

log_info() {
  echo "[INFO]  $*"
}

log_error() {
  echo "[ERROR] $*" >&2
}

# =============================================================================
# Generate manifest.json
# =============================================================================

generate_manifest() {
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cat > "${MANIFEST_FILE}" << HEADER
{
  "schemaVersion": 1,
  "generator": "sre-platform/scripts/airgap-export-bundle.sh",
  "generatedAt": "${timestamp}",
  "platform": "SRE Platform",
  "totalImages": ${#PLATFORM_IMAGES[@]},
  "images": [
HEADER

  local first=true
  for img in "${PLATFORM_IMAGES[@]}"; do
    local tag="${img##*:}"
    local repo="${img%:*}"
    local filename
    filename="$(image_to_filename "${img}").tar"

    if [[ "${first}" == "true" ]]; then
      first=false
    else
      echo "," >> "${MANIFEST_FILE}"
    fi

    printf '    {"source": "%s", "repository": "%s", "tag": "%s", "file": "images/%s"}' \
      "${img}" "${repo}" "${tag}" "${filename}" >> "${MANIFEST_FILE}"
  done

  cat >> "${MANIFEST_FILE}" << 'FOOTER'

  ]
}
FOOTER
}

# =============================================================================
# Generate import-images.sh
# =============================================================================

generate_import_script() {
  cat > "${BUNDLE_DIR}/import-images.sh" << 'IMPORTSCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# import-images.sh — Load SRE platform images into an air-gapped registry
# =============================================================================
#
# USAGE:
#   ./import-images.sh --registry harbor.airgap.local [--project platform]
#
# This script:
#   1. Loads each image tar into the local container runtime
#   2. Retags it for the target registry
#   3. Pushes it to the target registry
#
# PREREQUISITES:
#   - docker or podman CLI available
#   - Authenticated to the target registry (docker login <registry>)
#   - Target project/repository exists in the registry
# =============================================================================

REGISTRY=""
PROJECT="platform"
CONTAINER_TOOL=""
DRY_RUN="false"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="${SCRIPT_DIR}/images"

usage() {
  echo "Usage: $0 --registry <registry-hostname> [--project <project>] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  --registry    Target registry hostname (required)"
  echo "                Example: harbor.airgap.local"
  echo "  --project     Target project/namespace in registry (default: platform)"
  echo "  --tool        Container CLI to use: docker or podman (default: auto-detect)"
  echo "  --dry-run     Print actions without executing"
  echo "  --help        Show this help message"
  exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --project)  PROJECT="$2"; shift 2 ;;
    --tool)     CONTAINER_TOOL="$2"; shift 2 ;;
    --dry-run)  DRY_RUN="true"; shift ;;
    --help|-h)  usage ;;
    *)          echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "${REGISTRY}" ]]; then
  echo "ERROR: --registry is required"
  usage
fi

# Auto-detect container tool
if [[ -z "${CONTAINER_TOOL}" ]]; then
  if command -v docker &>/dev/null; then
    CONTAINER_TOOL="docker"
  elif command -v podman &>/dev/null; then
    CONTAINER_TOOL="podman"
  else
    echo "ERROR: Neither docker nor podman found." >&2
    exit 1
  fi
fi

echo "============================================"
echo "SRE Platform Air-Gap Image Import"
echo "============================================"
echo "Registry:       ${REGISTRY}"
echo "Project:        ${PROJECT}"
echo "Container tool: ${CONTAINER_TOOL}"
echo "Images dir:     ${IMAGES_DIR}"
echo ""

if [[ ! -d "${IMAGES_DIR}" ]]; then
  echo "ERROR: Images directory not found: ${IMAGES_DIR}" >&2
  exit 1
fi

# Read manifest
if [[ ! -f "${SCRIPT_DIR}/manifest.json" ]]; then
  echo "ERROR: manifest.json not found" >&2
  exit 1
fi

success=0
failed=0

# Convert upstream image ref to harbor target ref
to_target_ref() {
  local src="$1"
  local tag="${src##*:}"
  local image_path="${src%:*}"

  # Remove registry prefix
  image_path="${image_path#docker.io/}"
  image_path="${image_path#quay.io/}"
  image_path="${image_path#ghcr.io/}"
  image_path="${image_path#registry.k8s.io/}"

  # Flatten path
  local name="${image_path//\//-}"

  echo "${REGISTRY}/${PROJECT}/${name}:${tag}"
}

# Process each tar file
for tarfile in "${IMAGES_DIR}"/*.tar; do
  if [[ ! -f "${tarfile}" ]]; then
    continue
  fi

  filename="$(basename "${tarfile}")"
  echo "[INFO] Loading: ${filename}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY RUN] Would load, tag, and push: ${filename}"
    ((success++))
    continue
  fi

  # Load the image
  load_output=$("${CONTAINER_TOOL}" load -i "${tarfile}" 2>&1)
  echo "  ${load_output}"

  # Extract the loaded image name from the output
  # docker load outputs: "Loaded image: <image:tag>"
  # podman load outputs: "Loaded image: <image:tag>" or "Loaded image(s): <image:tag>"
  loaded_image=$(echo "${load_output}" | grep -oP '(?<=Loaded image[s]?: ).*' | head -1)

  if [[ -z "${loaded_image}" ]]; then
    echo "[WARN] Could not determine loaded image name from: ${filename}"
    ((failed++))
    continue
  fi

  # Retag for target registry
  target_ref="$(to_target_ref "${loaded_image}")"
  echo "  Tagging: ${loaded_image} -> ${target_ref}"
  "${CONTAINER_TOOL}" tag "${loaded_image}" "${target_ref}"

  # Push to target registry
  echo "  Pushing: ${target_ref}"
  if "${CONTAINER_TOOL}" push "${target_ref}" 2>/dev/null; then
    echo "  Done."
    ((success++))
  else
    echo "[ERROR] Failed to push: ${target_ref}"
    ((failed++))
  fi
  echo ""
done

echo "============================================"
echo "Import Summary"
echo "============================================"
echo "  Succeeded: ${success}"
echo "  Failed:    ${failed}"
echo ""

if [[ ${failed} -gt 0 ]]; then
  echo "WARNING: Some images failed to import. Check output above."
  exit 1
fi

echo "All images imported successfully."
echo ""
echo "Next steps:"
echo "  1. Apply the image-overrides ConfigMaps to your cluster"
echo "  2. Update each HelmRelease with valuesFrom referencing the overrides"
echo "  3. See docs/airgap-guide.md for detailed instructions"
IMPORTSCRIPT

  chmod +x "${BUNDLE_DIR}/import-images.sh"
}

# =============================================================================
# Generate README.txt
# =============================================================================

generate_readme() {
  cat > "${BUNDLE_DIR}/README.txt" << 'README'
=============================================================================
SRE Platform Air-Gap Image Bundle
=============================================================================

This bundle contains all container images required to deploy the SRE
(Secure Runtime Environment) Kubernetes platform in an air-gapped
environment with no internet access.

Contents:
  images/            - Container image tar files
  manifest.json      - Machine-readable list of all images and versions
  import-images.sh   - Script to load images into your air-gapped registry
  README.txt         - This file

Quick Start:
  1. Transfer this bundle to a host with access to your air-gapped registry
  2. Ensure docker or podman is installed
  3. Login to your registry:  docker login <registry-hostname>
  4. Run:  ./import-images.sh --registry <registry-hostname>

For full instructions, see docs/airgap-guide.md in the SRE platform repo.

=============================================================================
README
}

# =============================================================================
# Main
# =============================================================================

main() {
  local tool
  tool="$(detect_container_tool)"

  log_info "Container tool: ${tool}"
  log_info "Bundle output:  ${BUNDLE_TAR}"
  log_info "Total images:   ${#PLATFORM_IMAGES[@]}"
  echo ""

  # Clean up any previous bundle
  rm -rf "${BUNDLE_DIR}"
  mkdir -p "${IMAGES_DIR}"

  # -------------------------------------------------------------------------
  # Step 1: Export each image to a tar file
  # -------------------------------------------------------------------------
  local success=0
  local failed=0

  for img in "${PLATFORM_IMAGES[@]}"; do
    local filename
    filename="$(image_to_filename "${img}").tar"
    local tarpath="${IMAGES_DIR}/${filename}"

    if [[ "${DRY_RUN}" == "true" ]]; then
      log_info "[DRY RUN] Would export: ${img} -> ${filename}"
      ((success++))
      continue
    fi

    # Ensure image is pulled locally
    if ! ${tool} image inspect "${img}" &>/dev/null; then
      log_info "Pulling: ${img}"
      if ! ${tool} pull "${img}" 2>/dev/null; then
        log_error "Failed to pull: ${img}"
        ((failed++))
        continue
      fi
    fi

    log_info "Exporting: ${img} -> ${filename}"
    if [[ "${USE_SKOPEO}" == "true" ]] && command -v skopeo &>/dev/null; then
      skopeo copy "docker-daemon:${img}" "docker-archive:${tarpath}:${img}"
    else
      ${tool} save -o "${tarpath}" "${img}"
    fi

    ((success++))
  done

  echo ""
  log_info "Export complete: ${success} succeeded, ${failed} failed"

  # -------------------------------------------------------------------------
  # Step 2: Generate manifest.json
  # -------------------------------------------------------------------------
  log_info "Generating manifest.json"
  generate_manifest

  # -------------------------------------------------------------------------
  # Step 3: Generate import script
  # -------------------------------------------------------------------------
  log_info "Generating import-images.sh"
  generate_import_script

  # -------------------------------------------------------------------------
  # Step 4: Generate README
  # -------------------------------------------------------------------------
  log_info "Generating README.txt"
  generate_readme

  # -------------------------------------------------------------------------
  # Step 5: Create the compressed tar bundle
  # -------------------------------------------------------------------------
  log_info "Creating compressed bundle: ${BUNDLE_TAR}"
  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[DRY RUN] Would create: ${BUNDLE_TAR}"
  else
    tar czf "${BUNDLE_TAR}" -C "${OUTPUT_DIR}" "${BUNDLE_NAME}"
    local bundle_size
    bundle_size="$(du -sh "${BUNDLE_TAR}" | cut -f1)"
    log_info "Bundle size: ${bundle_size}"
  fi

  # -------------------------------------------------------------------------
  # Step 6: Cleanup working directory (keep the tar.gz)
  # -------------------------------------------------------------------------
  if [[ "${DRY_RUN}" != "true" ]]; then
    rm -rf "${BUNDLE_DIR}"
  fi

  echo ""
  log_info "============================================"
  log_info "Bundle created: ${BUNDLE_TAR}"
  log_info "============================================"
  log_info ""
  log_info "Transfer this file to your air-gapped environment, then:"
  log_info "  tar xzf ${BUNDLE_NAME}.tar.gz"
  log_info "  cd ${BUNDLE_NAME}/"
  log_info "  ./import-images.sh --registry harbor.airgap.local"
}

main "$@"
