# Scripts

Utility scripts for deploying, managing, and securing the SRE platform.

## Quick Start

```bash
# Deploy SRE to a fresh Proxmox host (interactive, guided)
./scripts/quickstart-proxmox.sh

# Show platform status and credentials
./scripts/sre-access.sh

# Deploy an app
./scripts/sre-deploy-app.sh
```

## Deployment & Bootstrap

| Script | Purpose |
|--------|---------|
| `quickstart-proxmox.sh` | Zero-touch deployment to Proxmox VE — handles everything from VM provisioning to Flux bootstrap |
| `bootstrap.sh` | Bootstrap Flux CD on an existing RKE2 cluster |
| `bootstrap-secrets.sh` | Generate random passwords and create K8s secrets for platform components |
| `sre-deploy.sh` | Post-bootstrap platform configuration |
| `verify-deployment.sh` | Verify all platform services are healthy |
| `init-openbao.sh` | Initialize and unseal OpenBao secrets vault |

## Application Management

| Script | Purpose |
|--------|---------|
| `sre-deploy-app.sh` | Interactive app deployment to the platform |
| `deploy-from-git.sh` | Deploy an app directly from a Git repository |
| `generate-app.sh` | Scaffold a new application with Helm chart and CI pipeline |
| `build-app.sh` | Build and push container images to Harbor |
| `sre-bundle.sh` | Bundle deployment (Docker Compose to SRE) |
| `sre-compat-check.sh` | Check app compatibility with SRE requirements |
| `preview-env.sh` | Create preview environments for PR testing |

## Tenant & Team Management

| Script | Purpose |
|--------|---------|
| `onboard-tenant.sh` | Full tenant onboarding: namespace, RBAC, network policies, Harbor project |
| `onboard-team.sh` | Onboard a new team with Keycloak groups and RBAC |
| `sre-new-tenant.sh` | Quick tenant namespace creation |

## SSO & Identity

| Script | Purpose |
|--------|---------|
| `configure-keycloak-sso.sh` | Create OIDC clients in Keycloak for all platform services |
| `configure-keycloak-oauth2-redirects.sh` | Configure OAuth2 redirect URIs in Keycloak |
| `configure-neuvector-sso.sh` | Configure NeuVector OIDC integration |

## Security & Compliance

| Script | Purpose |
|--------|---------|
| `compliance-report.sh` | Generate compliance assessment report |
| `generate-ato-package.sh` | Generate ATO documentation package |
| `generate-ssp.sh` | Generate OSCAL System Security Plan |
| `generate-ssp-narrative.sh` | Generate SSP narrative sections |
| `generate-cosign-keypair.sh` | Generate Cosign key pair for image signing |
| `export-compliance-snapshot.sh` | Export compliance state snapshot |
| `control-validation-tests.sh` | Run NIST 800-53 control validation tests |
| `validate-compliance-refs.sh` | Validate compliance reference annotations |
| `quarterly-stig-scan.sh` | Run quarterly DISA STIG scan |
| `rbac-audit.sh` | Audit RBAC permissions across the cluster |
| `security-pentest.sh` | Automated security penetration testing |
| `generate-ao-summary.sh` | Generate Authorizing Official summary |
| `oscal-to-emass.sh` | Convert OSCAL artifacts to eMASS format |
| `poam-check.sh` | Check Plan of Action and Milestones status |
| `generate-data-flow.sh` | Generate data flow diagrams |

## Operations

| Script | Purpose |
|--------|---------|
| `sre-access.sh` | Show service URLs, credentials, and port-forward management |
| `morning-health-check.sh` | Daily platform health check |
| `rotate-secrets.sh` | Rotate platform secrets |
| `upgrade-platform.sh` | Rolling platform upgrade procedure |
| `dr-test.sh` | Disaster recovery test |
| `setup-notifications.sh` | Configure alerting notifications |
| `exercise-report.sh` | Generate exercise/drill report |

## Air-Gap

| Script | Purpose |
|--------|---------|
| `airgap-mirror-images.sh` | Mirror container images for air-gap deployment |
| `airgap-export-bundle.sh` | Export platform bundle for air-gap installation |

## Taskfile Integration

Several scripts are also available via the Taskfile:

```bash
task bootstrap-flux REPO_URL=https://github.com/org/sre-platform
task validate
```
