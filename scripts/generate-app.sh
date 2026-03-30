#!/usr/bin/env bash
# generate-app.sh — Generate Flux HelmRelease YAML from an App Contract YAML file
# Usage: ./scripts/generate-app.sh <path-to-contract.yaml>
# Requires: yq v4 (https://github.com/mikefarah/yq)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/colors.sh"
die() { error "$@"; exit 1; }

# --- Prereq check ---
check_yq() {
  command -v yq >/dev/null 2>&1 || die "yq not installed. Install yq v4: https://github.com/mikefarah/yq"
  [[ "$(yq --version 2>&1)" == *"v4"* ]] || die "yq v4 required"
}

# --- Validation ---
validate_contract() {
  local f="$1"
  [[ -f "$f" ]] || die "File not found: ${f}"
  local name team type image res
  name="$(yq '.metadata.name // ""' "$f")"; [[ -n "$name" ]] || die "metadata.name is required"
  team="$(yq '.metadata.team // ""' "$f")"; [[ -n "$team" ]] || die "metadata.team is required"
  type="$(yq '.spec.type // ""' "$f")"; [[ -n "$type" ]] || die "spec.type is required"
  image="$(yq '.spec.image // ""' "$f")"; [[ -n "$image" ]] || die "spec.image is required"
  res="$(yq '.spec.resources // ""' "$f")"; [[ -n "$res" ]] || die "spec.resources is required"
  [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]] || die "metadata.name must be kebab-case (got: ${name})"
  [[ "$team" =~ ^team-[a-z][a-z0-9-]*$ ]] || die "metadata.team must match team-<name> (got: ${team})"
  [[ "$type" =~ ^(web-app|api-service|worker|cronjob)$ ]] || die "Invalid spec.type: ${type}"
  [[ "$image" == harbor.* ]] || die "spec.image must start with 'harbor.' (got: ${image})"
  [[ "$image" != *":latest" ]] || die "spec.image must not use :latest tag"
  [[ "$res" =~ ^(small|medium|large|custom)$ ]] || die "Invalid spec.resources: ${res}"
  if [[ "$res" == "custom" ]]; then
    local cr; cr="$(yq '.spec.customResources // ""' "$f")"
    [[ -n "$cr" && "$cr" != "null" ]] || die "spec.customResources required when resources=custom"
  fi
}

# --- Presets ---
resource_preset() {
  case "$1" in
    small)  echo "100m 128Mi 500m 512Mi" ;;
    medium) echo "250m 256Mi 1000m 1Gi" ;;
    large)  echo "500m 512Mi 2000m 2Gi" ;;
  esac
}
db_preset() {
  case "${1:-small}" in small) echo "1 5Gi" ;; medium) echo "2 10Gi" ;; large) echo "3 20Gi" ;; *) echo "1 5Gi" ;; esac
}
redis_preset() {
  case "${1:-small}" in small) echo "1Gi" ;; medium) echo "2Gi" ;; large) echo "5Gi" ;; *) echo "1Gi" ;; esac
}

