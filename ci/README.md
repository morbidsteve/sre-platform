# SRE Platform CI/CD Pipeline Templates

This directory contains reusable CI/CD pipeline templates that implement all **8 RAISE 2.0 Security Gates** for building, scanning, signing, and deploying container images to the SRE platform.

## How the Pipeline Works

The CI/CD flow implements all 8 RAISE 2.0 Security Gates:

```
Developer pushes tag (v1.2.3)
    |
    v
[GATE 3] Gitleaks — Scan for leaked secrets/credentials
    |
    v
[GATE 1] Semgrep — Static Application Security Testing (SAST)
    |
    v
[Build]  Docker Buildx — Build container image
    |
    v
[GATE 4] Trivy — Container Security Scanning (fail on CRITICAL)
    |
    v
[GATE 2] Syft — Generate SBOM (SPDX JSON + CycloneDX)
    |
    v
[GATE 6] ISSM Review — Manual approval gate (pipeline pauses)
    |
    v
[GATE 8] Harbor — Push image to artifact repository
    |
    v
[GATE 7] Cosign — Sign image + attach SBOM/SLSA attestations
    |
    v
[Deploy] Update GitOps repo → Flux CD reconciles → App deployed
    |
    v
[GATE 5] OWASP ZAP — Dynamic Application Security Testing (DAST)
```

Kyverno admission policies verify the Cosign signature before any pod is created,
ensuring only images that passed the full pipeline can run on the platform.

## Prerequisites

Before using these pipelines, you need:

### 1. Harbor Robot Account

Create a robot account in your Harbor project for CI/CD image push:

```bash
# In the Harbor UI:
# 1. Go to your project (e.g., team-alpha)
# 2. Robot Accounts > New Robot Account
# 3. Name: ci-push
# 4. Permissions: Push, Pull, Create Artifact Label
# 5. Save the generated username and token
```

### 2. Cosign Key Pair

Generate a Cosign key pair for image signing:

```bash
cosign generate-key-pair

# This creates:
#   cosign.key  (private key - store as GitHub secret)
#   cosign.pub  (public key - add to Kyverno imageVerify policy)
```

The public key must be configured in the Kyverno `verify-image-signatures` policy
so the cluster can verify images signed by your pipeline.

### 3. GitHub Secrets

Configure these secrets in your application repository (Settings > Secrets > Actions):

| Secret | Description |
|--------|-------------|
| `HARBOR_USERNAME` | Harbor robot account username (e.g., `robot$team-alpha+ci-push`) |
| `HARBOR_PASSWORD` | Harbor robot account token |
| `COSIGN_PRIVATE_KEY` | Contents of `cosign.key` |
| `COSIGN_PASSWORD` | Password used when generating the Cosign key pair |
| `GITOPS_TOKEN` | GitHub PAT with write access to the sre-platform repo |

### 4. App Manifest in the GitOps Repo

Your app must have a HelmRelease manifest in the sre-platform repo:

```
apps/tenants/<team>/apps/<app-name>.yaml
```

See the existing `apps/tenants/team-alpha/apps/demo-app.yaml` for a reference.

## Setting Up the ISSM Review Gate

The RAISE 2.0 pipeline includes an ISSM review gate (Gate 6) that pauses the pipeline
for security officer approval. This requires a GitHub Environment with required reviewers.

### Setup Steps

1. Go to your app repo → **Settings** → **Environments** → **New environment**
2. Name: `issm-review`
3. Under **Environment protection rules**, click **Required reviewers**
4. Add your ISSM or security reviewer's GitHub username
5. Optionally: under **Deployment branches**, select "Selected branches" and add `main`
6. Click **Save protection rules**

### How It Works

- The pipeline runs Gates 1-5 automatically (SAST, Secrets, SBOM, CVE, DAST)
- At Gate 6, GitHub Actions pauses and waits for a required reviewer to approve
- The reviewer sees the scan results summary in the deployment review
- After approval, Gate 7 (Image Signing) and Gate 8 (Deployment) proceed
- If no `issm-review` environment exists, Gate 6 will fail

### For the Reviewer

When notified of a pending review:
1. Go to the GitHub Actions run
2. Click "Review deployments"
3. Review the security scan summaries from previous gates
4. Approve or reject with a comment

## Setting Up a New Project

### Step 1: Create the app manifest in sre-platform

Create `apps/tenants/<team>/apps/<app-name>.yaml`:

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-app
  namespace: team-alpha
spec:
  interval: 10m
  chart:
    spec:
      chart: web-app
      version: "0.1.0"
      sourceRef:
        kind: HelmRepository
        name: sre-charts
        namespace: flux-system
      reconcileStrategy: Revision
  values:
    app:
      name: "my-app"
      team: "team-alpha"
      image:
        repository: "harbor.apps.sre.example.com/team-alpha/my-app"
        tag: "v1.0.0"
      port: 8080
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
    ingress:
      enabled: true
      host: "my-app.apps.sre.example.com"
