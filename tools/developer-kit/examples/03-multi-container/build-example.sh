#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
for img in order-api order-worker db-migrate; do
  echo "{\"dummy\": \"Replace with: docker save ${img}:v3.1.0 -o images/${img}.tar\"}" > "images/${img}.tar"
  echo "Created images/${img}.tar (dummy)"
done
