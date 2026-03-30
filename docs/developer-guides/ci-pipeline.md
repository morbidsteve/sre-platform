# CI Pipeline

## Overview

This guide covers how to get your container image built, scanned, signed, and deployed on the SRE platform. There are two paths depending on whether you want the platform to handle your entire build pipeline or you already have your own CI.

---

## Two Paths to Production

### Path A: Full DSOP Pipeline

The platform builds, scans, signs, and deploys your application for you. You provide a Git repository URL or an external image reference and the DSOP Wizard walks you through a 7-step flow that runs all 8 RAISE 2.0 security gates:

1. GATE 1 -- SAST (Semgrep)
2. GATE 2 -- SBOM generation (Syft)
3. GATE 3 -- Secrets detection (Gitleaks)
4. GATE 4 -- Container security scan (Trivy)
5. GATE 5 -- DAST (OWASP ZAP, post-deploy)
6. GATE 6 -- ISSM review (manual approval)
7. GATE 7 -- Image signing (Cosign)
8. GATE 8 -- Artifact storage (Harbor)

The wizard is available at `https://dsop-wizard.apps.sre.example.com`. You provide your source, configure resources and networking, and the platform handles everything else including the security audit trail.

Best for: first-time deployments, applications without existing CI, and cases where a full RAISE 2.0 audit trail is required from day one.

### Path B: Bring Your Own Image (BYOI)

You build and push your container image to Harbor using your own CI pipeline. The platform provides ready-made GitHub Actions and GitLab CI templates that handle scanning, SBOM generation, and Cosign signing. At admission time, Kyverno verifies the image signature before any pod is allowed to run.

Once the image is in Harbor, deploy it through any of the available methods: the portal Quick Deploy form, the DSOP Wizard in easy mode, or the CLI via an App Contract.

Best for: teams with existing CI, custom build requirements, and faster iteration cycles.

### Decision Tree

- Need the full security audit trail with ISSM review? Use Path A.
- Already have CI that builds your image? Use Path B.
- Not sure? Start with Path A. Switch to Path B once you are comfortable with the platform.

Both paths produce the same end state: a signed, scanned image running in a hardened namespace with mTLS, network policies, monitoring, and all the compliance controls the platform enforces.

---

## Setting Up Your CI Pipeline (Path B)

### Prerequisites

- A Dockerfile in your project repository
- A Harbor project for your team (created during tenant onboarding)
- A Harbor robot account with push and pull permissions
- A Cosign key pair for image signing

### Step 1: Create a Harbor Robot Account

1. Log in to Harbor at `https://harbor.apps.sre.example.com`.
2. Navigate to your project (for example, `team-alpha`).
3. Go to Robot Accounts, then click New Robot Account.
4. Set the name (for example, `ci-push`).
5. Grant push and pull permissions.
6. Save and copy the generated username and token. The username will look like `robot$team-alpha+ci-push`.

### Step 2: Generate a Cosign Key Pair

```bash
cosign generate-key-pair
```

This creates two files:

- `cosign.key` -- the private key. Store this as a CI secret. Do not commit it to your repository.
- `cosign.pub` -- the public key. Your platform admin adds this to the Kyverno `verify-image-signatures` policy so the cluster can verify images signed by your pipeline.

### Step 3: Copy the CI Template

The SRE platform provides pre-built CI templates under `ci/templates/`. Use the setup helper or copy the files manually.

**Using the setup helper:**

```bash
# From the SRE platform repo
cd ci/templates

# Interactive — prompts for team name and app name
./setup-ci.sh

# Or specify the CI system directly
./setup-ci.sh --github
./setup-ci.sh --gitlab
```

The helper copies the appropriate template to your project directory and substitutes your team and app names.

**Manual copy for GitHub Actions:**

```bash
mkdir -p /path/to/your-project/.github/workflows
cp ci/templates/github-actions/harbor-build.yaml \
   /path/to/your-project/.github/workflows/harbor-build.yaml
```

Edit the workflow and update the environment variables at the top:

```yaml
env:
  HARBOR_REGISTRY: "harbor.apps.sre.example.com"
  HARBOR_PROJECT: "team-alpha"      # Your team name
  IMAGE_NAME: "my-app"              # Your app name
```

**Manual copy for GitLab CI:**

```bash
cp ci/templates/gitlab-ci/harbor-build.gitlab-ci.yml \
   /path/to/your-project/.gitlab-ci.yml
```

