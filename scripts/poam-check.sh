#!/usr/bin/env bash
# ============================================================================
# SRE Platform — POA&M (Plan of Action and Milestones) Checker
# ============================================================================
# Reads compliance/poam/findings.yaml and reports on overdue findings,
# findings approaching their target resolution date, and overall status.
#
# Usage:
#   ./scripts/poam-check.sh                    # Human-readable report
#   ./scripts/poam-check.sh --json             # Machine-readable JSON output
#   ./scripts/poam-check.sh --warn-days 30     # Custom warning threshold (default: 30)
#
# NIST Controls: CA-5 (Plan of Action and Milestones), PM-4 (POA&M Process)
# ============================================================================

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FINDINGS_FILE="${REPO_ROOT}/compliance/poam/findings.yaml"
JSON_OUTPUT=false
WARN_DAYS=30

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)       JSON_OUTPUT=true; shift ;;
        --warn-days)  WARN_DAYS="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--json] [--warn-days N]"
            echo "  --json           Output machine-readable JSON"
            echo "  --warn-days N    Days before target to warn (default: 30)"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Prerequisites ───────────────────────────────────────────────────────────
if [[ ! -f "$FINDINGS_FILE" ]]; then
    echo "ERROR: Findings file not found: ${FINDINGS_FILE}" >&2
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 is required" >&2
    exit 1
fi

# Check if PyYAML is available, fall back to basic parsing
HAVE_YAML=false
if python3 -c "import yaml" 2>/dev/null; then
    HAVE_YAML=true
fi

# ── Main ────────────────────────────────────────────────────────────────────
python3 <<PYEOF
import json, sys
from datetime import datetime, timedelta

WARN_DAYS = ${WARN_DAYS}
JSON_OUTPUT = ${JSON_OUTPUT}
HAVE_YAML = ${HAVE_YAML}

# Parse findings
findings_file = "${FINDINGS_FILE}"

if HAVE_YAML:
    import yaml
    with open(findings_file) as f:
        data = yaml.safe_load(f)
else:
    # Minimal YAML parser for this specific structure
    import re
    with open(findings_file) as f:
        content = f.read()

    # Use a simple regex-based approach for the known structure
    findings = []
    current = {}
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('- id:'):
            if current:
                findings.append(current)
            current = {'id': stripped.split('"')[1]}
        elif stripped.startswith('title:'):
            current['title'] = stripped.split('"')[1] if '"' in stripped else stripped.split(': ', 1)[1].strip('"')
        elif stripped.startswith('severity:'):
            current['severity'] = stripped.split(': ', 1)[1].strip()
        elif stripped.startswith('status:'):
            current['status'] = stripped.split(': ', 1)[1].strip()
        elif stripped.startswith('component:'):
            current['component'] = stripped.split(': ', 1)[1].strip()
        elif stripped.startswith('target_resolution:'):
            current['target_resolution'] = stripped.split('"')[1] if '"' in stripped else stripped.split(': ', 1)[1].strip('"')
        elif stripped.startswith('date_identified:'):
            current['date_identified'] = stripped.split('"')[1] if '"' in stripped else stripped.split(': ', 1)[1].strip('"')
        elif stripped.startswith('assignee:'):
            current['assignee'] = stripped.split(': ', 1)[1].strip()
    if current:
        findings.append(current)
    data = {'findings': findings}

findings = data.get('findings', [])
now = datetime.now()
warn_date = now + timedelta(days=WARN_DAYS)

overdue = []
approaching = []
on_track = []
resolved = []
risk_accepted = []

for f in findings:
    status = f.get('status', 'unknown')
    finding_id = f.get('id', 'unknown')
    title = f.get('title', 'no title')
    severity = f.get('severity', 'unknown')
    target = f.get('target_resolution', '')
    component = f.get('component', 'unknown')
    assignee = f.get('assignee', 'unassigned')

    if status == 'resolved':
        resolved.append(f)
        continue

    if status == 'risk-accepted':
        risk_accepted.append(f)
        continue

    if not target:
        on_track.append(f)
        continue

    try:
        target_date = datetime.strptime(target, '%Y-%m-%d')
    except ValueError:
        on_track.append(f)
        continue

    if target_date < now:
        overdue.append(f)
    elif target_date < warn_date:
        approaching.append(f)
    else:
        on_track.append(f)

