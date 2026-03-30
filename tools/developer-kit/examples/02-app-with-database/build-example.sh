#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p images
echo '{"dummy": "Replace with: docker save todo-app:v2.0.0 -o images/todo-app.tar"}' > images/todo-app.tar
echo "Created images/todo-app.tar (dummy)"
