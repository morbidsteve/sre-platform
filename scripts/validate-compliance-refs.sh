#!/usr/bin/env bash
# validate-compliance-refs.sh — Verify that file path references in compliance docs exist
#
# Parses compliance markdown files for backtick-quoted file paths and checks each exists.
# Exit code 0 = all references valid, 1 = broken references found.
#
# Usage:
#   ./scripts/validate-compliance-refs.sh
#   ./scripts/validate-compliance-refs.sh --verbose

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERBOSE=false

if [[ "${1:-}" == "--verbose" ]]; then
    VERBOSE=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Validating compliance document cross-references...${NC}"
echo ""

# Directories to scan for compliance docs
SCAN_DIRS=(
    "$REPO_ROOT/compliance"
    "$REPO_ROOT/docs"
)

# Also check the rpoc-ato-portal if it exists at the expected location
RPOC_DIR="$(cd "$REPO_ROOT/.." 2>/dev/null && echo "$PWD/rpoc-ato-portal")"
if [[ -d "$RPOC_DIR/compliance" ]]; then
    SCAN_DIRS+=("$RPOC_DIR/compliance")
fi

broken_count=0
checked_count=0
valid_count=0
skipped_count=0
broken_refs=()

for scan_dir in "${SCAN_DIRS[@]}"; do
    if [[ ! -d "$scan_dir" ]]; then
        continue
    fi

    while IFS= read -r -d '' mdfile; do
        rel_md="${mdfile#$REPO_ROOT/}"
        # If file is under rpoc-ato-portal, resolve paths relative to that repo
        if [[ "$mdfile" == "$RPOC_DIR"* ]]; then
            path_root="$RPOC_DIR"
            rel_md="${mdfile#$RPOC_DIR/}"
        else
            path_root="$REPO_ROOT"
        fi

        # Extract backtick-quoted paths that look like file references
        # Match patterns like `compliance/raise/foo.md`, `platform/core/istio/`, `policies/custom/bar.yaml`
        while IFS= read -r ref; do
            # Skip empty, URLs, shell commands, code snippets, placeholders
            [[ -z "$ref" ]] && continue
            [[ "$ref" == http* ]] && continue
            [[ "$ref" == git* ]] && continue
            [[ "$ref" == kubectl* ]] && continue
            [[ "$ref" == flux* ]] && continue
            [[ "$ref" == helm* ]] && continue
            [[ "$ref" == tofu* ]] && continue
            [[ "$ref" == ansible* ]] && continue
            [[ "$ref" == docker* ]] && continue
            [[ "$ref" == kyverno* ]] && continue
            [[ "$ref" == task* ]] && continue
            [[ "$ref" == npm* ]] && continue
            [[ "$ref" == go* ]] && continue
            [[ "$ref" == make* ]] && continue
            [[ "$ref" == cd* ]] && continue
            [[ "$ref" == export* ]] && continue
            [[ "$ref" == echo* ]] && continue
            [[ "$ref" == grep* ]] && continue
            [[ "$ref" == cat* ]] && continue
            [[ "$ref" == awk* ]] && continue
            [[ "$ref" == sed* ]] && continue
            [[ "$ref" == *"<"* ]] && continue
            [[ "$ref" == *">"* ]] && continue
            [[ "$ref" == *"$"* ]] && continue
            [[ "$ref" == *"{"* ]] && continue
            [[ "$ref" == *"|"* ]] && continue
            [[ "$ref" == *"="* ]] && continue
            [[ "$ref" == *" "* ]] && continue

            # Must contain a slash and look like a relative path
            [[ "$ref" != *"/"* ]] && continue

            # Must start with a known directory prefix
            case "$ref" in
                compliance/*|platform/*|policies/*|apps/*|infrastructure/*|docs/*|scripts/*|ci/*|tests/*) ;;
                *) continue ;;
            esac

            checked_count=$((checked_count + 1))

            # Strip trailing punctuation
            ref=$(echo "$ref" | sed 's/[,;:.!)]*$//')

            # Check if path exists (file or directory)
            full_path="$path_root/$ref"
            if [[ -e "$full_path" ]]; then
                valid_count=$((valid_count + 1))
                if [[ "$VERBOSE" == true ]]; then
                    echo -e "  ${GREEN}OK${NC}  $rel_md -> $ref"
                fi
            else
                broken_count=$((broken_count + 1))
                broken_refs+=("$rel_md -> $ref")
                echo -e "  ${RED}BROKEN${NC}  $rel_md -> $ref"
            fi
        done < <(grep -oE '`[^`]+`' "$mdfile" 2>/dev/null | sed 's/^`//' | sed 's/`$//' | sort -u)

    done < <(find "$scan_dir" -name '*.md' -print0 2>/dev/null)
done

echo ""
echo -e "${CYAN}Results:${NC}"
echo "  Checked:  $checked_count references"
echo "  Valid:    $valid_count"
echo "  Broken:   $broken_count"
echo ""

if [[ "$broken_count" -gt 0 ]]; then
    echo -e "${RED}FAIL: $broken_count broken reference(s) found.${NC}"
    echo ""
    echo "Broken references:"
    for ref in "${broken_refs[@]}"; do
        echo "  - $ref"
    done
    exit 1
else
    echo -e "${GREEN}PASS: All compliance document references are valid.${NC}"
    exit 0
fi
