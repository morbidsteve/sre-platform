# Scripts

Utility scripts for bootstrapping and validating the SRE platform.

## Scripts

| Script | Purpose |
|--------|---------|
| `bootstrap.sh` | Initial cluster setup: installs Flux, applies base configuration |
| `validate-compliance.sh` | Runs automated STIG and CIS benchmark checks against the cluster |

## Usage

```bash
# Bootstrap a new cluster
./scripts/bootstrap.sh

# Run compliance validation
./scripts/validate-compliance.sh
```

These scripts are also available via the Taskfile:

```bash
task bootstrap-flux REPO_URL=https://github.com/org/sre-platform
task validate
```