if JSON_OUTPUT:
    result = {
        'check_date': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'warn_threshold_days': WARN_DAYS,
        'summary': {
            'total': len(findings),
            'overdue': len(overdue),
            'approaching': len(approaching),
            'on_track': len(on_track),
            'resolved': len(resolved),
            'risk_accepted': len(risk_accepted)
        },
        'overdue_findings': [
            {
                'id': f.get('id'),
                'title': f.get('title'),
                'severity': f.get('severity'),
                'target_resolution': f.get('target_resolution'),
                'component': f.get('component'),
                'assignee': f.get('assignee')
            }
            for f in overdue
        ],
        'approaching_findings': [
            {
                'id': f.get('id'),
                'title': f.get('title'),
                'severity': f.get('severity'),
                'target_resolution': f.get('target_resolution'),
                'component': f.get('component'),
                'assignee': f.get('assignee')
            }
            for f in approaching
        ]
    }
    print(json.dumps(result, indent=2))
else:
    print('')
    print('\033[1m\033[36mSRE Platform — POA&M Status Report\033[0m')
    print(f'Check date: {now.strftime("%Y-%m-%d %H:%M")}')
    print(f'Warning threshold: {WARN_DAYS} days')
    print('=' * 70)

    if overdue:
        print('')
        print('\033[1m\033[31mOVERDUE FINDINGS:\033[0m')
        for f in overdue:
            days_overdue = (now - datetime.strptime(f['target_resolution'], '%Y-%m-%d')).days
            print(f'  \033[31m{f["id"]}\033[0m [{f.get("severity", "?")}] {f.get("title", "?")}')
            print(f'         Target: {f["target_resolution"]} ({days_overdue} days overdue)')
            print(f'         Component: {f.get("component", "?")} | Assignee: {f.get("assignee", "?")}')

    if approaching:
        print('')
        print('\033[1m\033[33mAPPROACHING TARGET DATE:\033[0m')
        for f in approaching:
            days_left = (datetime.strptime(f['target_resolution'], '%Y-%m-%d') - now).days
            print(f'  \033[33m{f["id"]}\033[0m [{f.get("severity", "?")}] {f.get("title", "?")}')
            print(f'         Target: {f["target_resolution"]} ({days_left} days remaining)')
            print(f'         Component: {f.get("component", "?")} | Assignee: {f.get("assignee", "?")}')

    if on_track:
        print('')
        print('\033[1m\033[32mON TRACK:\033[0m')
        for f in on_track:
            print(f'  \033[32m{f["id"]}\033[0m [{f.get("severity", "?")}] {f.get("title", "?")} — {f.get("status", "?")}')

    if risk_accepted:
        print('')
        print('\033[1mRISK ACCEPTED:\033[0m')
        for f in risk_accepted:
            print(f'  {f["id"]} [{f.get("severity", "?")}] {f.get("title", "?")}')

    if resolved:
        print('')
        print('\033[1m\033[32mRESOLVED:\033[0m')
        for f in resolved:
            print(f'  \033[32m{f["id"]}\033[0m {f.get("title", "?")}')

    print('')
    print('=' * 70)
    print(f'  Total findings:    {len(findings)}')
    print(f'  \033[31mOverdue:           {len(overdue)}\033[0m')
    print(f'  \033[33mApproaching:       {len(approaching)}\033[0m')
    print(f'  \033[32mOn track:          {len(on_track)}\033[0m')
    print(f'  Risk accepted:     {len(risk_accepted)}')
    print(f'  \033[32mResolved:          {len(resolved)}\033[0m')
    print('=' * 70)

    if overdue:
        print('')
        print('\033[31m\033[1mACTION REQUIRED: {} finding(s) are past their target resolution date.\033[0m'.format(len(overdue)))
        sys.exit(1)
    elif approaching:
        print('')
        print('\033[33mWARNING: {} finding(s) are approaching their target resolution date.\033[0m'.format(len(approaching)))
    else:
        print('')
        print('\033[32mAll findings are on track or resolved.\033[0m')
    print('')
PYEOF
