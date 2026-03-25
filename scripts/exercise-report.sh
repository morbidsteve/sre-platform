#!/usr/bin/env bash
# ============================================================================
# SRE Platform — Tabletop Exercise Report Generator
# ============================================================================
# Reads exercise YAML files from compliance/raise/exercises/ and generates
# a summary report of exercise completion status, findings, and action items.
#
# Usage:
#   ./scripts/exercise-report.sh                    # Human-readable report
#   ./scripts/exercise-report.sh --json             # Machine-readable JSON
#   ./scripts/exercise-report.sh --year 2026        # Filter by year
#
# NIST Controls: IR-3 (Incident Response Testing), CP-4 (Contingency Plan Testing)
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXERCISES_DIR="${REPO_ROOT}/compliance/raise/exercises"
JSON_OUTPUT=false
FILTER_YEAR=""

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)  JSON_OUTPUT=true; shift ;;
        --year)  FILTER_YEAR="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--json] [--year YYYY]"
            echo "  --json       Output machine-readable JSON"
            echo "  --year YYYY  Filter exercises by year"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Prerequisites ───────────────────────────────────────────────────────────
if [[ ! -d "$EXERCISES_DIR" ]]; then
    echo "ERROR: Exercises directory not found: ${EXERCISES_DIR}" >&2
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 is required" >&2
    exit 1
fi

