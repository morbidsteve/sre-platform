#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# airgap-mirror-images.sh — Mirror all SRE platform images to Harbor
# =============================================================================
#
# PURPOSE:
#   Pulls all container images used by the SRE platform from upstream registries,
#   retags them for the internal Harbor registry, pushes them to Harbor, and
#   generates a ConfigMap with all mirrored image references.
#
# PREREQUISITES:
#   - docker or podman CLI available
#   - Authenticated to the internal Harbor registry (docker login harbor.sre.internal)
#   - Harbor project "platform" exists (create with: harbor API or UI)
#   - Network access to upstream registries (Docker Hub, quay.io, ghcr.io, etc.)
#
# USAGE:
#   # 1. Login to Harbor
#   docker login harbor.sre.internal
#
#   # 2. Run the mirror script
#   ./scripts/airgap-mirror-images.sh
#
#   # 3. Apply the generated ConfigMap to your cluster
#   kubectl apply -f platform/core/image-overrides-configmap.yaml
#
#   # 4. Reference the ConfigMap in each HelmRelease via valuesFrom
#   #    (see docs/airgap-guide.md for details)
#
# ENVIRONMENT VARIABLES:
#   HARBOR_REGISTRY  — Target Harbor registry (default: harbor.sre.internal)
#   HARBOR_PROJECT   — Target Harbor project (default: platform)
#   CONTAINER_TOOL   — Container CLI to use (default: auto-detect docker/podman)
#   DRY_RUN          — Set to "true" to print actions without executing
#   SKIP_PUSH        — Set to "true" to pull and tag only (no push)
#
# =============================================================================

