#!/usr/bin/env bash
# sre-compat-check.sh — Pre-flight compatibility scanner for SRE platform
#
# Usage: ./scripts/sre-compat-check.sh IMAGE:TAG
#
# Inspects a container image and reports what deploy flags are needed.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 IMAGE:TAG"
  echo "Example: $0 harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0"
  exit 1
fi

IMAGE="$1"
FLAGS=()
WARNINGS=()

echo "=== SRE Compatibility Check ==="
echo "Image: $IMAGE"
echo ""

# Pull image if not present
if ! docker image inspect "$IMAGE" &>/dev/null; then
  echo "Pulling image..."
  if ! docker pull "$IMAGE" 2>/dev/null; then
    echo "ERROR: Cannot pull image '$IMAGE'. Verify the image exists and you are logged in."
    exit 1
  fi
fi

# Inspect image
INSPECT=$(docker image inspect "$IMAGE" 2>/dev/null)
if [[ -z "$INSPECT" ]]; then
  echo "ERROR: Cannot inspect image '$IMAGE'."
  exit 1
fi

CONFIG=$(echo "$INSPECT" | jq -r '.[0].Config')

# Check USER
USER_VAL=$(echo "$CONFIG" | jq -r '.User // empty')
echo "USER:       ${USER_VAL:-"(not set — defaults to root)"}"
if [[ -z "$USER_VAL" || "$USER_VAL" == "0" || "$USER_VAL" == "root" ]]; then
  echo "  -> Runs as root. Needs --run-as-root --writable-root"
  FLAGS+=("--run-as-root" "--writable-root")
elif [[ ! "$USER_VAL" =~ ^[0-9]+$ ]]; then
  echo "  -> Non-numeric USER ('$USER_VAL'). May fail runAsNonRoot check."
  WARNINGS+=("Non-numeric USER: Kubernetes cannot verify UID. May need --run-as-root.")
fi

# Check EXPOSE
PORTS=$(echo "$CONFIG" | jq -r '.ExposedPorts // {} | keys[]' 2>/dev/null | sed 's|/.*||')
if [[ -n "$PORTS" ]]; then
  echo "EXPOSE:     $PORTS"
  FIRST_PORT=$(echo "$PORTS" | head -1)
  FLAGS+=("--port $FIRST_PORT")
  for p in $PORTS; do
    if [[ "$p" -lt 1024 ]]; then
      echo "  -> Port $p < 1024. Needs --add-capability NET_BIND_SERVICE"
      FLAGS+=("--add-capability NET_BIND_SERVICE")
      break
    fi
  done
else
  echo "EXPOSE:     (none)"
  WARNINGS+=("No EXPOSE in Dockerfile. You must specify --port manually.")
fi

# Check ENTRYPOINT and CMD
ENTRYPOINT=$(echo "$CONFIG" | jq -r '.Entrypoint // [] | join(" ")')
CMD=$(echo "$CONFIG" | jq -r '.Cmd // [] | join(" ")')
echo "ENTRYPOINT: ${ENTRYPOINT:-"(none)"}"
echo "CMD:        ${CMD:-"(none)"}"

# Check for common writable paths
WORKDIR=$(echo "$CONFIG" | jq -r '.WorkingDir // "/"')
echo "WORKDIR:    $WORKDIR"

# Check VOLUMES (declared persistent paths)
VOLUMES=$(echo "$CONFIG" | jq -r '.Volumes // {} | keys[]' 2>/dev/null)
if [[ -n "$VOLUMES" ]]; then
  echo "VOLUMES:    $VOLUMES"
  for v in $VOLUMES; do
    echo "  -> Declared volume at $v. Consider --persist ${v}:5Gi"
    FLAGS+=("--persist ${v}:5Gi")
  done
else
  echo "VOLUMES:    (none)"
fi

# Check ENV for common patterns
ENV_VARS=$(echo "$CONFIG" | jq -r '.Env // [] | .[]' 2>/dev/null)
DB_HINT=$(echo "$ENV_VARS" | grep -iE 'DATABASE|POSTGRES|MYSQL|MONGO|REDIS' | head -3 || true)
if [[ -n "$DB_HINT" ]]; then
  echo ""
  echo "Database env vars detected:"
  echo "$DB_HINT" | while read -r line; do echo "  $line"; done
  WARNINGS+=("App may need database connection. Check env vars.")
fi

# Summary
echo ""
echo "=== Recommended Deploy Command ==="
echo "./scripts/sre-deploy-app.sh \\"
echo "  --name APP_NAME --team TEAM_NAME \\"
echo "  --image ${IMAGE%:*} --tag ${IMAGE##*:} \\"
for f in "${FLAGS[@]}"; do
  echo "  $f \\"
done
echo "  --ingress APP_NAME.apps.sre.example.com"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "=== Warnings ==="
  for w in "${WARNINGS[@]}"; do
    echo "  ! $w"
  done
fi
