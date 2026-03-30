#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
echo '{"dummy": "Replace with vendor-provided image tar"}' > images/acme-portal.tar
echo "Created images/acme-portal.tar (dummy)"
