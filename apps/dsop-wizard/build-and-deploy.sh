#!/usr/bin/env bash
# Wrapper — delegates to unified build script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/../../scripts/build-app.sh" "$SCRIPT_DIR" dsop-wizard "$@"