```

### Step 2: Add the CI workflow to your app repo

Copy `ci/github-actions/example-caller.yaml` to your app repo at
`.github/workflows/ci.yaml` and update:

- `image-name`: your application name
- `harbor-project`: your team name in Harbor
- Update triggers as needed (tags, branches, etc.)

### Step 3: Configure GitHub secrets

Add the required secrets listed in the Prerequisites section above.

### Step 4: Push a tag to trigger the pipeline

```bash
git tag v1.0.0
git push origin v1.0.0
```

The pipeline will build, scan, sign, push, and update the GitOps repo.
Flux will deploy your app within its reconciliation interval (default: 10 minutes).

### 5. GitHub Environment for ISSM Review (GATE 6)

Create a GitHub Environment named `issm-review` with required reviewers.
See [Setting Up the ISSM Review Gate](#setting-up-the-issm-review-gate) for detailed instructions.

## Workflow Files

| File | Purpose |
|------|---------|
| `github-actions/build-scan-deploy.yaml` | Reusable workflow: all 8 security gates + sign + push |
| `github-actions/dast-scan.yaml` | Reusable workflow: OWASP ZAP DAST scanning (GATE 5) |
| `github-actions/update-gitops.yaml` | Reusable workflow: update image tag in GitOps repo |
| `github-actions/example-caller.yaml` | Example: how to call all workflows from your app repo |
| `github-actions/preview-environment.yaml` | PR-based preview environments + automatic DAST scan |
| `gitlab-ci/build-scan-deploy.gitlab-ci.yml` | GitLab CI equivalent with all 8 security gates |

## Customization

### Change the vulnerability scan threshold

By default, the pipeline fails on CRITICAL vulnerabilities. To also fail on HIGH:

```yaml
with:
  trivy-severity: "CRITICAL,HIGH"
```

### Use a different Dockerfile path

```yaml
with:
  dockerfile: "./build/Dockerfile.production"
  build-context: "."
```

### Create a PR instead of direct commit (recommended for production)

```yaml
deploy:
  uses: ./.github/workflows/update-gitops.yaml
  with:
    create-pr: true
```

This creates a PR in the sre-platform repo that must be reviewed and merged
before Flux deploys the change.

### Use a different Harbor registry

```yaml
with:
  harbor-registry: "registry.example.com"
```

## RAISE 2.0 Security Gates

| Gate | Tool | NIST Controls | Fail Criteria |
|------|------|---------------|---------------|
| GATE 1: SAST | Semgrep | SA-11 | ERROR-level findings |
| GATE 2: SBOM | Syft | CM-2 | Generation failure |
| GATE 3: Secrets | Gitleaks | IA-5 | Any secret detected |
| GATE 4: CSS | Trivy | RA-5 | CRITICAL findings (configurable) |
| GATE 5: DAST | OWASP ZAP | SA-11 | HIGH-risk alerts |
| GATE 6: ISSM Review | GitHub Environment | CA-2 | ISSM rejects |
| GATE 7: Signing | Cosign | SI-7 | Signing failure |
| GATE 8: Storage | Harbor | CM-8 | Push failure |

## Security Controls

This pipeline implements the following NIST 800-53 controls:

| Control | Implementation |
|---------|---------------|
| SA-10 (Developer Configuration Management) | All changes tracked in Git via GitOps |
| SA-11 (Developer Testing and Evaluation) | Semgrep SAST + Trivy CSS + ZAP DAST gate the build |
| SI-7 (Software Integrity) | Cosign image signatures verified by Kyverno |
| RA-5 (Vulnerability Scanning) | Trivy + Semgrep + ZAP scan every release |
| CM-2 (Baseline Configuration) | SBOM generated and attached for every image |
| AU-2 (Audit Events) | GitHub Actions provides full audit trail |
| IA-5 (Authenticator Management) | Gitleaks prevents credential leakage |
| CA-2 (Security Assessment) | ISSM review gate ensures human oversight |

## Troubleshooting

### Semgrep SAST scan fails (GATE 1)

- Review findings in GitHub Security tab > Code scanning alerts
- Fix the vulnerability in source code, or add a `# nosemgrep` inline comment for false positives
- Document any suppressed findings in your mitigation statements

### Gitleaks secrets scan fails (GATE 3)

- A secret was detected in your code or git history
- Rotate the exposed credential immediately
- Add the secret to `.gitleaksignore` only if it's a false positive (test data, etc.)
- Use OpenBao + ExternalSecret for all real credentials

### Trivy container scan fails (GATE 4)

- Check the scan output for specific CVEs
- Update base image to patch the vulnerability
- If the CVE is a false positive, add it to a `.trivyignore` file in your app repo
- Temporarily lower the severity threshold (not recommended for production)

### ISSM review is pending (GATE 6)

- The pipeline pauses at the `issm-review` job until an authorized reviewer approves
- Reviewers are configured in GitHub Settings > Environments > `issm-review`
- The ISSM should review all scan artifacts before approving
- See [Setting Up the ISSM Review Gate](#setting-up-the-issm-review-gate) for setup instructions

### Cosign signing fails (GATE 7)

- Verify `COSIGN_PRIVATE_KEY` secret contains the full key including header/footer
- Verify `COSIGN_PASSWORD` matches what was used during `cosign generate-key-pair`
- Ensure the image was successfully pushed to Harbor before signing

### DAST scan shows findings (GATE 5)

- ZAP baseline scan runs against the deployed app after Flux reconciles
- Review the HTML report in workflow artifacts
- HIGH findings should be fixed before the next release
- False positives can be suppressed via a ZAP rules file

### GitOps update fails

- Verify `GITOPS_TOKEN` has write access to the sre-platform repo
- Verify the app manifest exists at `apps/tenants/<team>/apps/<app-name>.yaml`
- Check that the YAML structure matches the expected format (see Step 1 above)

### Flux does not deploy after GitOps update

- Check Flux reconciliation status: `flux get helmreleases -A`
- Force reconciliation: `flux reconcile helmrelease <name> -n <namespace>`
- Check for Kyverno policy violations: `kubectl get policyreport -n <namespace>`
- Verify the image signature matches the public key in the Kyverno policy