# Check for PyYAML
if ! python3 -c "import yaml" 2>/dev/null; then
    echo -e "${YELLOW}WARNING: PyYAML not installed. Install with: pip3 install pyyaml${NC}" >&2
    echo "Falling back to basic file listing..." >&2

    # Basic fallback without YAML parsing
    if ! $JSON_OUTPUT; then
        echo ""
        echo -e "${BOLD}SRE Platform — Exercise Report${NC}"
        echo "=============================================================================="
        echo ""
        echo "Exercise files found:"
        for f in "${EXERCISES_DIR}"/*.yaml; do
            if [[ -f "$f" ]] && [[ "$(basename "$f")" != "exercise-template.yaml" ]]; then
                echo "  - $(basename "$f")"
            fi
        done
        echo ""
        echo -e "${YELLOW}Install PyYAML for full report: pip3 install pyyaml${NC}"
    fi
    exit 0
fi

# ── Generate report ────────────────────────────────────────────────────────
EXERCISES_DIR_ESC="${EXERCISES_DIR}" FILTER_YEAR_ESC="${FILTER_YEAR}" JSON_OUTPUT_ESC="${JSON_OUTPUT}" python3 <<'PYEOF'
import os
import sys
import json
from datetime import datetime

exercises_dir = os.environ.get("EXERCISES_DIR_ESC", "")
filter_year = os.environ.get("FILTER_YEAR_ESC", "")
json_output = os.environ.get("JSON_OUTPUT_ESC", "false") == "true"

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed", file=sys.stderr)
    sys.exit(1)

exercises = []
template_file = os.path.join(exercises_dir, "exercise-template.yaml")

for filename in sorted(os.listdir(exercises_dir)):
    filepath = os.path.join(exercises_dir, filename)
    if not filename.endswith(".yaml") or filename == "exercise-template.yaml":
        continue
    if not os.path.isfile(filepath):
        continue

    try:
        with open(filepath) as f:
            data = yaml.safe_load(f)
        if data and "exercise" in data:
            ex = data["exercise"]
            ex["_filename"] = filename
            # Filter by year if specified
            if filter_year:
                ex_date = ex.get("date", "")
                if not ex_date.startswith(filter_year):
                    continue
            exercises.append(ex)
    except Exception as e:
        print(f"WARNING: Failed to parse {filename}: {e}", file=sys.stderr)

# Sort by date
exercises.sort(key=lambda e: e.get("date", ""))

# Collect statistics
total = len(exercises)
completed = len([e for e in exercises if e.get("status") == "completed"])
planned = len([e for e in exercises if e.get("status") == "planned"])
cancelled = len([e for e in exercises if e.get("status") == "cancelled"])

all_findings = []
all_actions = []
for ex in exercises:
    for f in ex.get("findings", []):
        f["_exercise"] = ex.get("id", "")
        all_findings.append(f)
    for a in ex.get("action_items", []):
        a["_exercise"] = ex.get("id", "")
        all_actions.append(a)

total_findings = len(all_findings)
critical_findings = len([f for f in all_findings if f.get("severity") == "critical"])
high_findings = len([f for f in all_findings if f.get("severity") == "high"])
medium_findings = len([f for f in all_findings if f.get("severity") == "medium"])
low_findings = len([f for f in all_findings if f.get("severity") == "low"])

total_actions = len(all_actions)
actions_open = len([a for a in all_actions if a.get("status") == "open"])
actions_inprogress = len([a for a in all_actions if a.get("status") == "in-progress"])
actions_complete = len([a for a in all_actions if a.get("status") == "complete"])

# Check quarterly compliance
current_year = datetime.now().year
quarters_with_exercise = set()
for ex in exercises:
    ex_date = ex.get("date", "")
    if ex_date and ex.get("status") == "completed":
        try:
            dt = datetime.strptime(ex_date, "%Y-%m-%d")
            if dt.year == current_year:
                q = (dt.month - 1) // 3 + 1
                quarters_with_exercise.add(q)
        except ValueError:
            pass

current_quarter = (datetime.now().month - 1) // 3 + 1
quarters_required = list(range(1, current_quarter + 1))
quarters_missing = [q for q in quarters_required if q not in quarters_with_exercise]

if json_output:
    output = {
        "report": {
            "title": "SRE Platform Exercise Completion Report",
            "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "filter_year": filter_year or "all",
            "summary": {
                "total_exercises": total,
                "completed": completed,
                "planned": planned,
                "cancelled": cancelled,
                "total_findings": total_findings,
                "findings_by_severity": {
                    "critical": critical_findings,
                    "high": high_findings,
                    "medium": medium_findings,
                    "low": low_findings
                },
                "total_action_items": total_actions,
                "actions_open": actions_open,
                "actions_in_progress": actions_inprogress,
                "actions_complete": actions_complete,
                "quarterly_compliance": {
                    "year": current_year,
                    "quarters_completed": sorted(list(quarters_with_exercise)),
                    "quarters_missing": quarters_missing,
                    "compliant": len(quarters_missing) == 0
                }
            },
            "exercises": [
                {
                    "id": ex.get("id", ""),
                    "title": ex.get("title", ""),
                    "type": ex.get("type", ""),
                    "date": ex.get("date", ""),
                    "status": ex.get("status", ""),
                    "rating": ex.get("after_action", {}).get("overall_rating", ""),
                    "finding_count": len(ex.get("findings", [])),
                    "action_count": len(ex.get("action_items", []))
                }
                for ex in exercises
            ],
            "open_action_items": [
                {
                    "exercise": a["_exercise"],
                    "id": a.get("id", ""),
                    "description": a.get("description", ""),
                    "assignee": a.get("assignee", ""),
                    "due_date": a.get("due_date", ""),
                    "status": a.get("status", "")
                }
                for a in all_actions if a.get("status") in ("open", "in-progress")
            ]
        }
    }
    print(json.dumps(output, indent=2))
else:
    print()
    print("SRE Platform -- Exercise Completion Report")
    print("=" * 78)
    print(f"  Generated: {datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}")
    if filter_year:
        print(f"  Year filter: {filter_year}")
    print()

    # Summary
    print("SUMMARY")
    print("-" * 78)
    print(f"  Exercises:        {total} total ({completed} completed, {planned} planned, {cancelled} cancelled)")
    print(f"  Findings:         {total_findings} total (C:{critical_findings} H:{high_findings} M:{medium_findings} L:{low_findings})")
    print(f"  Action Items:     {total_actions} total ({actions_complete} complete, {actions_inprogress} in-progress, {actions_open} open)")
    print()

    # Quarterly compliance
    print("QUARTERLY COMPLIANCE (NIST IR-3)")
    print("-" * 78)
    for q in quarters_required:
        status = "DONE" if q in quarters_with_exercise else "MISSING"
        symbol = "[x]" if q in quarters_with_exercise else "[ ]"
        print(f"  {symbol} Q{q} {current_year}: {status}")
    if quarters_missing:
        print(f"\n  WARNING: Missing exercises for Q{', Q'.join(str(q) for q in quarters_missing)} {current_year}")
    else:
        print(f"\n  All quarters through Q{current_quarter} {current_year} have completed exercises.")
    print()

    # Exercise details
    print("EXERCISES")
    print("-" * 78)
    for ex in exercises:
        status = ex.get("status", "unknown")
        status_icon = {"completed": "[DONE]", "planned": "[PLAN]", "cancelled": "[CANC]"}.get(status, "[????]")
        rating = ex.get("after_action", {}).get("overall_rating", "")
        rating_str = f" ({rating})" if rating else ""
        findings = len(ex.get("findings", []))
        actions = len(ex.get("action_items", []))

        print(f"  {status_icon} {ex.get('id', '???')} - {ex.get('title', '???')}")
        print(f"         Date: {ex.get('date', '???')} | Type: {ex.get('type', '???')}{rating_str}")
        print(f"         Findings: {findings} | Action Items: {actions}")
        print()

    # Open action items
    open_items = [a for a in all_actions if a.get("status") in ("open", "in-progress")]
    if open_items:
        print("OPEN ACTION ITEMS")
        print("-" * 78)
        for a in open_items:
            overdue = ""
            due = a.get("due_date", "")
            if due:
                try:
                    due_dt = datetime.strptime(due, "%Y-%m-%d")
                    if due_dt < datetime.now():
                        overdue = " ** OVERDUE **"
                except ValueError:
                    pass
            print(f"  [{a.get('status', '???').upper():11s}] {a.get('id', '???')} (from {a['_exercise']})")
            print(f"               {a.get('description', '???')}")
            print(f"               Assignee: {a.get('assignee', '???')} | Due: {due}{overdue}")
            print()
    else:
        print("OPEN ACTION ITEMS")
        print("-" * 78)
        print("  No open action items. All exercise findings have been addressed.")
        print()

    print("=" * 78)
    print()
PYEOF
