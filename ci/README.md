# SRE Platform CI/CD Pipeline Templates

This directory contains reusable CI/CD pipeline templates for building, scanning, signing, and deploying container images to the SRE platform.

## How the Pipeline Works

The CI/CD flow follows a secure supply chain pattern:

```
Developer pushes tag (v1.2.3)
    |
    v
[1] Build container image (Docker Buildx)
    |
    v
[2] Scan with Trivy (fail on CRITICAL vulnerabilities)
    |
    v
[3] Generate SBOM with Syft (SPDX JSON format)
    |
    v
[4] Push image to Harbor registry
    |
    v
[5] Sign image with Cosign (key-based signing)
    |
    v
[6] Attach SBOM as Cosign attestation
    |
    v
[7] Update image tag in GitOps repo (sre-platform)
    |
    v
[8] Flux CD detects change and reconciles
    |
    v
[9] App is deployed to the cluster
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
        repository: "harbor.sre.internal/team-alpha/my-app"
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

## Workflow Files

| File | Purpose |
|------|---------|
| `github-actions/build-scan-deploy.yaml` | Reusable workflow: build, scan, sign, push |
| `github-actions/update-gitops.yaml` | Reusable workflow: update image tag in GitOps repo |
| `github-actions/example-caller.yaml` | Example: how to call both workflows from your app repo |
| `github-actions/preview-environment.yaml` | PR-based ephemeral preview environments |
| `gitlab-ci/build-scan-deploy.gitlab-ci.yml` | GitLab CI equivalent of the GitHub Actions pipeline |

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

## Security Controls

This pipeline implements the following NIST 800-53 controls:

| Control | Implementation |
|---------|---------------|
| SA-10 (Developer Configuration Management) | All changes tracked in Git via GitOps |
| SA-11 (Developer Testing and Evaluation) | Trivy vulnerability scan gates the build |
| SI-7 (Software Integrity) | Cosign image signatures verified by Kyverno |
| RA-5 (Vulnerability Scanning) | Trivy scans every image before deployment |
| CM-2 (Baseline Configuration) | SBOM generated and attached for every image |
| AU-2 (Audit Events) | GitHub Actions provides full audit trail |

## Troubleshooting

### Trivy scan fails

Check the scan output for specific CVEs. Options:
- Update base image to patch the vulnerability
- If the CVE is a false positive, add it to a `.trivyignore` file in your app repo
- Temporarily lower the severity threshold (not recommended for production)

### Cosign signing fails

- Verify `COSIGN_PRIVATE_KEY` secret contains the full key including header/footer
- Verify `COSIGN_PASSWORD` matches what was used during `cosign generate-key-pair`
- Ensure the image was successfully pushed to Harbor before signing

### GitOps update fails

- Verify `GITOPS_TOKEN` has write access to the sre-platform repo
- Verify the app manifest exists at `apps/tenants/<team>/apps/<app-name>.yaml`
- Check that the YAML structure matches the expected format (see Step 1 above)

### Flux does not deploy after GitOps update

- Check Flux reconciliation status: `flux get helmreleases -A`
- Force reconciliation: `flux reconcile helmrelease <name> -n <namespace>`
- Check for Kyverno policy violations: `kubectl get policyreport -n <namespace>`
- Verify the image signature matches the public key in the Kyverno policy
