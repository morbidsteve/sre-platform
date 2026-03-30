#!/usr/bin/env bash
# Creates a minimal test bundle for the simple web app example
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
# Create a tiny dummy tar (not a real image, just for testing the bundle structure)
echo '{"dummy": "This is a placeholder. Replace with: docker save hello-web:v1.0.0 -o images/hello-web.tar"}' > images/hello-web.tar
echo "Created images/hello-web.tar (dummy)"
echo "To use a real image: docker save your-image:tag -o images/hello-web.tar"