Set the corresponding variables in your GitLab project CI/CD settings.

### Step 4: Add Secrets to Your CI System

**GitHub Actions** (Settings > Secrets and variables > Actions):

| Secret | Value |
|--------|-------|
| `HARBOR_USERNAME` | Robot account username (e.g., `robot$team-alpha+ci-push`) |
| `HARBOR_PASSWORD` | Robot account token |
| `COSIGN_PRIVATE_KEY` | Full contents of `cosign.key`, including the PEM header and footer |
| `COSIGN_PASSWORD` | Passphrase used during `cosign generate-key-pair` |

**GitLab CI** (Settings > CI/CD > Variables):

| Variable | Value | Options |
|----------|-------|---------|
| `HARBOR_REGISTRY` | `harbor.apps.sre.example.com` | |
| `HARBOR_PROJECT` | Your team name (e.g., `team-alpha`) | |
| `IMAGE_NAME` | Your application name (e.g., `my-app`) | |
| `HARBOR_USERNAME` | Robot account username | |
| `HARBOR_PASSWORD` | Robot account token | Masked |
| `COSIGN_PRIVATE_KEY` | Upload `cosign.key` | File variable |
| `COSIGN_PASSWORD` | Key passphrase | Masked |

### Step 5: Trigger the Pipeline

The pipeline triggers on version tag pushes matching the `v*` pattern:

```bash
git tag v1.0.0
git push origin v1.0.0
```

On pull requests against `main`, only the build and Trivy scan steps run. The image is not pushed, signed, or attested. This gives developers early feedback on build errors and vulnerabilities without producing artifacts.

---

## What the Pipeline Does

Each step in the pipeline runs a specific tool. The table below shows the order, what each step does, and what causes it to fail.

| Step | Tool | What It Does | Fails When |
|------|------|--------------|------------|
| Build | Docker Buildx | Builds the container image from your Dockerfile | Build errors, missing dependencies |
| Push | Docker | Pushes the image to your Harbor project | Authentication failure, project does not exist |
| Scan | Trivy | Scans the image for known CVEs | CRITICAL vulnerability found (configurable) |
| SBOM | Syft | Generates an SPDX 2.3 JSON software bill of materials | Generation failure (rare) |
| Sign | Cosign | Signs the image digest with your private key | Invalid key or wrong passphrase |
| Attest | Cosign | Attaches the SBOM as a signed attestation to the image | Invalid key or wrong passphrase |

The simple template (`ci/templates/`) runs these six steps. The full RAISE 2.0 pipeline (`ci/github-actions/build-scan-deploy.yaml`) adds three more gates on top: SAST via Semgrep, secrets detection via Gitleaks, and ISSM manual review. After deployment, it also runs a DAST scan via OWASP ZAP against the live application.

### Full RAISE 2.0 Pipeline (Optional Upgrade)

If your project requires the complete audit trail with all 8 security gates and ISSM review, use the full pipeline instead of the simple template. Copy the example caller workflow:

```bash
cp ci/github-actions/example-caller.yaml \
   /path/to/your-project/.github/workflows/ci.yaml
```

Update the `image-name`, `harbor-project`, and `target-url` fields to match your application. You will also need:

- A `GITOPS_TOKEN` secret: a GitHub PAT with write access to the sre-platform repository, so the pipeline can update your image tag in the GitOps repo after signing.
- A GitHub Environment named `issm-review` with required reviewers configured. This is the manual approval gate (GATE 6) where your security officer reviews scan results before the image is signed and deployed.

See the `ci/README.md` file for detailed setup instructions for the ISSM review environment and the full gate configuration.

---

## After Your Image Is in Harbor

Once your pipeline succeeds and the image is in Harbor, deploy it using one of these methods.

### Option 1: Portal Quick Deploy

Go to `https://portal.apps.sre.example.com`, click Quick Deploy, and fill out the form with your image, team, port, and resource requirements.

### Option 2: DSOP Wizard Easy Mode

Go to `https://dsop-wizard.apps.sre.example.com`, select Quick Deploy, configure your application settings, and review before deploying.

### Option 3: CLI with an App Contract

Write a short contract file describing your application:

```yaml
apiVersion: sre.io/v1alpha1
kind: AppContract
metadata:
  name: my-app
  team: team-alpha
spec:
  type: web-app
  image: harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0
  resources: small
  ingress: my-app.apps.sre.example.com
```