HARBOR_REGISTRY="${HARBOR_REGISTRY:-harbor.sre.internal}"
HARBOR_PROJECT="${HARBOR_PROJECT:-platform}"
CONTAINER_TOOL="${CONTAINER_TOOL:-}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_PUSH="${SKIP_PUSH:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIGMAP_OUTPUT="${REPO_ROOT}/platform/core/image-overrides-configmap.yaml"
MANIFEST_FILE="/tmp/sre-platform-images-manifest.txt"

# =============================================================================
# Image Registry — All images used by the SRE platform
#
# Format: UPSTREAM_IMAGE  (the script derives the Harbor target automatically)
#
# IMPORTANT: When upgrading a component, update the version here AND in the
# corresponding HelmRelease. Run this script again to mirror the new version.
# =============================================================================

declare -a PLATFORM_IMAGES=(
  # -------------------------------------------------------------------------
  # Istio 1.25.2
  # -------------------------------------------------------------------------
  "docker.io/istio/pilot:1.25.2"
  "docker.io/istio/proxyv2:1.25.2"

  # -------------------------------------------------------------------------
  # cert-manager 1.14.4
  # -------------------------------------------------------------------------
  "quay.io/jetstack/cert-manager-controller:v1.14.4"
  "quay.io/jetstack/cert-manager-webhook:v1.14.4"
  "quay.io/jetstack/cert-manager-cainjector:v1.14.4"
  "quay.io/jetstack/cert-manager-startupapicheck:v1.14.4"

  # -------------------------------------------------------------------------
  # Kyverno 3.3.7
  # -------------------------------------------------------------------------
  "ghcr.io/kyverno/kyverno:v1.13.4"
  "ghcr.io/kyverno/kyvernopre:v1.13.4"
  "ghcr.io/kyverno/background-controller:v1.13.4"
  "ghcr.io/kyverno/cleanup-controller:v1.13.4"
  "ghcr.io/kyverno/reports-controller:v1.13.4"

  # -------------------------------------------------------------------------
  # Monitoring — kube-prometheus-stack 72.6.2
  # -------------------------------------------------------------------------
  "quay.io/prometheus/prometheus:v2.54.1"
  "quay.io/prometheus/alertmanager:v0.27.0"
  "quay.io/prometheus-operator/prometheus-operator:v0.77.1"
  "quay.io/prometheus-operator/prometheus-config-reloader:v0.77.1"
  "docker.io/grafana/grafana:11.3.0"
  "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0"
  "quay.io/prometheus/node-exporter:v1.8.2"
  "docker.io/jimmidyson/configmap-reload:v0.13.1"
  "quay.io/kiwigrid/k8s-sidecar:1.27.6"

  # -------------------------------------------------------------------------
  # Logging — Loki 6.29.0 + Alloy 0.12.2
  # -------------------------------------------------------------------------
  "docker.io/grafana/loki:3.3.2"
  "docker.io/grafana/alloy:v1.5.1"

  # -------------------------------------------------------------------------
  # Tempo 1.18.2
  # -------------------------------------------------------------------------
  "docker.io/grafana/tempo:2.6.1"

  # -------------------------------------------------------------------------
  # OpenBao 0.9.0
  # -------------------------------------------------------------------------
  "quay.io/openbao/openbao:2.1.0"

  # -------------------------------------------------------------------------
  # External Secrets Operator 0.9.13
  # -------------------------------------------------------------------------
  "ghcr.io/external-secrets/external-secrets:v0.9.13"

  # -------------------------------------------------------------------------
  # Harbor 1.16.3
  # -------------------------------------------------------------------------
  "docker.io/goharbor/harbor-core:v2.11.2"
  "docker.io/goharbor/harbor-portal:v2.11.2"
  "docker.io/goharbor/harbor-jobservice:v2.11.2"
  "docker.io/goharbor/harbor-registryctl:v2.11.2"
  "docker.io/goharbor/registry-photon:v2.11.2"
  "docker.io/goharbor/harbor-db:v2.11.2"
  "docker.io/goharbor/redis-photon:v2.11.2"
  "docker.io/goharbor/trivy-adapter-photon:v2.11.2"

  # -------------------------------------------------------------------------
  # NeuVector 2.8.6
  # -------------------------------------------------------------------------
  "docker.io/neuvector/controller:5.4.0"
  "docker.io/neuvector/enforcer:5.4.0"
  "docker.io/neuvector/manager:5.4.0"
  "docker.io/neuvector/scanner:5.4.0"
  "docker.io/neuvector/updater:5.4.0"

  # -------------------------------------------------------------------------
  # Keycloak 24.8.1 (Bitnami chart)
  # -------------------------------------------------------------------------
  "docker.io/bitnamilegacy/keycloak:26.3.2-debian-12-r0"
  "docker.io/bitnamilegacy/postgresql:17.4.0-debian-12-r17"

  # -------------------------------------------------------------------------
  # Velero 11.3.2
  # -------------------------------------------------------------------------
  "docker.io/velero/velero:v1.14.1"
  "docker.io/velero/velero-plugin-for-aws:v1.9.1"
  "docker.io/bitnamilegacy/kubectl:1.33.4-debian-12-r0"

  # -------------------------------------------------------------------------
  # MetalLB 0.14.9
  # -------------------------------------------------------------------------
  "quay.io/metallb/controller:v0.14.9"
  "quay.io/metallb/speaker:v0.14.9"

  # -------------------------------------------------------------------------
  # Flux CD 2.8.1
  # -------------------------------------------------------------------------
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

# Convert an upstream image reference to a Harbor-mirrored reference.
# Examples:
#   docker.io/istio/pilot:1.25.2        -> harbor.sre.internal/platform/istio-pilot:1.25.2
#   quay.io/jetstack/cert-manager-controller:v1.14.4
#                                        -> harbor.sre.internal/platform/jetstack-cert-manager-controller:v1.14.4
#   ghcr.io/kyverno/kyverno:v1.13.4     -> harbor.sre.internal/platform/kyverno-kyverno:v1.13.4
to_harbor_ref() {
  local src="$1"
  local tag image_path name

  # Split image:tag
  tag="${src##*:}"
  image_path="${src%:*}"

  # Remove registry prefix (docker.io/, quay.io/, ghcr.io/, registry.k8s.io/)
  image_path="${image_path#docker.io/}"
  image_path="${image_path#quay.io/}"
  image_path="${image_path#ghcr.io/}"
  image_path="${image_path#registry.k8s.io/}"

  # Replace slashes with dashes to create a flat name
  name="${image_path//\//-}"

  echo "${HARBOR_REGISTRY}/${HARBOR_PROJECT}/${name}:${tag}"
}

log_info() {
  echo "[INFO]  $*"
}

log_warn() {
  echo "[WARN]  $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

# =============================================================================
# Main
# =============================================================================

main() {
  local tool
  tool="$(detect_container_tool)"
  log_info "Using container tool: ${tool}"
  log_info "Target registry: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}"
  log_info "Total images to mirror: ${#PLATFORM_IMAGES[@]}"
  echo ""

  local success=0
  local failed=0
  local failed_images=()

  # Clear manifest file
  : > "${MANIFEST_FILE}"

  for src_image in "${PLATFORM_IMAGES[@]}"; do
    local dst_image
    dst_image="$(to_harbor_ref "${src_image}")"

    echo "${src_image} -> ${dst_image}" >> "${MANIFEST_FILE}"

    if [[ "${DRY_RUN}" == "true" ]]; then
      log_info "[DRY RUN] Would mirror: ${src_image} -> ${dst_image}"
      ((success++))
      continue
    fi

    log_info "Pulling: ${src_image}"
    if ! ${tool} pull "${src_image}" 2>/dev/null; then
      log_error "Failed to pull: ${src_image}"
      ((failed++))
      failed_images+=("${src_image}")
      continue
    fi

    log_info "Tagging: ${dst_image}"
    ${tool} tag "${src_image}" "${dst_image}"

    if [[ "${SKIP_PUSH}" == "true" ]]; then
      log_info "[SKIP PUSH] Tagged but not pushed: ${dst_image}"
      ((success++))
      continue
    fi

    log_info "Pushing: ${dst_image}"
    if ! ${tool} push "${dst_image}" 2>/dev/null; then
      log_error "Failed to push: ${dst_image}"
      ((failed++))
      failed_images+=("${src_image}")
      continue
    fi

    ((success++))
    log_info "Mirrored: ${dst_image}"
    echo ""
  done

  echo ""
  log_info "============================================"
  log_info "Mirror Summary"
  log_info "============================================"
  log_info "  Succeeded: ${success}"
  log_info "  Failed:    ${failed}"
  log_info "  Manifest:  ${MANIFEST_FILE}"

  if [[ ${failed} -gt 0 ]]; then
    log_warn "Failed images:"
    for img in "${failed_images[@]}"; do
      log_warn "  - ${img}"
    done
  fi

  # -------------------------------------------------------------------------
  # Generate the image-overrides ConfigMap
  # -------------------------------------------------------------------------
  log_info ""
  log_info "Generating image overrides ConfigMap: ${CONFIGMAP_OUTPUT}"
  generate_configmap

  log_info "Done. Apply the ConfigMap and update HelmRelease valuesFrom references."
  log_info "See docs/airgap-guide.md for full instructions."
}

generate_configmap() {
  cat > "${CONFIGMAP_OUTPUT}" << 'HEADER'
---
# =============================================================================
# Image Overrides ConfigMap for Air-Gap Deployments
# =============================================================================
# Generated by scripts/airgap-mirror-images.sh
# Apply this ConfigMap and reference it in each HelmRelease via valuesFrom.
#
# This ConfigMap contains Helm values that override upstream image references
# to point to the internal Harbor registry. Each key corresponds to a
# HelmRelease name and contains the YAML values to override.
# =============================================================================
HEADER

  # --- Istio ---
  cat >> "${CONFIGMAP_OUTPUT}" << EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-istio
  namespace: istio-system
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    pilot:
      image: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/istio-pilot:1.25.2
    global:
      proxy:
        image: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/istio-proxyv2:1.25.2
      proxy_init:
        image: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/istio-proxyv2:1.25.2
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-istio-gateway
  namespace: istio-system
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      registry: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}
      repository: istio-proxyv2
      tag: "1.25.2"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-cert-manager
  namespace: cert-manager
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/jetstack-cert-manager-controller
      tag: "v1.14.4"
    webhook:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/jetstack-cert-manager-webhook
        tag: "v1.14.4"
    cainjector:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/jetstack-cert-manager-cainjector
        tag: "v1.14.4"
    startupapicheck:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/jetstack-cert-manager-startupapicheck
        tag: "v1.14.4"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-kyverno
  namespace: kyverno
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    admissionController:
      container:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/kyverno-kyverno
          tag: "v1.13.4"
      initContainer:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/kyverno-kyvernopre
          tag: "v1.13.4"
    backgroundController:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/kyverno-background-controller
        tag: "v1.13.4"
    cleanupController:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/kyverno-cleanup-controller
        tag: "v1.13.4"
    reportsController:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/kyverno-reports-controller
        tag: "v1.13.4"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-monitoring
  namespace: monitoring
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    prometheus:
      prometheusSpec:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/prometheus-prometheus
          tag: "v2.54.1"
    alertmanager:
      alertmanagerSpec:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/prometheus-alertmanager
          tag: "v0.27.0"
    prometheusOperator:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/prometheus-operator-prometheus-operator
        tag: "v0.77.1"
      prometheusConfigReloader:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/prometheus-operator-prometheus-config-reloader
          tag: "v0.77.1"
    grafana:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/grafana-grafana
        tag: "11.3.0"
      sidecar:
        image:
          registry: ${HARBOR_REGISTRY}
          repository: ${HARBOR_PROJECT}/kiwigrid-k8s-sidecar
          tag: "1.27.6"
    kube-state-metrics:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/kube-state-metrics-kube-state-metrics
        tag: "v2.13.0"
    prometheus-node-exporter:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/prometheus-node-exporter
        tag: "v1.8.2"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-loki
  namespace: logging
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    loki:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/grafana-loki
        tag: "3.3.2"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-alloy
  namespace: logging
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      registry: ${HARBOR_REGISTRY}
      repository: ${HARBOR_PROJECT}/grafana-alloy
      tag: "v1.5.1"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-tempo
  namespace: tempo
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    tempo:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/grafana-tempo
        tag: "2.6.1"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-openbao
  namespace: openbao
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    server:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/openbao-openbao
        tag: "2.1.0"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-external-secrets
  namespace: external-secrets
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/external-secrets-external-secrets
      tag: "v0.9.13"
    webhook:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/external-secrets-external-secrets
        tag: "v0.9.13"
    certController:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/external-secrets-external-secrets
        tag: "v0.9.13"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-harbor
  namespace: harbor
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    core:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-harbor-core
        tag: "v2.11.2"
    portal:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-harbor-portal
        tag: "v2.11.2"
    jobservice:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-harbor-jobservice
        tag: "v2.11.2"
    registry:
      registry:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-registry-photon
          tag: "v2.11.2"
      controller:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-harbor-registryctl
          tag: "v2.11.2"
    database:
      internal:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-harbor-db
          tag: "v2.11.2"
    redis:
      internal:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-redis-photon
          tag: "v2.11.2"
    trivy:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/goharbor-trivy-adapter-photon
        tag: "v2.11.2"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-neuvector
  namespace: neuvector
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    controller:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/neuvector-controller
        tag: "5.4.0"
    enforcer:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/neuvector-enforcer
        tag: "5.4.0"
    manager:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/neuvector-manager
        tag: "5.4.0"
    cve:
      scanner:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/neuvector-scanner
          tag: "latest"
      updater:
        image:
          repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/neuvector-updater
          tag: "latest"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-keycloak
  namespace: keycloak
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      registry: ${HARBOR_REGISTRY}
      repository: ${HARBOR_PROJECT}/bitnamilegacy-keycloak
      tag: "26.3.2-debian-12-r0"
    postgresql:
      image:
        registry: ${HARBOR_REGISTRY}
        repository: ${HARBOR_PROJECT}/bitnamilegacy-postgresql
        tag: "17.4.0-debian-12-r17"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-velero
  namespace: velero
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    image:
      repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/velero-velero
      tag: "v1.14.1"
    kubectl:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/bitnamilegacy-kubectl
        tag: "1.33.4-debian-12-r0"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: airgap-image-overrides-metallb
  namespace: metallb-system
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/airgap: "true"
data:
  values.yaml: |
    controller:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/metallb-controller
        tag: "v0.14.9"
    speaker:
      image:
        repository: ${HARBOR_REGISTRY}/${HARBOR_PROJECT}/metallb-speaker
        tag: "v0.14.9"
EOF

  log_info "ConfigMap written to: ${CONFIGMAP_OUTPUT}"
}

main "$@"