# --- Generation ---
generate_helmrelease() {
  local f="$1"
  local name team type image res
  name="$(yq '.metadata.name' "$f")"
  team="$(yq '.metadata.team' "$f")"
  type="$(yq '.spec.type' "$f")"
  image="$(yq '.spec.image' "$f")"
  res="$(yq '.spec.resources' "$f")"
  local img_repo="${image%:*}" img_tag="${image##*:}"
  local port; port="$(yq '.spec.port // 8080' "$f")"
  local drep=2; [[ "$type" == "worker" || "$type" == "cronjob" ]] && drep=1
  local replicas; replicas="$(yq ".spec.replicas // ${drep}" "$f")"
  local req_cpu req_mem lim_cpu lim_mem
  if [[ "$res" == "custom" ]]; then
    req_cpu="$(yq '.spec.customResources.requests.cpu' "$f")"
    req_mem="$(yq '.spec.customResources.requests.memory' "$f")"
    lim_cpu="$(yq '.spec.customResources.limits.cpu' "$f")"
    lim_mem="$(yq '.spec.customResources.limits.memory' "$f")"
  else
    read -r req_cpu req_mem lim_cpu lim_mem <<< "$(resource_preset "$res")"
  fi
  local lp; lp="$(yq '.spec.probes.liveness // "/"' "$f")"
  local rp; rp="$(yq '.spec.probes.readiness // "/"' "$f")"
  local sso; sso="$(yq '.spec.services.sso.enabled // false' "$f")"
  local ihost; ihost="$(yq '.spec.ingress // ""' "$f")"
  # Build base YAML
  local out; out="$(yq -n "
    .apiVersion = \"helm.toolkit.fluxcd.io/v2\" |
    .kind = \"HelmRelease\" |
    .metadata.name = \"${name}\" |
    .metadata.namespace = \"${team}\" |
    .metadata.labels.\"app.kubernetes.io/part-of\" = \"sre-platform\" |
    .metadata.labels.\"sre.io/team\" = \"${team}\" |
    .spec.interval = \"10m\" |
    .spec.chart.spec.chart = \"./apps/templates/${type}\" |
    .spec.chart.spec.reconcileStrategy = \"Revision\" |
    .spec.chart.spec.sourceRef.kind = \"GitRepository\" |
    .spec.chart.spec.sourceRef.name = \"flux-system\" |
    .spec.chart.spec.sourceRef.namespace = \"flux-system\" |
    .spec.install.createNamespace = false |
    .spec.install.remediation.retries = 3 |
    .spec.upgrade.cleanupOnFail = true |
    .spec.upgrade.remediation.retries = 3 |
    .spec.values.app.name = \"${name}\" |
    .spec.values.app.team = \"${team}\" |
    .spec.values.app.image.repository = \"${img_repo}\" |
    .spec.values.app.image.tag = \"${img_tag}\" |
    .spec.values.app.image.pullPolicy = \"IfNotPresent\" |
    .spec.values.app.port = ${port} |
    .spec.values.app.replicas = ${replicas} |
    .spec.values.app.resources.requests.cpu = \"${req_cpu}\" |
    .spec.values.app.resources.requests.memory = \"${req_mem}\" |
    .spec.values.app.resources.limits.cpu = \"${lim_cpu}\" |
    .spec.values.app.resources.limits.memory = \"${lim_mem}\" |
    .spec.values.app.probes.liveness.path = \"${lp}\" |
    .spec.values.app.probes.liveness.initialDelaySeconds = 10 |
    .spec.values.app.probes.liveness.periodSeconds = 10 |
    .spec.values.app.probes.readiness.path = \"${rp}\" |
    .spec.values.app.probes.readiness.initialDelaySeconds = 5 |
    .spec.values.app.probes.readiness.periodSeconds = 5 |
    .spec.values.app.env = [] |
    .spec.values.autoscaling.enabled = false |
    .spec.values.networkPolicy.enabled = true |
    .spec.values.podDisruptionBudget.enabled = false |
    .spec.values.serviceMonitor.enabled = false
  ")"
  # SSO annotation
  [[ "$sso" == "true" ]] && out="$(echo "$out" | yq '.metadata.annotations."sre.io/sso" = "enabled" | .metadata.annotations."sre.io/sso" |= (. style="double")')"
  # Env mapping
  local ec; ec="$(yq '.spec.env | length // 0' "$f")"
  if [[ "$ec" -gt 0 ]]; then
    local tmpenv; tmpenv="$(mktemp)"
    trap "rm -f $tmpenv" EXIT
    yq -n '[]' > "$tmpenv"
    for ((i=0; i<ec; i++)); do
      local en ev es
      en="$(yq ".spec.env[${i}].name" "$f")"
      ev="$(yq ".spec.env[${i}].value // \"\"" "$f")"
      es="$(yq ".spec.env[${i}].secret // \"\"" "$f")"
      if [[ -n "$es" && "$es" != "null" ]]; then
        yq -i ".[${i}].name = \"${en}\" | .[${i}].secretRef = \"${es}\"" "$tmpenv"
      else
        yq -i ".[${i}].name = \"${en}\" | .[${i}].value = \"${ev}\"" "$tmpenv"
      fi
    done
    out="$(echo "$out" | yq ".spec.values.app.env = load(\"${tmpenv}\")")"
    rm -f "$tmpenv"
  fi
  # Ingress — omit for worker/cronjob
  if [[ "$type" == "worker" || "$type" == "cronjob" ]]; then
    out="$(echo "$out" | yq 'del(.spec.values.ingress)')"
  elif [[ -n "$ihost" && "$ihost" != "null" ]]; then
    out="$(echo "$out" | yq ".spec.values.ingress.enabled = true | .spec.values.ingress.host = \"${ihost}\"")"
  else
    out="$(echo "$out" | yq '.spec.values.ingress.enabled = false')"
  fi
  # Database
  local dbe; dbe="$(yq '.spec.services.database.enabled // false' "$f")"
  if [[ "$dbe" == "true" ]]; then
    local dbs dbi dbst
    dbs="$(yq '.spec.services.database.size // "small"' "$f")"
    read -r dbi dbst <<< "$(db_preset "$dbs")"
    out="$(echo "$out" | yq ".spec.values.database.enabled = true | .spec.values.database.instances = ${dbi} | .spec.values.database.size = \"${dbst}\"")"
  fi
  # Redis
  local rde; rde="$(yq '.spec.services.redis.enabled // false' "$f")"
  if [[ "$rde" == "true" ]]; then
    local rds rdm
    rds="$(yq '.spec.services.redis.size // "small"' "$f")"
    rdm="$(redis_preset "$rds")"
    out="$(echo "$out" | yq ".spec.values.redis.enabled = true | .spec.values.redis.size = \"${rdm}\"")"
  fi
  # External APIs
  local xc; xc="$(yq '.spec.externalApis | length // 0' "$f")"
  if [[ "$xc" -gt 0 ]]; then
    local tmpext; tmpext="$(mktemp)"
    yq '.spec.externalApis | [.[] | {"host": ., "port": 443}]' "$f" > "$tmpext"
    out="$(echo "$out" | yq ".spec.values.externalServices = load(\"${tmpext}\")")"
    rm -f "$tmpext"
  fi
  # Canary
  [[ "$(yq '.spec.canary.enabled // false' "$f")" == "true" ]] && \
    out="$(echo "$out" | yq '.spec.values.canary.enabled = true')"
  # Schedule (cronjob only)
  if [[ "$type" == "cronjob" ]]; then
    local sched; sched="$(yq '.spec.schedule // ""' "$f")"
    [[ -n "$sched" && "$sched" != "null" ]] && \
      out="$(echo "$out" | yq ".spec.values.schedule = \"${sched}\"")"
  fi
  echo "---"
  echo "$out"
}