Then generate and commit the deployment manifests:

```bash
task deploy-app -- my-app.yaml
git add apps/tenants/team-alpha/apps/my-app.yaml
git commit -m "feat(team-alpha): deploy my-app v1.0.0"
git push
```

Flux reconciles automatically within its interval (default 10 minutes). The Kyverno `verify-image-signatures` policy verifies the Cosign signature at admission time. If the image is not signed with a trusted key, the pod is rejected.

See the [App Contract guide](app-contract.md) for the full contract schema and all available options.

---

## Troubleshooting

### Trivy found CRITICAL vulnerabilities

Check the scan output in your CI job logs for the specific CVE IDs. The most common fix is to update your base image to a version that includes the patch. If you are using an older base image, rebuild with a current release.

If a finding is a false positive (for example, a CVE that does not apply to your usage of the library), create a `.trivyignore` file in your project root:

```
# False positive — library is not used in a network context
CVE-2024-XXXXX
```

### Cosign signing failed

- Verify that `COSIGN_PRIVATE_KEY` contains the full PEM-encoded key, including `-----BEGIN ENCRYPTED COSIGN PRIVATE KEY-----` and `-----END ENCRYPTED COSIGN PRIVATE KEY-----`. This must be the file contents, not a file path.
- Verify that `COSIGN_PASSWORD` matches the passphrase you entered during `cosign generate-key-pair`.
- Test locally to isolate the issue:

```bash
cosign sign --key cosign.key harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0
```

### Harbor push denied

- Verify the robot account has push permission on your Harbor project.
- Verify that `HARBOR_USERNAME` and `HARBOR_PASSWORD` are set correctly in your CI secrets.
- Confirm the project exists in Harbor. Robot accounts cannot create projects.
- If using GitLab CI, verify that `HARBOR_REGISTRY` is set to `harbor.apps.sre.example.com` (no `https://` prefix).

### Kyverno rejected my pod -- image signature verification failed

This means the image exists in Harbor but was not signed with a key the platform trusts. Possible causes:

- The image was pushed manually without running the Cosign signing step.
- The Cosign public key configured in the Kyverno policy does not match the private key used to sign.
- The image digest changed after signing (for example, Harbor garbage collection removed the signature).

To verify that an image is signed:

```bash
cosign verify --key cosign.pub harbor.apps.sre.example.com/team-alpha/my-app:v1.0.0
```

If the public key has not been added to the platform, contact your platform admin to update the `verify-image-signatures` Kyverno policy with your `cosign.pub`.

### Pipeline succeeds but the image is not visible in Harbor

The simple template only pushes images on tag pushes matching `v*`. Pull request builds run the build and scan steps but do not push to Harbor. Verify that you pushed a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Flux does not deploy after the GitOps repo is updated

If you are using the full pipeline with the `update-gitops` workflow, the pipeline commits a new image tag to `apps/tenants/<team>/apps/<app-name>.yaml` in the sre-platform repo. Flux detects the change and reconciles.

If the deployment does not appear:

```bash
# Check Flux reconciliation status
flux get helmreleases -A

# Force immediate reconciliation
flux reconcile helmrelease <app-name> -n <team-namespace>

# Check for Kyverno policy violations
kubectl get policyreport -n <team-namespace>
```

If the HelmRelease shows an error, check that the image tag in the manifest matches a tag that actually exists in Harbor and that the image is signed.

---

## Reference

| Resource | Location |
|----------|----------|
| Simple GitHub Actions template | `ci/templates/github-actions/harbor-build.yaml` |
| Simple GitLab CI template | `ci/templates/gitlab-ci/harbor-build.gitlab-ci.yml` |
| Full RAISE 2.0 pipeline (GitHub Actions) | `ci/github-actions/build-scan-deploy.yaml` |
| DAST scan workflow | `ci/github-actions/dast-scan.yaml` |
| GitOps updater workflow | `ci/github-actions/update-gitops.yaml` |
| Example caller workflow | `ci/github-actions/example-caller.yaml` |
| CI setup helper script | `ci/templates/setup-ci.sh` |
| CI README with full gate details | `ci/README.md` |
| App Contract schema | [docs/developer-guides/app-contract.md](app-contract.md) |
| DSOP Wizard | `https://dsop-wizard.apps.sre.example.com` |
| Portal Quick Deploy | `https://portal.apps.sre.example.com` |
| Harbor registry | `https://harbor.apps.sre.example.com` |