# --- Kustomization update ---
update_kustomization() {
  local kf="$1" rf="$2"
  if [[ ! -f "$kf" ]]; then
    printf '%s\n' "---" > "$kf"
    yq -n '.apiVersion = "kustomize.config.k8s.io/v1beta1" | .kind = "Kustomization" | .resources = []' >> "$kf"
  fi
  local hit; hit="$(yq ".resources[] | select(. == \"${rf}\")" "$kf" 2>/dev/null || true)"
  if [[ -z "$hit" ]]; then
    yq -i ".resources += [\"${rf}\"]" "$kf"
  fi
}

# --- Main ---
main() {
  [[ $# -ge 1 ]] || die "Usage: generate-app.sh <contract.yaml>"
  check_yq
  local contract="$1"
  validate_contract "$contract"
  local name team
  name="$(yq '.metadata.name' "$contract")"
  team="$(yq '.metadata.team' "$contract")"
  local apps_dir="${REPO_ROOT}/apps/tenants/${team}/apps"
  local out_file="${apps_dir}/${name}.yaml"
  mkdir -p "$apps_dir"
  info "Generating HelmRelease for ${name} (team: ${team})"
  generate_helmrelease "$contract" > "$out_file"
  update_kustomization "${apps_dir}/kustomization.yaml" "${name}.yaml"
  log "Written: ${out_file}"
  log "Kustomization updated: ${apps_dir}/kustomization.yaml"
}

main "$@"
