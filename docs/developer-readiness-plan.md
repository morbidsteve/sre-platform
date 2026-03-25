# Developer Readiness Implementation Plan

This document contains the complete plan to make the SRE platform ready for any arbitrary developer to self-service deploy their software. Work through the phases in order. Each task has exact file paths, what to change, and acceptance criteria.

**Goal:** A developer with basic container knowledge can go from "I have an app" to "it's running securely on SRE" without a platform engineer hand-holding them.

---

## Phase 1: Close Security Enforcement Gaps

These are the highest priority. Without these, the security posture described in docs doesn't match reality.

### Task 1.1: Generate Cosign Key Pair and Wire Up Image Verification

**Problem:** `policies/custom/verify-image-signatures.yaml` has `REPLACE_ME_WITH_COSIGN_PUBLIC_KEY` placeholder. The entire supply chain verification story is non-functional.

**Steps:**
1. Generate a Cosign key pair:
   ```bash
   cosign generate-key-pair
   ```
   This creates `cosign.key` (private) and `cosign.pub` (public).

2. Store the private key as a Kubernetes secret for CI/CD:
   ```bash
   kubectl create secret generic cosign-signing-key \
     --from-file=cosign.key=cosign.key \
     --from-literal=cosign.password=<PASSWORD> \
     -n tekton-pipelines
   ```

3. Store the private key in OpenBao for the CI/CD pipelines:
   ```bash
   kubectl exec -n openbao openbao-0 -- vault kv put sre/platform/cosign \
     private_key="$(cat cosign.key)" \
     password="<PASSWORD>"
   ```

4. Replace the placeholder in the Kyverno policy with the real public key:
   - **File:** `policies/custom/verify-image-signatures.yaml` (line 73)
   - **Replace:** `REPLACE_ME_WITH_COSIGN_PUBLIC_KEY` with the contents of `cosign.pub` (the base64-encoded public key between the BEGIN/END markers)

5. Update the test copy to match:
   - **File:** `policies/tests/verify-image-signatures/policy.yaml` (line 50)
   - **Replace:** Same placeholder with same public key

6. Change the policy from Audit to Enforce:
   - **File:** `policies/custom/verify-image-signatures.yaml` (line 23)
   - **Change:** `validationFailureAction: Audit` to `validationFailureAction: Enforce`

7. Do NOT store `cosign.key` in the Git repo. Add to `.gitignore` if not already there.

**Acceptance Criteria:**
- `cosign.pub` contents are in the Kyverno policy (no REPLACE_ME)
- Policy is set to `Enforce`
- `kyverno test policies/tests/verify-image-signatures/` passes
- Unsigned images are rejected when deployed to tenant namespaces

---

### Task 1.2: Switch restrict-image-registries to Enforce

**Problem:** `policies/custom/restrict-image-registries.yaml` is in Audit mode. Developers can pull images from anywhere.

**Steps:**
1. **File:** `policies/custom/restrict-image-registries.yaml` (line 21)
2. **Change:** `validationFailureAction: Audit` to `validationFailureAction: Enforce`
3. Review the allowed registries list in the policy. Current list allows:
   - `harbor.sre.internal/*`
   - `docker.io/*`
   - `ghcr.io/*`
   - `quay.io/*`
   - `cgr.dev/*`
   - `registry.k8s.io/*`
   - `*/*` (short Docker Hub names)

   For the lab environment, this broad list is acceptable. For production/ATO, narrow it to only `harbor.sre.internal/*` and `harbor.apps.sre.example.com/*`. For now, add `harbor.apps.sre.example.com/*` to the allowed list if it's not already there (this is the actual Harbor hostname in the lab).

4. Verify the test still passes: `kyverno test policies/tests/restrict-image-registries/`

**Acceptance Criteria:**
- Policy is `Enforce`
- `harbor.apps.sre.example.com/*` is in the allowed registries list
- Images from unlisted registries are rejected in tenant namespaces
- Platform namespaces (24 excluded) are unaffected

---

### Task 1.3: Switch require-security-context to Enforce

**Problem:** `policies/custom/require-security-context.yaml` is in Audit mode. Pods without security contexts can run.

**File:** `policies/custom/require-security-context.yaml` (line 21)
**Change:** `validationFailureAction: Audit` to `validationFailureAction: Enforce`

**Note:** The Helm chart templates (sre-web-app, sre-api-service, sre-worker, sre-cronjob) all inject proper security contexts via sre-lib. This policy catches anyone deploying raw manifests via kubectl without using the templates.

**Acceptance Criteria:**
- Policy is `Enforce`
- Pods without `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, and `capabilities.drop: ["ALL"]` are rejected in tenant namespaces
- Existing tenant deployments using Helm chart templates are unaffected

---

### Task 1.4: Switch require-probes to Enforce

**Problem:** `policies/custom/require-probes.yaml` is in Audit mode.

**File:** `policies/custom/require-probes.yaml` (line 21)
**Change:** `validationFailureAction: Audit` to `validationFailureAction: Enforce`

**Acceptance Criteria:**
- Policy is `Enforce`
- Pods without liveness and readiness probes are rejected in tenant namespaces

---

### Task 1.5: Switch Pod Security Standards Restricted Policies to Enforce

**Problem:** All 4 restricted PSS policies are Audit. These enforce the core Kubernetes security baseline for tenants.

**Files and changes (all the same change: Audit -> Enforce):**
- `policies/restricted/require-run-as-nonroot.yaml` (line 22)
- `policies/restricted/require-drop-all-capabilities.yaml` (line 24)
- `policies/restricted/disallow-privilege-escalation.yaml` (line 23)
- `policies/restricted/restrict-volume-types.yaml` (line 24 — keep as Audit if any tenant uses hostPath; otherwise Enforce)

**Important:** These policies already exclude all 24 platform namespaces. The Helm chart templates already comply. The risk is low because any app deployed via the SRE Helm charts will pass. Only raw `kubectl apply` deployments might break.

**Acceptance Criteria:**
- All 4 policies are `Enforce` (or `restrict-volume-types` stays Audit with a documented reason)
- All existing tenant deployments still running (no CrashLoops)
- `kyverno test policies/tests/` passes for all restricted policy tests

---

## Phase 2: Automate Tenant Onboarding End-to-End

### Task 2.1: Add Istio AuthorizationPolicy Generation to onboard-tenant.sh

**Problem:** The 5 Istio AuthorizationPolicies in `platform/core/istio-config/authorization-policies/tenants/` are hardcoded to team-alpha and team-beta only. New tenants created by onboard-tenant.sh don't get them. This means traffic from the Istio gateway, monitoring, and same-namespace can't reach pods in new tenant namespaces at the Istio L7 layer.

**Current hardcoded files (each contains entries for team-alpha and team-beta only):**
- `platform/core/istio-config/authorization-policies/tenants/default-deny.yaml`
- `platform/core/istio-config/authorization-policies/tenants/allow-gateway-ingress.yaml`
- `platform/core/istio-config/authorization-policies/tenants/allow-prometheus-scrape.yaml`
- `platform/core/istio-config/authorization-policies/tenants/allow-same-namespace.yaml`
- `platform/core/istio-config/authorization-policies/tenants/allow-istio-control-plane.yaml`

**Approach:** Modify `scripts/onboard-tenant.sh` to append entries to these 5 files for each new tenant. Each file uses multi-document YAML (separated by `---`). The pattern is identical per tenant, just the `namespace:` field changes.

**Steps:**
1. Read the existing files to understand the exact YAML structure per tenant
2. In `scripts/onboard-tenant.sh`, after the existing manifest generation, add a function that appends a new YAML document to each of the 5 files with the new tenant's namespace
3. The entries to append are:

For **default-deny.yaml**, append:
```yaml
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: default-deny
  namespace: <TENANT_NAME>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-3, AC-4, SC-7"
spec: {}
```

For **allow-gateway-ingress.yaml**, append:
```yaml
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-gateway-ingress
  namespace: <TENANT_NAME>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-4, SC-7"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
```

For **allow-prometheus-scrape.yaml**, append:
```yaml
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: <TENANT_NAME>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AU-2, SI-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - monitoring
      to:
        - operation:
            ports:
              - "8080"
              - "9090"
              - "15014"
              - "15090"
```

For **allow-same-namespace.yaml**, append:
```yaml
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-same-namespace
  namespace: <TENANT_NAME>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "AC-4"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - <TENANT_NAME>
```

For **allow-istio-control-plane.yaml**, append:
```yaml
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: allow-istio-control-plane
  namespace: <TENANT_NAME>
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/policy-type: authorization
  annotations:
    sre.io/nist-controls: "SC-8, IA-3"
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - istio-system
```

4. Also generate these for any existing tenants that are missing them. Check `apps/tenants/kustomization.yaml` for the list of active tenants and ensure all of them have entries in these 5 files. Currently team-keystone, ws2, ws22222 are missing.

5. Make the script idempotent — check if an entry for the tenant already exists before appending (grep for `namespace: <TENANT_NAME>` in each file).

**Acceptance Criteria:**
- Running `./scripts/onboard-tenant.sh team-gamma` creates Istio AuthorizationPolicy entries in all 5 files
- Running the script again for the same tenant does not create duplicates
- All existing tenants (team-alpha, team-beta, team-keystone, ws2, ws22222) have entries in all 5 files
- After Flux reconciles, `kubectl get authorizationpolicies -n <tenant>` shows 5 policies

---

### Task 2.2: Add Keycloak Group Creation to onboard-tenant.sh

**Problem:** After running onboard-tenant.sh, RBAC RoleBindings reference Keycloak groups (`<team>-developers`, `<team>-viewers`) that don't exist. kubectl access won't work until someone manually creates them.

**Steps:**
1. In `scripts/onboard-tenant.sh`, add a function that creates the 2 Keycloak groups via the Keycloak Admin REST API.

2. The Keycloak Admin API is available at:
   ```
   https://keycloak.apps.sre.example.com/admin/realms/sre/groups
   ```

3. First, obtain an admin token:
   ```bash
   KC_TOKEN=$(curl -s -X POST \
     "https://keycloak.apps.sre.example.com/realms/master/protocol/openid-connect/token" \
     -d "client_id=admin-cli" \
     -d "username=admin" \
     -d "password=03F2tLffxi" \
     -d "grant_type=password" \
     | jq -r '.access_token')
   ```

4. Then create each group:
   ```bash
   curl -s -X POST \
     "https://keycloak.apps.sre.example.com/admin/realms/sre/groups" \
     -H "Authorization: Bearer ${KC_TOKEN}" \
     -H "Content-Type: application/json" \
     -d "{\"name\": \"${TENANT_NAME}-developers\"}"

   curl -s -X POST \
     "https://keycloak.apps.sre.example.com/admin/realms/sre/groups" \
     -H "Authorization: Bearer ${KC_TOKEN}" \
     -H "Content-Type: application/json" \
     -d "{\"name\": \"${TENANT_NAME}-viewers\"}"
   ```

5. Handle gracefully if Keycloak is unreachable (same pattern as the existing Harbor API call in the script).

6. Handle gracefully if groups already exist (409 Conflict response).

**Important:** The Keycloak admin password (`03F2tLffxi`) is already used in existing scripts (`scripts/configure-keycloak-sso.sh`). Follow the same pattern. Do not introduce a new credential management approach.

**Acceptance Criteria:**
- Running `./scripts/onboard-tenant.sh team-gamma` creates `team-gamma-developers` and `team-gamma-viewers` groups in the Keycloak SRE realm
- Running the script again does not fail (idempotent)
- Groups appear in Keycloak Admin Console under SRE realm > Groups
- If Keycloak is unreachable, the script warns but continues

---

### Task 2.3: Add Harbor Robot Account Creation to onboard-tenant.sh

**Problem:** The script creates a Harbor project but not a robot account for CI/CD. Developers need a robot account to push images.

**Steps:**
1. After the Harbor project creation step in `scripts/onboard-tenant.sh`, add a robot account creation call:
   ```bash
   ROBOT_RESPONSE=$(curl -s -X POST \
     "https://harbor.apps.sre.example.com/api/v2.0/robots" \
     -u "admin:Harbor12345" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "'${TENANT_NAME}'-ci-push",
       "duration": -1,
       "level": "project",
       "permissions": [{
         "namespace": "'${TENANT_NAME}'",
         "kind": "project",
         "access": [
           {"resource": "repository", "action": "push"},
           {"resource": "repository", "action": "pull"},
           {"resource": "artifact", "action": "read"},
           {"resource": "tag", "action": "create"},
           {"resource": "tag", "action": "list"}
         ]
       }]
     }')
   ```

2. Parse and display the robot account name and secret from the response:
   ```bash
   ROBOT_NAME=$(echo "$ROBOT_RESPONSE" | jq -r '.name')
   ROBOT_SECRET=$(echo "$ROBOT_RESPONSE" | jq -r '.secret')
   echo "Harbor robot account created:"
   echo "  Username: ${ROBOT_NAME}"
   echo "  Password: ${ROBOT_SECRET}"
   echo "  IMPORTANT: Save this password now. It cannot be retrieved later."
   ```

3. Store the robot credentials in OpenBao for the tenant:
   ```bash
   kubectl exec -n openbao openbao-0 -- vault kv put \
     sre/${TENANT_NAME}/harbor-robot \
     username="${ROBOT_NAME}" \
     password="${ROBOT_SECRET}"
   ```

4. Handle gracefully if Harbor is unreachable or robot already exists.

**Acceptance Criteria:**
- Running `./scripts/onboard-tenant.sh team-gamma` creates a robot account `robot$team-gamma+ci-push` in the `team-gamma` Harbor project
- Robot credentials are stored in OpenBao at `sre/team-gamma/harbor-robot`
- Robot credentials are printed to stdout for the user to save
- Script is idempotent (doesn't fail if robot exists)

---

## Phase 3: Fix CI/CD Pipeline Defaults

### Task 3.1: Fix Harbor Registry Hostname Mismatch

**Problem:** The CI/CD pipeline defaults to `harbor.sre.internal` but the actual deployment uses `harbor.apps.sre.example.com`.

**Files to change:**
1. `ci/github-actions/build-scan-deploy.yaml` (line 51) — change default from `harbor.sre.internal` to `harbor.apps.sre.example.com`
2. `ci/github-actions/update-gitops.yaml` (line 48) — change default from `harbor.sre.internal` to `harbor.apps.sre.example.com`

**Acceptance Criteria:**
- Default registry matches the actual Harbor deployment
- Existing example-caller.yaml still works without changes

---

### Task 3.2: Add Registry Validation to sre-deploy-app.sh

**Problem:** `scripts/sre-deploy-app.sh` allows deploying images from any registry, but Kyverno policy requires Harbor.

**File:** `scripts/sre-deploy-app.sh`

**Steps:**
1. Find the section where IMAGE_REPO is set (around line 338)
2. Add validation that IMAGE_REPO starts with `harbor.sre.internal/` or `harbor.apps.sre.example.com/`
3. If it doesn't, print a warning:
   ```
   WARNING: Image repository '${IMAGE_REPO}' is not from an approved Harbor registry.
   Kyverno policy will reject this deployment. Use harbor.apps.sre.example.com/<project>/<image>
   ```
4. Still allow the deploy (don't hard-block) since the user might have a legitimate reason and Kyverno will catch it anyway

**Acceptance Criteria:**
- Script warns when image is not from Harbor
- Script does not block the deploy (Kyverno handles enforcement)

---

### Task 3.3: Document ISSM Review Gate Setup

**Problem:** The ISSM review gate in build-scan-deploy.yaml requires a GitHub Environment named `issm-review` with required reviewers, but there's no documentation on how to set it up.

**File to update:** `ci/README.md`

**Add a new section after the "Prerequisites" section titled "Setting Up the ISSM Review Gate" with:**
1. Go to your app repo > Settings > Environments > New environment
2. Name: `issm-review`
3. Add required reviewers (your ISSM or security reviewer)
4. Optionally add deployment branch rules (only allow from `main`)
5. The pipeline will pause at Gate 6 and wait for one of the required reviewers to approve in the GitHub Actions UI
6. If no `issm-review` environment exists, the gate will fail

**Acceptance Criteria:**
- ci/README.md has clear step-by-step for setting up the ISSM review environment
- Referenced from both ci/README.md prerequisites and the Gate 6 section

---

## Phase 4: Resolve REPLACE_ME Placeholders in Live Manifests

These are files in paths that Flux manages or that are applied to the cluster. They need real values or need to be moved to ExternalSecrets/OpenBao.

### Task 4.1: Tekton Webhook Secrets

**Problem:** Tekton trigger secrets have placeholder values.

**Files:**
- `ci/tekton/triggers/github-webhook.yaml` (lines 420, 434) — `REPLACE_ME_WITH_GITHUB_WEBHOOK_SECRET`, `REPLACE_ME_WITH_GITHUB_TOKEN`
- `ci/tekton/triggers/gitlab-webhook.yaml` (lines 353, 367) — `REPLACE_ME_WITH_GITLAB_WEBHOOK_SECRET`, `REPLACE_ME_WITH_GITLAB_TOKEN`

**Approach:** These secrets should NOT have real values in Git. Convert them to ExternalSecrets that sync from OpenBao.

**Steps:**
1. For each Secret in these files, replace the inline `stringData` with an ExternalSecret that syncs from OpenBao path `sre/platform/tekton/<secret-name>`
2. Remove the Secret resources from the trigger YAML files
3. Create ExternalSecret resources in their place:
   ```yaml
   apiVersion: external-secrets.io/v1beta1
   kind: ExternalSecret
   metadata:
     name: github-webhook-secret
     namespace: tekton-pipelines
   spec:
     refreshInterval: 1h
     secretStoreRef:
       name: openbao-backend
       kind: ClusterSecretStore
     target:
       name: github-webhook-secret
     data:
       - secretKey: secret
         remoteRef:
           key: sre/platform/tekton/github-webhook
           property: secret
   ```
4. Do the same for `github-token`, `gitlab-webhook-secret`, `gitlab-token`
5. Document that these values must be seeded in OpenBao before Tekton triggers work

**Acceptance Criteria:**
- No REPLACE_ME values in tekton trigger files
- ExternalSecrets created for all 4 secrets
- Documentation added to ci/README.md explaining how to seed these values in OpenBao

---

### Task 4.2: Flux Image Automation Credentials

**Problem:** `platform/core/config/flux-image-automation.yaml` has REPLACE_ME for Harbor credentials.

**File:** `platform/core/config/flux-image-automation.yaml` (lines 83-84)

**Approach:** Same as Task 4.1 — replace inline Secret with ExternalSecret syncing from OpenBao.

**Steps:**
1. Replace the Secret containing `REPLACE_ME_HARBOR_USER` and `REPLACE_ME_HARBOR_PASSWORD` with an ExternalSecret
2. The ExternalSecret should sync from `sre/platform/harbor-robot` in OpenBao
3. Generate a `.dockerconfigjson` format secret

**Acceptance Criteria:**
- No REPLACE_ME values in the file
- Harbor credentials synced from OpenBao via ExternalSecret

---

### Task 4.3: Flux Notification Slack Webhook

**Problem:** `platform/core/config/flux-notifications.yaml` has REPLACE_ME for Slack webhook.

**File:** `platform/core/config/flux-notifications.yaml` (line 92)

**Approach:** Replace with ExternalSecret from OpenBao, OR comment out the notification provider with a note explaining that Slack notifications are optional and how to configure them.

**Steps:**
1. If Slack integration is not currently used: comment out the Secret and notification Provider, add a comment explaining how to enable it
2. If Slack integration is desired: convert to ExternalSecret from `sre/platform/slack/webhook-url`

**Acceptance Criteria:**
- No REPLACE_ME in the file
- Either ExternalSecret or clearly documented as "configure when needed"

---

### Task 4.4: Velero Backup S3 URL

**Problem:** `platform/core/backup/helmrelease.yaml` has REPLACE_ME for S3 URL.

**File:** `platform/core/backup/helmrelease.yaml` (line 63)

**Steps:**
1. If MinIO or S3-compatible storage is deployed, set the real URL
2. If no object storage is available in the lab, either:
   a. Comment out the backup storage location with a note, OR
   b. Set it to a MinIO endpoint if one exists in the cluster

**Note:** Check if MinIO is deployed: `kubectl get pods -A | grep minio`

**Acceptance Criteria:**
- No REPLACE_ME in the file
- Velero either has a working S3 endpoint or the configuration is clearly marked as needing setup

---

## Phase 5: Consolidate Developer Documentation

### Task 5.1: Create Developer Roadmap Entry Point

**Problem:** 4 developer docs exist with overlapping content and no clear "start here" signpost. A new developer doesn't know which to read first.

**Create new file:** `docs/README.md`

This should be a short (under 50 lines) navigation document with:

```markdown
# SRE Platform Documentation

## For Developers

**New to SRE? Start here:**

1. **[Getting Started](getting-started-developer.md)** — Install tools, get credentials, connect to the cluster (~30 min)
2. **[Developer Guide](developer-guide.md)** — Deploy your first app via Dashboard, CLI, or YAML (~15 min)
3. **[CI/CD Pipeline Setup](../ci/README.md)** — Set up automated builds with all 8 RAISE 2.0 security gates

**Specialized guides:**
- [Deploy from Git](developer-deployment-guide.md) — Auto-deploy from a Git URL (supports Dockerfile, Docker Compose, Helm)
- [Team Onboarding](onboarding-guide.md) — Request a new team namespace (for team leads/managers)

## For Platform Operators

- [Operator Guide](operator-guide.md) — Day-2 operations, monitoring, upgrades, backup/restore
- [Security Guide](security-guide.md) — Security architecture, threat model, incident response
- [Architecture](architecture.md) — Full platform architecture and design decisions
- [ADRs](decisions.md) — Architectural Decision Records

## For Platform Developers

- [Adding a Component](agent-docs/adding-platform-component.md)
- [Flux Patterns](agent-docs/flux-patterns.md)
- [Kyverno Patterns](agent-docs/kyverno-patterns.md)
- [Helm Conventions](agent-docs/helm-conventions.md)
- [Compliance Mapping](agent-docs/compliance-mapping.md)
```

**Acceptance Criteria:**
- `docs/README.md` exists with clear reading order
- Links are correct and all referenced files exist

---

### Task 5.2: Add Reading Order to getting-started-developer.md

**File:** `docs/getting-started-developer.md`

**Steps:**
Add a "What to Read Next" section at the very top (after the title, before tool installation) that says:

```markdown
## Reading Order

You are here: **Step 1 of 3** for deploying your first app.

1. **This guide** — Install tools and connect to the cluster
2. [Developer Guide](developer-guide.md) — Deploy your app (Dashboard, CLI, or manual YAML)
3. [CI/CD Pipeline](../ci/README.md) — Set up automated builds (optional but recommended)
```

**Acceptance Criteria:**
- Reader knows exactly where they are and what comes next

---

### Task 5.3: Create Consolidated Troubleshooting Guide

**Problem:** Troubleshooting is scattered across 4 docs.

**Create new file:** `docs/troubleshooting.md`

**Steps:**
1. Extract all troubleshooting sections from:
   - `docs/developer-guide.md` (troubleshooting table)
   - `docs/getting-started-developer.md` (common tasks section)
   - `docs/developer-deployment-guide.md` (troubleshooting section)
   - `docs/onboarding-guide.md` (FAQ section)
2. Merge and deduplicate into a single organized document with sections:
   - Pod Issues (CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled)
   - Network Issues (503 errors, connection refused, DNS, mTLS)
   - Build Issues (Kaniko failures, Trivy scan failures, Cosign signing)
   - Policy Issues (Kyverno denials, admission errors, security context)
   - Flux/GitOps Issues (reconciliation failures, HelmRelease not ready)
   - Access Issues (OIDC login, kubectl auth, Harbor push permissions)
3. In each of the 4 source docs, replace the troubleshooting section with a short note linking to the consolidated guide:
   ```markdown
   ## Troubleshooting

   See the [Troubleshooting Guide](troubleshooting.md) for solutions to common issues.
   ```

**Acceptance Criteria:**
- All troubleshooting content in one place
- Source docs link to the consolidated guide
- No troubleshooting info is lost in the consolidation

---

## Phase 6: Create the Golden Path End-to-End Walkthrough

### Task 6.1: Write a Quickstart Walkthrough

**Problem:** There's no single document that proves the entire developer journey works end-to-end. Docs reference different pieces but nobody has stitched together the complete happy path.

**Create new file:** `docs/quickstart.md`

This should be a concise, copy-paste-able walkthrough that a developer follows to deploy a sample app. Not a reference doc — a tutorial.

**Content outline:**

```markdown
# Quickstart: Deploy Your First App on SRE

Time: ~20 minutes (assumes tools are installed per [Getting Started](getting-started-developer.md))

## Prerequisites
- kubectl configured (see Getting Started guide)
- Your team namespace exists (ask your platform admin or see [Onboarding Guide](onboarding-guide.md))
- Harbor credentials (provided during onboarding)

## Step 1: Build and Push Your Image

docker build -t harbor.apps.sre.example.com/<your-team>/<your-app>:v1.0.0 .
docker push harbor.apps.sre.example.com/<your-team>/<your-app>:v1.0.0

## Step 2: Deploy via CLI (fastest)

./scripts/sre-deploy-app.sh \
  --name my-app \
  --team <your-team> \
  --image harbor.apps.sre.example.com/<your-team>/my-app:v1.0.0 \
  --port 8080 \
  --ingress my-app.apps.sre.example.com

## Step 3: Verify

kubectl get pods -n <your-team>
curl https://my-app.apps.sre.example.com  (or via /etc/hosts in lab)

## Step 4: What You Got for Free
- mTLS encryption to all other services (Istio)
- Prometheus metrics scraping (if /metrics endpoint exists)
- Network isolation (only gateway, monitoring, and same-namespace traffic allowed)
- Security policy enforcement (non-root, no privilege escalation, resource limits)
- Audit logging

## Updating Your App
1. Build and push new image tag
2. Update the image tag in apps/tenants/<team>/apps/<app>.yaml
3. Git commit and push — Flux auto-deploys within 10 minutes

## Next Steps
- Set up CI/CD: [CI/CD Pipeline Guide](../ci/README.md)
- Add secrets from OpenBao: [Developer Guide > Secrets](developer-guide.md#secrets-management)
- View metrics: https://grafana.apps.sre.example.com
```

**Acceptance Criteria:**
- A new developer can follow this doc start to finish and have a running app
- All commands are copy-paste-able (no placeholder-only instructions)
- References to other docs are correct

---

## Phase 7: Backfill Missing Infrastructure

### Task 7.1: Create scripts/bootstrap.sh

**Problem:** Referenced in CLAUDE.md but doesn't exist. Needed for reproducibility on a new cluster.

**Create new file:** `scripts/bootstrap.sh`

This script should automate initial cluster setup after RKE2 is installed. It should:
1. Install Flux CD and bootstrap from the Git repo
2. Wait for core platform services to reconcile (Istio, cert-manager, Kyverno, monitoring)
3. Verify health of all components
4. Print status summary

**Content outline:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Bootstrap SRE Platform on a fresh RKE2 cluster
# Prerequisites: kubectl configured, GitHub token available

GITHUB_OWNER="${GITHUB_OWNER:-morbidsteve}"
GITHUB_REPO="${GITHUB_REPO:-sre-platform}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

echo "=== SRE Platform Bootstrap ==="

# Step 1: Install Flux CLI
echo "[1/5] Installing Flux CLI..."
curl -s https://fluxcd.io/install.sh | bash

# Step 2: Check prerequisites
echo "[2/5] Checking prerequisites..."
flux check --pre

# Step 3: Bootstrap Flux
echo "[3/5] Bootstrapping Flux CD..."
flux bootstrap github \
  --owner="${GITHUB_OWNER}" \
  --repository="${GITHUB_REPO}" \
  --branch="${GITHUB_BRANCH}" \
  --path=platform/flux-system \
  --personal

# Step 4: Wait for core services
echo "[4/5] Waiting for core platform services..."
echo "This may take 10-15 minutes on first deployment..."
kubectl wait --for=condition=ready kustomization/sre-core -n flux-system --timeout=600s

# Step 5: Verify
echo "[5/5] Verifying platform health..."
flux get kustomizations -A
flux get helmreleases -A
echo ""
echo "=== Bootstrap Complete ==="
echo "Dashboard: https://dashboard.apps.sre.example.com"
echo "Grafana:   https://grafana.apps.sre.example.com"
echo "Harbor:    https://harbor.apps.sre.example.com"
```

**Acceptance Criteria:**
- Script exists and is executable
- Running on a fresh RKE2 cluster bootstraps the full platform
- Script is idempotent (safe to run again)

---

## Phase 8: Make Policy Overrides Self-Service and Discoverable

The platform already has a working Kyverno PolicyException system (`policies/custom/policy-exceptions/` with a template and full README, Kyverno 3.3.7 with `features.policyExceptions.enabled: true`). But developers won't find it when they get blocked. This phase makes the override process visible and frictionless.

**Existing infrastructure (do NOT rebuild — it's already done):**
- `policies/custom/policy-exception-template.yaml` — copy-paste PolicyException template
- `policies/custom/policy-exceptions/README.md` — full process docs (PR workflow, required annotations, 90-day max expiry, scoping best practices, common exceptions table)
- `docs/runbooks/pod-security-violation.md` — investigation + resolution runbook for every policy
- Kyverno HelmRelease (`platform/core/kyverno/helmrelease.yaml`) has `features.policyExceptions.enabled: true`

### Task 8.1: Add Policy Exception References to Developer Docs

**Problem:** When Kyverno blocks a deployment, the developer has no idea that a formal exception process exists. The exception docs live in `policies/custom/policy-exceptions/README.md` which nobody will find organically.

**Files to update:**

1. **`docs/developer-guide.md`** — Add a section titled "Policy Exceptions" (after the troubleshooting section or near the Kyverno/security discussion). Content:

   ```markdown
   ## Policy Exceptions

   If your application has a legitimate reason to bypass a Kyverno policy (e.g., a security
   scanner that requires privileged access, or a legacy app being migrated that must run as
   root temporarily), you can request a formal policy exception.

   **How it works:**
   1. Copy the template: `policies/custom/policy-exception-template.yaml`
   2. Save it to `policies/custom/policy-exceptions/<your-team>-<reason>.yaml`
   3. Scope it as narrowly as possible (specific pod names, not entire namespaces)
   4. Fill in all required annotations (reason, expiry, tracking ticket)
   5. Submit a PR — the platform team reviews and approves

   Exceptions are time-limited (90-day maximum) and tracked in Git for audit compliance.

   See the full process: [Policy Exceptions Guide](../policies/custom/policy-exceptions/README.md)
   See the violation runbook: [Pod Security Violation Runbook](runbooks/pod-security-violation.md)
   ```

2. **`docs/quickstart.md`** (the new file from Task 6.1) — Add a "Blocked by Kyverno?" callout:

   ```markdown
   ## Blocked by a Policy?

   If Kyverno rejects your deployment, it means your container doesn't meet the platform
   security requirements. The error message tells you exactly what to fix.

   **Common fixes:**
   - Add `USER 1000` to your Dockerfile (non-root requirement)
   - Add health check endpoints (liveness/readiness probes required)
   - Pin your image tag — `:latest` is not allowed
   - Use `harbor.apps.sre.example.com` as your image registry

   **Can't fix it?** Request a [Policy Exception](../policies/custom/policy-exceptions/README.md).
   This is a formal, time-limited override with platform team approval.
   ```

3. **`docs/troubleshooting.md`** (the new file from Task 5.3) — Add a "Kyverno Policy Denials" section that links to both the exception process and the runbook:

   ```markdown
   ## Kyverno Policy Denials

   **Symptom:** `kubectl apply` or Flux reconciliation fails with a message like:
   `resource Deployment/my-app was blocked due to the following policies: require-security-context`

   **Steps:**
   1. Read the denial message — it tells you exactly which policy and rule blocked the resource
   2. Fix the resource to comply (see fixes below)
   3. If you genuinely cannot comply, request a [Policy Exception](../policies/custom/policy-exceptions/README.md)

   **Full investigation runbook:** [Pod Security Violation](runbooks/pod-security-violation.md)
   ```

**Acceptance Criteria:**
- `docs/developer-guide.md` has a "Policy Exceptions" section linking to the exception process
- `docs/quickstart.md` has a "Blocked by a Policy?" callout
- `docs/troubleshooting.md` has a "Kyverno Policy Denials" section linking to the exception process and runbook
- A developer encountering a Kyverno denial can find the exception process within one click from any developer-facing doc

---

### Task 8.2: Add Policy Exception Link to Helm Chart NOTES.txt

**Problem:** When a Helm release fails due to Kyverno, the developer sees the NOTES.txt output (if the release partially succeeds) or the Flux error. Neither mentions the exception process.

**Files to update:**
- `apps/templates/web-app/templates/NOTES.txt`
- `apps/templates/api-service/templates/NOTES.txt`
- `apps/templates/worker/templates/NOTES.txt`
- `apps/templates/cronjob/templates/NOTES.txt`

**Steps:**
Add the following block at the bottom of each NOTES.txt:

```
== Troubleshooting ==

If your deployment is blocked by a Kyverno policy, check the error message for details.
Common fixes:
  - Ensure your container runs as non-root (USER directive in Dockerfile)
  - Add liveness and readiness probes
  - Use a pinned image tag (not :latest)
  - Pull images from harbor.apps.sre.example.com

If you need a policy exception: see policies/custom/policy-exceptions/README.md
Full runbook: docs/runbooks/pod-security-violation.md
```

**Acceptance Criteria:**
- All 4 chart NOTES.txt files include the troubleshooting block
- After `helm install`, the notes output includes the exception process link

---

### Task 8.3: Wire DSOP Wizard Security Exception UI to Generate Real PolicyExceptions

**Problem:** The DSOP wizard (apps/dsop-wizard/) already has a security exception request UI in Step 4 (SecurityPipeline). But it's currently display-only — it doesn't generate an actual PolicyException YAML or open a PR.

**File:** `apps/dsop-wizard/src/` — the Step 4 component that handles security exception requests

**Steps:**
1. Find the security exception UI component in the DSOP wizard source (likely in the Step4 or SecurityPipeline component)
2. When a user requests an exception through the wizard:
   a. Generate a PolicyException YAML from the template (`policies/custom/policy-exception-template.yaml`) pre-filled with:
      - The app name and team from the wizard context (Steps 1-2)
      - The specific policy that blocked the deployment (from the pipeline gate results)
      - The namespace scoped to the team
      - A 90-day expiry date from today
   b. Either:
      - Display the generated YAML for the user to copy into a PR (minimum viable), OR
      - Call the GitHub API to create a branch and PR automatically (ideal, requires GITOPS_TOKEN)
3. Include a note that the exception still requires platform team approval via PR review

**Acceptance Criteria:**
- When a developer clicks "Request Exception" in the DSOP wizard, they get a pre-filled PolicyException YAML
- The YAML is valid and scoped to their specific workload
- The wizard explains that a PR must be submitted and approved

---

### Task 8.4: Add Exception Expiry Monitoring

**Problem:** PolicyExceptions have a 90-day maximum expiry annotated in `sre.io/exception-expiry`, but nothing actually monitors or alerts when exceptions are about to expire or have expired.

**Steps:**
1. Create a Prometheus recording rule or CronJob that checks for expired or soon-to-expire exceptions:
   - **File:** Create `platform/core/kyverno/exception-monitor-cronjob.yaml`
   - The CronJob runs daily, queries all PolicyException resources, and checks `sre.io/exception-expiry` annotations
   - If an exception expires within 14 days: create a warning event
   - If an exception is past expiry: log an alert and optionally delete the exception

2. Alternative simpler approach — add to the existing `scripts/compliance-report.sh`:
   - **File:** `scripts/compliance-report.sh`
   - Add a section that lists all PolicyExceptions and their expiry dates
   - Flag any that are within 14 days of expiry or already expired
   - This is already referenced in `policies/custom/policy-exceptions/README.md` as part of the weekly compliance sweep

3. Add a PrometheusRule alert:
   - **File:** Create `platform/core/monitoring/alerts/policy-exception-expiry.yaml`
   ```yaml
   apiVersion: monitoring.coreos.com/v1
   kind: PrometheusRule
   metadata:
     name: policy-exception-alerts
     namespace: monitoring
   spec:
     groups:
       - name: kyverno-exceptions
         rules:
           - alert: PolicyExceptionExpiringSoon
             expr: |
               kyverno_policy_exception_total > 0
             for: 1h
             labels:
               severity: warning
             annotations:
               summary: "Check PolicyException expiry dates"
               description: "Run: kubectl get policyexceptions -A -o jsonpath='{range .items[*]}{.metadata.name} expires {.metadata.annotations.sre\\.io/exception-expiry}{\"\\n\"}{end}'"
               runbook_url: "policies/custom/policy-exceptions/README.md"
   ```

   Note: Kyverno may not export per-exception expiry metrics natively. The simpler CronJob or compliance-report approach may be more practical. Use whichever approach fits best.

**Acceptance Criteria:**
- Expired exceptions are detected (either via CronJob, compliance-report.sh, or Prometheus alert)
- Platform team is notified before exceptions expire
- `scripts/compliance-report.sh` includes exception status in its output

---

### Task 8.5: Create Example PolicyException for Reference

**Problem:** The template exists but there's no real-world example in the exceptions directory. Having a concrete example helps developers understand the format.

**File:** Create `policies/custom/policy-exceptions/example-neuvector-privileged.yaml`

This is the NeuVector enforcer exception — a real, legitimate exception since NeuVector requires privileged access for runtime security monitoring. It should already be operating this way, so this just formalizes it.

```yaml
---
# NeuVector Enforcer requires privileged access for runtime security monitoring.
# This is a permanent platform exception documented in the NeuVector component README.
apiVersion: kyverno.io/v2beta1
kind: PolicyException
metadata:
  name: neuvector-enforcer-privileged
  namespace: neuvector
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: "platform"
  annotations:
    sre.io/exception-reason: "NeuVector enforcer DaemonSet requires privileged access for container runtime monitoring, process inspection, and network segmentation enforcement. This is a core platform security component — the privileged access IS the security control."
    sre.io/exception-approver: "platform-team"
    sre.io/exception-expiry: "2027-01-01"
    sre.io/ticket: "ADR-007 in docs/decisions.md"
spec:
  exceptions:
    - policyName: disallow-privileged-containers
      ruleNames:
        - disallow-privileged
    - policyName: require-run-as-nonroot
      ruleNames:
        - run-as-nonroot
    - policyName: require-drop-all-capabilities
      ruleNames:
        - drop-all-capabilities
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - neuvector
          names:
            - "neuvector-enforcer-*"
            - "neuvector-controller-*"
            - "neuvector-scanner-*"
```

Also create a second example for a tenant use case:

**File:** Create `policies/custom/policy-exceptions/example-team-alpha-legacy-migration.yaml.example`

Note the `.example` suffix — this is a reference, not applied to the cluster.

```yaml
---
# Example: Legacy app that runs as root during migration to non-root.
# This is a TEMPLATE showing how tenants request exceptions. Copy and modify.
apiVersion: kyverno.io/v2beta1
kind: PolicyException
metadata:
  name: team-alpha-legacy-api-nonroot
  namespace: team-alpha
  labels:
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: "team-alpha"
  annotations:
    sre.io/exception-reason: "Legacy API server v2.x requires root for port 80 binding. Migrating to v3.x (non-root, port 8080) by 2026-05-15. Compensating controls: NetworkPolicy restricts egress, NeuVector monitors runtime behavior."
    sre.io/exception-approver: "jane-doe"
    sre.io/exception-expiry: "2026-05-15"
    sre.io/ticket: "https://github.com/morbidsteve/sre-platform/issues/42"
spec:
  exceptions:
    - policyName: require-run-as-nonroot
      ruleNames:
        - run-as-nonroot
    - policyName: require-security-context
      ruleNames:
        - require-security-context
  match:
    any:
      - resources:
          kinds:
            - Pod
          namespaces:
            - team-alpha
          names:
            - "legacy-api-*"
```

**Acceptance Criteria:**
- `policies/custom/policy-exceptions/example-neuvector-privileged.yaml` exists as a real, applied exception
- `policies/custom/policy-exceptions/example-team-alpha-legacy-migration.yaml.example` exists as a reference template
- Both demonstrate correct annotation usage, narrow scoping, and compensating controls
- The NeuVector exception is functional (NeuVector pods are not blocked by policies)

---

## Phase 9: Developer Integration Patterns

These 20 tasks address real-world integration scenarios that developers will hit once they move past "hello world" deployments. Each one closes a gap between "the platform supports this technically" and "a developer can actually do it self-service."

---

### Task 9.1: Add Database Provisioning to Helm Chart Templates

**Problem:** A developer whose app needs PostgreSQL has two paths today: Deploy from Git (auto-detects `postgres` in docker-compose) or writing raw CloudNativePG `Cluster` CRDs. There's no Helm chart-level database provisioning via the standard `sre-web-app` or `sre-api-service` charts.

**What exists:**
- CloudNativePG operator deployed at `platform/addons/cnpg/`
- Example CNPG Cluster CRD at `apps/dashboard/k8s/pipeline-db.yaml`
- Deploy from Git auto-provisions PostgreSQL for Compose apps

**Steps:**
1. Add an optional `database` section to the `sre-web-app` and `sre-api-service` charts' `values.yaml`:
   ```yaml
   database:
     enabled: false
     type: postgresql         # Only postgresql supported via CNPG
     instances: 1             # 1 for dev, 2+ for HA
     size: 5Gi
     database: ""             # Defaults to app.name with hyphens replaced by underscores
     owner: ""                # Defaults to app.name
   ```

2. Create a new template `templates/cnpg-cluster.yaml` in both `apps/templates/web-app/` and `apps/templates/api-service/`:
   ```yaml
   {{- if .Values.database.enabled }}
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: {{ include "sre-lib.fullname" . }}-db
     namespace: {{ .Release.Namespace }}
     labels:
       {{- include "sre-lib.labels" . | nindent 4 }}
   spec:
     instances: {{ .Values.database.instances | default 1 }}
     storage:
       storageClass: local-path
       size: {{ .Values.database.size | default "5Gi" }}
     bootstrap:
       initdb:
         database: {{ .Values.database.database | default (replace "-" "_" .Values.app.name) }}
         owner: {{ .Values.database.owner | default (replace "-" "_" .Values.app.name) }}
     monitoring:
       enablePodMonitor: true
   {{- end }}
   ```

3. When `database.enabled: true`, also inject the `DATABASE_URL` environment variable into the Deployment by referencing the CNPG-generated secret (`<cluster-name>-app`):
   ```yaml
   - name: DATABASE_URL
     valueFrom:
       secretKeyRef:
         name: {{ include "sre-lib.fullname" . }}-db-app
         key: uri
   ```

4. Update `values.schema.json` for both charts with the database schema.

5. Update the chart READMEs with a database example.

**Acceptance Criteria:**
- `helm template test apps/templates/web-app/ --set database.enabled=true --set app.name=my-app --set app.team=alpha --set app.image.repository=harbor.apps.sre.example.com/alpha/my-app --set app.image.tag=v1` renders a valid CNPG Cluster + Deployment with DATABASE_URL injected
- A developer can add `database.enabled: true` to their HelmRelease values and get a working PostgreSQL instance with credentials auto-injected

---

### Task 9.2: Add Redis Provisioning Pattern

**Problem:** Many apps need Redis for caching or sessions. There's no pattern for provisioning Redis in a tenant namespace.

**Steps:**
1. Add an optional `redis` section to `sre-web-app` and `sre-api-service` values:
   ```yaml
   redis:
     enabled: false
     size: 1Gi
   ```

2. Create `templates/redis.yaml` that deploys a simple single-instance Redis using a Deployment + Service + PVC (no operator needed for single-instance):
   ```yaml
   {{- if .Values.redis.enabled }}
   # Deployment running redis:7-alpine (pinned version)
   # Non-root, read-only rootfs, resource limits
   # Service at <fullname>-redis:6379
   # PVC for persistence
   {{- end }}
   ```

3. When `redis.enabled: true`, inject `REDIS_URL` into the app's Deployment:
   ```yaml
   - name: REDIS_URL
     value: "redis://{{ include "sre-lib.fullname" . }}-redis:6379"
   ```

4. Pin the Redis image to a specific version from Harbor (e.g., `harbor.apps.sre.example.com/library/redis:7.2.4-alpine`). Do NOT use Docker Hub directly.

**Acceptance Criteria:**
- `helm template` renders valid Redis Deployment + Service + PVC when `redis.enabled: true`
- Redis runs non-root with read-only rootfs and resource limits
- `REDIS_URL` is injected into the app container

---

### Task 9.3: Add Database Migration Job Pattern

**Problem:** Most apps with databases need to run migrations before the app starts. There's no documented pattern for this. Init containers are mentioned but not templated.

**Steps:**
1. Add an optional `migrations` section to `sre-web-app` and `sre-api-service` values:
   ```yaml
   migrations:
     enabled: false
     image: ""          # Defaults to app.image if empty
     command: []         # e.g., ["npm", "run", "migrate"]
   ```

2. When `migrations.enabled: true`, add an init container to the Deployment template:
   ```yaml
   initContainers:
     - name: migrations
       image: {{ .Values.migrations.image | default (printf "%s:%s" .Values.app.image.repository .Values.app.image.tag) }}
       command: {{ toJson .Values.migrations.command }}
       env:
         # Same env vars as the main container (including DATABASE_URL)
       securityContext:
         # Same security context as main container
       resources:
         # Same resources as main container
   ```

3. The init container runs to completion before the main app container starts. If it fails, the pod stays in `Init:Error` and Kubernetes retries.

4. Update chart READMEs with migration example.

**Acceptance Criteria:**
- `helm template` renders valid init container when `migrations.enabled: true`
- Init container inherits the same env vars and security context as the main container
- Migration failure blocks app startup (standard init container behavior)

---

### Task 9.4: Document Cross-Namespace Service Communication

**Problem:** When team-alpha's frontend needs to call team-beta's API, there's no developer-facing documentation for how to set this up. The `sre-api-service` chart has `authorizationPolicy.allowedCallers` but it's only in the chart README, not in the developer guide.

**Steps:**
1. Add a section titled "Calling Services in Other Namespaces" to `docs/developer-guide.md`:

   ```markdown
   ## Calling Services in Other Namespaces

   By default, pods can only communicate within their own namespace. To allow
   cross-namespace calls (e.g., team-alpha's frontend calling team-beta's API):

   **Step 1: The API service (team-beta) must allow the caller.**
   In team-beta's HelmRelease (using sre-api-service chart):
   ```yaml
   authorizationPolicy:
     enabled: true
     allowedCallers:
       - namespace: team-alpha
         serviceAccounts:
           - my-frontend   # The calling app's service account
   ```

   **Step 2: The caller (team-alpha) needs egress to team-beta.**
   In team-alpha's HelmRelease values:
   ```yaml
   networkPolicy:
     additionalEgress:
       - to:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: team-beta
         ports:
           - port: 8080
             protocol: TCP
   ```

   **Step 3: Call the service using the full DNS name:**
   ```
   http://my-api.team-beta.svc.cluster.local:8080
   ```
   ```

2. Add a cross-namespace example to `apps/templates/api-service/README.md` if not already there.

**Acceptance Criteria:**
- Developer guide has clear cross-namespace communication instructions
- Both sides (caller egress + callee authorization) are documented
- Full DNS name format is shown

---

### Task 9.5: Add Istio ServiceEntry Pattern for External API Access

**Problem:** The NetworkPolicy allows HTTPS egress to `0.0.0.0/0:443`, but Istio can block traffic to external services that aren't registered. Developers calling external APIs (Stripe, Twilio, AWS services) need a ServiceEntry to make Istio aware of the external host. There's no documented pattern or template for this.

**Steps:**
1. Add an optional `externalServices` section to the `sre-web-app` and `sre-api-service` values:
   ```yaml
   externalServices: []
   # - host: api.stripe.com
   #   port: 443
   # - host: api.twilio.com
   #   port: 443
   ```

2. Create `templates/serviceentry.yaml` in both charts:
   ```yaml
   {{- range .Values.externalServices }}
   ---
   apiVersion: networking.istio.io/v1
   kind: ServiceEntry
   metadata:
     name: {{ $.Values.app.name }}-ext-{{ .host | replace "." "-" }}
     namespace: {{ $.Release.Namespace }}
   spec:
     hosts:
       - {{ .host }}
     ports:
       - number: {{ .port | default 443 }}
         name: https
         protocol: TLS
     resolution: DNS
     location: MESH_EXTERNAL
   {{- end }}
   ```

3. Add documentation to `docs/developer-guide.md` under a new section "Accessing External APIs":
   ```markdown
   ## Accessing External APIs

   If your app calls external services (payment providers, cloud APIs, etc.),
   add them to your HelmRelease values:

   ```yaml
   externalServices:
     - host: api.stripe.com
     - host: s3.amazonaws.com
   ```

   This creates Istio ServiceEntries so the mesh routes traffic correctly.
   HTTPS egress on port 443 is already allowed by NetworkPolicy.

   For non-443 ports, also add a NetworkPolicy egress rule:
   ```yaml
   networkPolicy:
     additionalEgress:
       - to:
           - ipBlock:
               cidr: 0.0.0.0/0
         ports:
           - port: 8080
             protocol: TCP
   ```
   ```

**Acceptance Criteria:**
- `helm template` renders valid ServiceEntry resources for each external service
- Documentation explains when and why ServiceEntries are needed
- Works with existing HTTPS egress NetworkPolicy

---

### Task 9.6: Add Graceful Shutdown (preStop Hook) to Helm Templates

**Problem:** The Helm chart Deployment templates have no `lifecycle.preStop` hook or `terminationGracePeriodSeconds` override. Apps that need to drain connections (web servers, queue consumers) will lose in-flight requests during rolling updates.

**Steps:**
1. Add to `sre-web-app`, `sre-api-service`, and `sre-worker` values:
   ```yaml
   app:
     terminationGracePeriodSeconds: 30
     preStopCommand: []   # e.g., ["/bin/sh", "-c", "sleep 5"]
   ```

2. Update the Deployment templates (or `sre-lib` if centralized) to include:
   ```yaml
   spec:
     terminationGracePeriodSeconds: {{ .Values.app.terminationGracePeriodSeconds | default 30 }}
     containers:
       - name: {{ .Values.app.name }}
         {{- if .Values.app.preStopCommand }}
         lifecycle:
           preStop:
             exec:
               command: {{ toJson .Values.app.preStopCommand }}
         {{- end }}
   ```

3. Add documentation in `docs/developer-guide.md`:
   ```markdown
   ## Graceful Shutdown

   During rolling updates, Kubernetes sends SIGTERM to your app and waits up to
   30 seconds (default) for it to exit. To drain in-flight requests, either:

   **Option 1:** Handle SIGTERM in your application code (recommended)
   **Option 2:** Add a preStop hook for a sleep delay:
   ```yaml
   app:
     preStopCommand: ["/bin/sh", "-c", "sleep 5"]
     terminationGracePeriodSeconds: 35  # Must be > preStop sleep
   ```
   ```

**Acceptance Criteria:**
- Deployment renders `lifecycle.preStop` when `preStopCommand` is set
- `terminationGracePeriodSeconds` is configurable
- Documentation covers both SIGTERM handling and preStop approach

---

### Task 9.7: Document and Template Canary Deployments for Developers

**Problem:** Flagger canary support exists in the `sre-web-app` chart (`canary.enabled` in values, `canary.yaml` template, Flagger operator deployed), but it's not mentioned in any developer-facing documentation. Developers don't know this capability exists.

**What exists:**
- `apps/templates/web-app/values.yaml` has `canary:` section (disabled by default)
- `apps/templates/web-app/templates/canary.yaml` renders Flagger Canary CRD
- `platform/addons/flagger/` has the operator + README

**Steps:**
1. Add a "Progressive Delivery (Canary Deployments)" section to `docs/developer-guide.md`:
   ```markdown
   ## Canary Deployments

   Enable progressive delivery to safely roll out changes. Flagger automatically
   shifts traffic from the old version to the new version, monitoring success rate
   and latency. If metrics degrade, it automatically rolls back.

   ```yaml
   canary:
     enabled: true
     analysis:
       interval: "1m"       # Check metrics every minute
       threshold: 5          # Rollback after 5 failed checks
       maxWeight: 50          # Max traffic to canary
       stepWeight: 10         # Increase by 10% each step
       successRate: 99        # Require 99% success rate
       latencyMax: 500        # Max p99 latency (ms)
   ```

   **Requirements:** Your app must expose a `/metrics` endpoint for Prometheus
   (ServiceMonitor is enabled by default in the chart).

   **Monitoring:** Watch the canary progress:
   ```bash
   kubectl get canary -n <your-team>
   kubectl describe canary <your-app> -n <your-team>
   ```
   ```

2. Also add a brief mention in `docs/quickstart.md` under "Next Steps" pointing to the canary section.

**Acceptance Criteria:**
- Developer guide documents canary deployment values and usage
- Developer knows the requirement (metrics endpoint)
- Monitoring commands are provided

---

### Task 9.8: Document Preview Environments for Developers

**Problem:** A full preview environment system exists (`scripts/preview-env.sh` + `ci/github-actions/preview-environment.yaml`) that creates ephemeral namespaces per PR. But it's not documented in any developer-facing guide.

**What exists:**
- `scripts/preview-env.sh` creates/destroys ephemeral namespaces with NetworkPolicies and VirtualService
- `ci/github-actions/preview-environment.yaml` triggers on PR open/close
- Preview URL pattern: `pr-<num>-<app>.apps.sre.example.com`

**Steps:**
1. Add a "Preview Environments" section to `docs/developer-guide.md`:
   ```markdown
   ## Preview Environments

   The platform can create ephemeral environments for each pull request, giving
   reviewers a live URL to test before merging.

   **Setup:** Add the preview workflow to your app repo:
   ```yaml
   # .github/workflows/preview.yaml
   name: Preview Environment
   on:
     pull_request:
       types: [opened, synchronize, closed]

   jobs:
     preview:
       uses: morbidsteve/sre-platform/.github/workflows/preview-environment.yaml@main
       with:
         team: "your-team"
         app-name: "your-app"
       secrets: inherit
   ```

   **What happens:**
   - PR opened: Namespace `preview-<team>-<app>-pr<num>` is created with full
     network isolation, the app is built and deployed
   - URL: `https://pr-<num>-<app>.apps.sre.example.com`
   - PR closed/merged: Namespace is automatically destroyed

   **Limitations:**
   - No database persistence across rebuilds
   - Shares the cluster with production (resource quotas apply)
   ```

2. Also add to `ci/README.md` under a new "Preview Environments" section.

**Acceptance Criteria:**
- Developer guide documents preview environment setup and usage
- ci/README.md cross-references the preview workflow
- Limitations are clearly stated

---

### Task 9.9: Create Per-Tenant Grafana Dashboard Template

**Problem:** Grafana discovers dashboards from ConfigMaps labeled `grafana_dashboard: "1"`, but there's no template or documented pattern for developers to create their own dashboards. All dashboards are platform-level (Istio, Kyverno, etc.).

**Steps:**
1. Create a Grafana dashboard JSON template at `apps/templates/sre-lib/dashboards/app-overview.json` that provides a standard app dashboard with:
   - Pod CPU/memory usage
   - Request rate and latency (from Istio metrics)
   - Error rate (5xx responses)
   - Pod restarts
   - Replica count vs HPA target
   All parameterized by namespace and app name using Grafana template variables.

2. Add a new template `templates/grafana-dashboard.yaml` to the `sre-web-app` and `sre-api-service` charts:
   ```yaml
   {{- if .Values.serviceMonitor.enabled }}
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: {{ include "sre-lib.fullname" . }}-dashboard
     namespace: monitoring
     labels:
       grafana_dashboard: "1"
     annotations:
       grafana_folder: {{ .Values.app.team | quote }}
   data:
     {{ .Values.app.name }}-dashboard.json: |
       {{ .Files.Get "dashboards/app-overview.json" | nindent 6 }}
   {{- end }}
   ```

3. The dashboard should use Grafana variables `$namespace` and `$app` so it works for any app.

4. Add documentation to `docs/developer-guide.md`:
   ```markdown
   ## Monitoring Dashboard

   When you deploy with ServiceMonitor enabled (default), a Grafana dashboard is
   automatically created showing your app's CPU, memory, request rate, error rate,
   and latency. Find it in Grafana under the folder matching your team name.

   **Custom dashboards:** Create a ConfigMap in the `monitoring` namespace:
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: my-custom-dashboard
     namespace: monitoring
     labels:
       grafana_dashboard: "1"
     annotations:
       grafana_folder: "team-alpha"
   data:
     my-dashboard.json: |
       { ... your Grafana JSON ... }
   ```
   ```

**Acceptance Criteria:**
- Deploying an app via sre-web-app chart auto-creates a Grafana dashboard
- Dashboard appears in Grafana under the team's folder
- Dashboard shows useful app metrics out of the box
- Developers know how to create custom dashboards

---

### Task 9.10: Create Per-Tenant Alerting Template

**Problem:** Only platform-level PrometheusRules exist. Developers can't create alerts for their own apps (e.g., "alert me if error rate > 5%"). There's no template or documentation for this.

**Steps:**
1. Add an optional `alerts` section to `sre-web-app` and `sre-api-service` values:
   ```yaml
   alerts:
     enabled: false
     highErrorRate:
       enabled: true
       threshold: 5          # Percentage
       for: 5m
     highLatency:
       enabled: true
       threshold: 1000       # Milliseconds (p99)
       for: 5m
     podRestarts:
       enabled: true
       threshold: 3
       for: 15m
   ```

2. Create `templates/prometheusrule.yaml`:
   ```yaml
   {{- if .Values.alerts.enabled }}
   apiVersion: monitoring.coreos.com/v1
   kind: PrometheusRule
   metadata:
     name: {{ include "sre-lib.fullname" . }}-alerts
     namespace: {{ .Release.Namespace }}
     labels:
       {{- include "sre-lib.labels" . | nindent 4 }}
   spec:
     groups:
       - name: {{ .Values.app.name }}.rules
         rules:
           {{- if .Values.alerts.highErrorRate.enabled }}
           - alert: {{ .Values.app.name | title }}HighErrorRate
             expr: |
               (sum(rate(istio_requests_total{destination_service_namespace="{{ .Release.Namespace }}", destination_service_name="{{ .Values.app.name }}", response_code=~"5.."}[5m]))
               / sum(rate(istio_requests_total{destination_service_namespace="{{ .Release.Namespace }}", destination_service_name="{{ .Values.app.name }}"}[5m]))) * 100
               > {{ .Values.alerts.highErrorRate.threshold }}
             for: {{ .Values.alerts.highErrorRate.for }}
             labels:
               severity: warning
               team: {{ .Values.app.team }}
             annotations:
               summary: "High error rate for {{ .Values.app.name }}"
               description: "Error rate is above {{ .Values.alerts.highErrorRate.threshold }}%"
           {{- end }}
           # Similar rules for highLatency and podRestarts
   {{- end }}
   ```

3. Document in `docs/developer-guide.md` under "Alerting".

**Acceptance Criteria:**
- `helm template` renders valid PrometheusRule when `alerts.enabled: true`
- Alerts fire in Prometheus/Grafana based on Istio metrics
- Developer can customize thresholds via values

---

### Task 9.11: Add Structured Logging Guide with Code Examples

**Problem:** The platform expects JSON-structured logs for Loki field extraction (Alloy parses `level`, `msg`, `ts` fields). Getting-started-developer.md mentions this but doesn't provide code examples per language. Developers using Python, Go, Node, or Java won't know how to configure their loggers.

**Steps:**
1. Create `docs/logging-guide.md` with code examples for each common language:

   **Node.js (pino):**
   ```javascript
   const pino = require('pino');
   const logger = pino({ level: 'info' });
   logger.info({ method: 'GET', path: '/api/users', status: 200, duration_ms: 45 }, 'request handled');
   ```

   **Python (structlog):**
   ```python
   import structlog
   logger = structlog.get_logger()
   logger.info("request handled", method="GET", path="/api/users", status=200, duration_ms=45)
   ```

   **Go (slog):**
   ```go
   slog.Info("request handled", "method", "GET", "path", "/api/users", "status", 200, "duration_ms", 45)
   ```

   **Java (Logback + logstash-logback-encoder):**
   ```xml
   <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
   ```

2. Include the required fields: `level`, `msg`, `ts` (timestamp)
3. Include recommended fields: `method`, `path`, `status`, `duration_ms`, `trace_id`
4. Show how to query in Grafana/Loki:
   ```
   {namespace="team-alpha", container="my-app"} | json | level="error"
   {namespace="team-alpha"} | json | duration_ms > 1000
   ```
5. Link from `docs/developer-guide.md` and `docs/getting-started-developer.md`

**Acceptance Criteria:**
- `docs/logging-guide.md` exists with working code examples for Node, Python, Go, Java
- Required fields are clearly stated
- Loki query examples are included
- Linked from developer-facing docs

---

### Task 9.12: Add OpenTelemetry Tracing Instrumentation Guide

**Problem:** Istio generates traces for HTTP requests automatically, but developers who want custom spans (database queries, external API calls, business logic) need to instrument their code. The OTLP endpoint is documented (`tempo-distributor.tracing.svc.cluster.local:4317`) but no setup guide exists.

**Steps:**
1. Create `docs/tracing-guide.md` with:

   a. What you get for free (Istio auto-generates HTTP request spans)

   b. How to add custom spans for each language:

   **Node.js:**
   ```javascript
   // tracing.js — import before anything else
   const { NodeSDK } = require('@opentelemetry/sdk-node');
   const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');

   const sdk = new NodeSDK({
     traceExporter: new OTLPTraceExporter({
       url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo-distributor.tracing.svc.cluster.local:4317',
     }),
     serviceName: process.env.OTEL_SERVICE_NAME || 'my-app',
   });
   sdk.start();
   ```

   **Python:**
   ```python
   from opentelemetry import trace
   from opentelemetry.sdk.trace import TracerProvider
   from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

   provider = TracerProvider()
   provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
   trace.set_tracer_provider(provider)
   ```

   **Go:**
   ```go
   exporter, _ := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint("tempo-distributor.tracing.svc.cluster.local:4317"), otlptracegrpc.WithInsecure())
   tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
   otel.SetTracerProvider(tp)
   ```

   c. How to add the env vars via Helm values:
   ```yaml
   app:
     env:
       - name: OTEL_EXPORTER_OTLP_ENDPOINT
         value: "http://tempo-distributor.tracing.svc.cluster.local:4317"
       - name: OTEL_SERVICE_NAME
         value: "my-app"
   ```

   d. How to view traces in Grafana (Tempo datasource, search by service name)

   e. How traces correlate with logs (traceID in log fields)

2. Link from `docs/developer-guide.md` and `docs/getting-started-developer.md`

**Acceptance Criteria:**
- `docs/tracing-guide.md` exists with working examples for Node, Python, Go
- Env var configuration is shown via Helm values
- Grafana Tempo query instructions are included

---

### Task 9.13: Add Environment Promotion Pattern (Dev/Staging/Prod)

**Problem:** There's no documented or templated way for a developer to promote their app through environments. The platform has OpenTofu environments (`infrastructure/tofu/environments/{dev,staging,production}`) but no app-level promotion workflow.

**Steps:**
1. Add a section to `docs/developer-guide.md` titled "Environment Promotion":

   ```markdown
   ## Environment Promotion

   The recommended app promotion pattern uses Flux valuesFrom overlays:

   **Directory structure in your tenant folder:**
   ```
   apps/tenants/team-alpha/apps/
   ├── my-app.yaml                    # Base HelmRelease
   ├── my-app-values-dev.yaml         # Dev overrides (ConfigMap)
   └── my-app-values-production.yaml  # Production overrides (ConfigMap)
   ```

   **Base HelmRelease** (`my-app.yaml`):
   ```yaml
   spec:
     valuesFrom:
       - kind: ConfigMap
         name: my-app-env-values
         optional: true
     values:
       app:
         name: my-app
         team: team-alpha
         image:
           repository: harbor.apps.sre.example.com/team-alpha/my-app
           tag: "v1.0.0"
   ```

   **Dev overrides** (`my-app-values-dev.yaml`):
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: my-app-env-values
     namespace: team-alpha
   data:
     values.yaml: |
       app:
         replicas: 1
       autoscaling:
         enabled: false
   ```

   **Production overrides** (apply via separate PR):
   ```yaml
   data:
     values.yaml: |
       app:
         replicas: 3
       autoscaling:
         enabled: true
         minReplicas: 3
         maxReplicas: 10
   ```

   **Promotion flow:**
   1. Merge to main → Flux deploys with dev values
   2. Verify in dev
   3. Update ConfigMap to production values → create PR
   4. Approve PR → Flux applies production config
   ```

2. Optionally create a `scripts/promote-app.sh` that swaps the ConfigMap.

**Acceptance Criteria:**
- Developer guide documents the promotion pattern
- Pattern uses Flux-native valuesFrom (no custom tooling required)
- Clear distinction between image tag updates and config overrides

---

### Task 9.14: Add WebSocket Support Documentation and VirtualService Pattern

**Problem:** The Istio gateway supports HTTP/2 (port named `http2`), but WebSocket apps need specific VirtualService timeout configuration. Without `timeout: 0s`, Istio will kill WebSocket connections after the default timeout.

**Steps:**
1. Add a `websocket` option to the `sre-web-app` chart values:
   ```yaml
   websocket:
     enabled: false
     routes: []
     # - match: /ws
     #   timeout: 0s
   ```

2. Update `templates/virtualservice.yaml` to handle WebSocket routes:
   ```yaml
   {{- if .Values.websocket.enabled }}
   {{- range .Values.websocket.routes }}
   - match:
       - uri:
           prefix: {{ .match }}
     route:
       - destination:
           host: {{ include "sre-lib.fullname" $ }}
           port:
             number: {{ $.Values.app.port }}
     timeout: {{ .timeout | default "0s" }}
   {{- end }}
   {{- end }}
   ```

3. Document in `docs/developer-guide.md`:
   ```markdown
   ## WebSocket Support

   For apps using WebSocket connections, enable WebSocket routing:
   ```yaml
   websocket:
     enabled: true
     routes:
       - match: /ws
         timeout: 0s    # Disable timeout for persistent connections
       - match: /socket.io
         timeout: 0s
   ```

   Standard HTTP routes continue to use the default 15s timeout.
   ```

**Acceptance Criteria:**
- VirtualService renders WebSocket routes with `timeout: 0s` when enabled
- Documentation explains WebSocket configuration
- Non-WebSocket routes are unaffected

---

### Task 9.15: Add Resource Right-Sizing Guide with Grafana Queries

**Problem:** Developers set CPU/memory requests and limits but have no guidance on how to tune them based on actual usage. The monitoring stack has all the data but developers don't know the queries.

**Steps:**
1. Add a section to `docs/developer-guide.md` titled "Tuning Resource Limits":

   ```markdown
   ## Tuning Resource Limits

   After your app runs for a few hours, use these Grafana queries to right-size:

   **Actual CPU usage vs requests:**
   ```promql
   rate(container_cpu_usage_seconds_total{namespace="<team>", container="<app>"}[5m])
   ```
   If usage is consistently <50% of request, lower the request.

   **Actual memory usage vs limits:**
   ```promql
   container_memory_working_set_bytes{namespace="<team>", container="<app>"}
   ```
   If usage is consistently <50% of limit, lower the limit.
   If usage approaches the limit, increase it (OOMKilled risk).

   **Quick check via kubectl:**
   ```bash
   kubectl top pods -n <team>
   kubectl describe quota -n <team>   # See namespace-level usage
   ```

   **Rules of thumb:**
   - CPU request = p95 of actual usage
   - CPU limit = 2-4x the request (allows bursting)
   - Memory request = p95 of actual usage
   - Memory limit = 1.5x the request (memory is incompressible)
   - Start with chart defaults (100m/128Mi request, 500m/512Mi limit)
   ```

**Acceptance Criteria:**
- Developer guide has PromQL queries for CPU and memory right-sizing
- kubectl commands for quick checks are included
- Rules of thumb are practical and correct

---

### Task 9.16: Add Rollback Documentation for Developers

**Problem:** Rollback is documented in the operator guide and production-deployment-guide, but not in the developer guide. A developer who pushes a bad image tag needs to know how to revert without asking a platform admin.

**Steps:**
1. Add a "Rolling Back a Deployment" section to `docs/developer-guide.md`:

   ```markdown
   ## Rolling Back

   **Method 1: Git revert (recommended)**
   ```bash
   git revert <bad-commit-hash>
   git push
   # Flux auto-reconciles within 10 minutes
   ```

   **Method 2: Force immediate rollback**
   ```bash
   # Update the image tag back to the known-good version
   # In apps/tenants/<team>/apps/<app>.yaml:
   #   tag: "v1.0.0"  # Revert from v1.1.0 to v1.0.0
   git commit -am "fix: rollback my-app to v1.0.0"
   git push
   flux reconcile kustomization sre-tenants -n flux-system  # Force immediate
   ```

   **Method 3: Suspend Flux and rollback Helm (emergency)**
   ```bash
   flux suspend helmrelease <app> -n <team>
   helm rollback <app> <previous-revision> -n <team>
   # Fix the YAML in Git, then:
   flux resume helmrelease <app> -n <team>
   ```

   **Check rollback status:**
   ```bash
   kubectl rollout status deployment/<app> -n <team>
   kubectl get pods -n <team> -l app.kubernetes.io/name=<app>
   ```
   ```

**Acceptance Criteria:**
- Developer guide has 3 rollback methods (git revert, tag update, emergency Helm rollback)
- Flux force-reconcile command is included
- Status check commands are included

---

### Task 9.17: Add Health Check Guidance for Non-Standard Apps

**Problem:** The Kyverno policy requires liveness and readiness probes, and the Helm chart defaults to `/healthz` and `/readyz`. But many apps don't have these endpoints. Developers need guidance on what to do when their app doesn't expose standard health paths.

**Steps:**
1. Add a "Health Checks" section to `docs/developer-guide.md`:

   ```markdown
   ## Health Checks

   All apps must have liveness and readiness probes (Kyverno enforces this).

   **If your app has health endpoints:**
   ```yaml
   app:
     probes:
       liveness:
         path: /healthz
       readiness:
         path: /readyz
   ```

   **If your app has no health endpoints (serve a static page, etc.):**
   Use the root path:
   ```yaml
   app:
     probes:
       liveness:
         path: /
       readiness:
         path: /
   ```

   **If your app is not HTTP (workers, gRPC):**
   Use TCP probes:
   ```yaml
   app:
     probes:
       liveness:
         type: tcp
       readiness:
         type: tcp
   ```

   **If your app needs custom checks (e.g., exec a command):**
   Override via Helm values:
   ```yaml
   app:
     probes:
       liveness:
         type: exec
         command: ["/bin/sh", "-c", "pg_isready -U postgres"]
   ```

   **Tuning timeouts:**
   ```yaml
   app:
     probes:
       liveness:
         path: /healthz
         initialDelaySeconds: 30   # Slow-starting apps
         periodSeconds: 10
         timeoutSeconds: 5
         failureThreshold: 3
   ```
   ```

2. Verify the Helm chart templates actually support `type: tcp` and `type: exec` probes. If not, add support to the `sre-lib` deployment template.

**Acceptance Criteria:**
- Developer guide covers HTTP, TCP, and exec probe types
- Slow-starting app guidance (initialDelaySeconds) is included
- If chart templates don't support all probe types, they are updated

---

### Task 9.18: Add Secret Rotation Documentation

**Problem:** OpenBao + ESO handle secret syncing, but there's no developer-facing documentation on what happens when a secret changes. Do pods auto-restart? How does rotation work?

**Steps:**
1. Add a "Secret Rotation" section to `docs/developer-guide.md`:

   ```markdown
   ## Secret Rotation

   Secrets are synced from OpenBao to Kubernetes every hour (configurable via
   `refreshInterval` on ExternalSecret). When a secret changes in OpenBao:

   1. ESO detects the change on the next sync cycle (up to 1 hour)
   2. ESO updates the Kubernetes Secret
   3. **Pods do NOT auto-restart** — they continue using the old value from memory

   **To pick up new secrets, you must restart your pods:**
   ```bash
   kubectl rollout restart deployment/<app> -n <team>
   ```

   **For automatic restarts on secret change:**
   Add the Reloader annotation to your HelmRelease values. This uses Stakater
   Reloader (if deployed) to watch for Secret changes and restart pods:
   ```yaml
   app:
     podAnnotations:
       reloader.stakater.com/auto: "true"
   ```

   **Alternatively, use a hash annotation pattern** (built into the chart):
   The deployment template can include a checksum of the secret, causing Kubernetes
   to recreate pods when the secret content changes:
   ```yaml
   app:
     podAnnotations:
       checksum/secrets: '{{ include (print .Template.BasePath "/externalsecret.yaml") . | sha256sum }}'
   ```

   **Best practice:** Design your app to re-read secrets from environment variables
   or mounted files periodically, rather than caching them at startup.
   ```

2. Check if Stakater Reloader is deployed in the cluster. If not, document the checksum approach as the primary pattern.

3. If the Helm chart templates don't support `podAnnotations`, add support.

**Acceptance Criteria:**
- Developer guide explains secret rotation lifecycle
- At least one auto-restart method is documented
- Developers understand the delay between OpenBao update and pod pickup

---

### Task 9.19: Add Local Development Testing Guide

**Problem:** There's a devcontainer for working on the platform itself, but no guidance on how developers test their apps locally against the SRE platform patterns (security contexts, probes, resource limits) before pushing.

**Steps:**
1. Create `docs/local-development.md`:

   ```markdown
   # Local Development

   ## Testing Your App Meets SRE Requirements

   Before pushing to the cluster, verify your container meets platform requirements
   locally:

   **1. Test non-root execution:**
   ```bash
   docker run --user 1000:1000 --read-only \
     --tmpfs /tmp --tmpfs /var/cache \
     your-app:v1.0.0
   ```
   If this fails, your app won't pass the Kyverno security context policy.

   **2. Test health endpoints:**
   ```bash
   docker run -d -p 8080:8080 your-app:v1.0.0
   curl http://localhost:8080/healthz   # Must return 200
   curl http://localhost:8080/readyz    # Must return 200
   ```

   **3. Dry-run Helm template to catch config errors:**
   ```bash
   helm template my-app apps/templates/web-app/ \
     --set app.name=my-app \
     --set app.team=my-team \
     --set app.image.repository=harbor.apps.sre.example.com/my-team/my-app \
     --set app.image.tag=v1.0.0 \
     | kubectl apply --dry-run=client -f -
   ```

   **4. Scan your image locally before pushing:**
   ```bash
   trivy image your-app:v1.0.0
   ```
   The pipeline will reject CRITICAL-severity CVEs.

   **5. Test Kyverno policies locally:**
   ```bash
   # Generate your manifests
   helm template my-app apps/templates/web-app/ -f my-values.yaml > rendered.yaml

   # Test against SRE policies
   kyverno apply policies/custom/ -r rendered.yaml
   kyverno apply policies/baseline/ -r rendered.yaml
   kyverno apply policies/restricted/ -r rendered.yaml
   ```

   ## Port-Forwarding to Cluster Services

   During development, access cluster services locally:
   ```bash
   kubectl port-forward svc/my-app -n my-team 8080:8080    # Your app
   kubectl port-forward svc/monitoring-grafana -n monitoring 3000:80  # Grafana
   kubectl port-forward svc/harbor -n harbor 8443:443       # Harbor UI
   ```
   ```

2. Link from `docs/developer-guide.md` and `docs/getting-started-developer.md`

**Acceptance Criteria:**
- `docs/local-development.md` exists with practical pre-push verification steps
- Docker non-root and read-only testing is documented
- Local Kyverno policy testing via CLI is documented
- Port-forward instructions for common services are included

---

### Task 9.20: Add API Rate Limiting Pattern via Istio

**Problem:** Developers deploying public-facing APIs have no way to protect against abuse or excessive traffic. Istio supports rate limiting via EnvoyFilter or the Istio `local` rate limit API, but there's no template or documentation.

**Steps:**
1. Add an optional `rateLimit` section to `sre-web-app` and `sre-api-service` values:
   ```yaml
   rateLimit:
     enabled: false
     requestsPerSecond: 100
     burst: 200
   ```

2. Create `templates/envoyfilter-ratelimit.yaml`:
   ```yaml
   {{- if .Values.rateLimit.enabled }}
   apiVersion: networking.istio.io/v1alpha3
   kind: EnvoyFilter
   metadata:
     name: {{ include "sre-lib.fullname" . }}-ratelimit
     namespace: {{ .Release.Namespace }}
   spec:
     workloadSelector:
       labels:
         app.kubernetes.io/name: {{ .Values.app.name }}
     configPatches:
       - applyTo: HTTP_FILTER
         match:
           context: SIDECAR_INBOUND
           listener:
             filterChain:
               filter:
                 name: envoy.filters.network.http_connection_manager
         patch:
           operation: INSERT_BEFORE
           value:
             name: envoy.filters.http.local_ratelimit
             typed_config:
               "@type": type.googleapis.com/udpa.type.v1.TypedStruct
               type_url: type.googleapis.com/envoy.extensions.filters.http.local_ratelimit.v3.LocalRateLimit
               value:
                 stat_prefix: http_local_rate_limiter
                 token_bucket:
                   max_tokens: {{ .Values.rateLimit.burst | default 200 }}
                   tokens_per_fill: {{ .Values.rateLimit.requestsPerSecond | default 100 }}
                   fill_interval: 1s
                 filter_enabled:
                   runtime_key: local_rate_limit_enabled
                   default_value:
                     numerator: 100
                     denominator: HUNDRED
                 filter_enforced:
                   runtime_key: local_rate_limit_enforced
                   default_value:
                     numerator: 100
                     denominator: HUNDRED
                 response_headers_to_add:
                   - append_action: OVERWRITE_IF_EXISTS_OR_ADD
                     header:
                       key: x-local-rate-limit
                       value: "true"
   {{- end }}
   ```

3. Document in `docs/developer-guide.md`:
   ```markdown
   ## Rate Limiting

   Protect your service from excessive traffic:
   ```yaml
   rateLimit:
     enabled: true
     requestsPerSecond: 100   # Sustained rate
     burst: 200                # Burst allowance
   ```

   This applies Istio local rate limiting at the sidecar level. Requests exceeding
   the limit receive HTTP 429 (Too Many Requests) with header `x-local-rate-limit: true`.
   ```

**Acceptance Criteria:**
- `helm template` renders valid EnvoyFilter when `rateLimit.enabled: true`
- Rate-limited requests return 429 with appropriate header
- Documentation explains the configuration

---

## Phase 10: Dashboard & DSOP Wizard UI/UX Enhancements

These tasks improve the self-service experience in the web UI. All changes are in `apps/dashboard/` (Node.js + React) and `apps/dsop-wizard/` (React + TypeScript + Vite).

**Current state of the dashboard:** 7 tabs (Overview, Deploy, Applications, Security, Operations, Compliance, Admin), 80+ API endpoints, RBAC via OAuth2 Proxy headers, polling-based real-time updates (5-30s intervals).

**Current state of the DSOP wizard:** 7-step guided deployment with real-time pipeline status polling, security exception requests, ISSM review gate, compliance package download. Session persists via sessionStorage (per-tab only).

---

### Task 10.1: Add Team-Scoped Dashboard View

**Problem:** All users see all namespaces. A developer on team-alpha sees team-beta's pods, apps, and events. There's no team filter — the UI dumps everything.

**Where:** `apps/dashboard/client/src/` — all tab components that list resources

**Steps:**
1. Add a team/namespace selector dropdown in the dashboard header (next to the health indicator). Populate it from the user's Keycloak groups (the `X-Auth-Request-Groups` header already contains `team-alpha-developers`, etc.).
2. Parse the team name from the group (strip `-developers`/`-viewers` suffix).
3. Store the selected team in React state (and localStorage for persistence).
4. Pass the selected namespace as a query parameter to all API calls: `/api/apps?namespace=team-alpha`, `/api/cluster/pods?namespace=team-alpha`, etc.
5. Update the server-side API routes to accept and filter by the `namespace` query param.
6. Admin users (`sre-admins` group) see an "All Namespaces" option; regular users only see their team(s).
7. The Overview tab metrics should scope to the selected team when filtered.

**Acceptance Criteria:**
- Dropdown in header shows the user's team(s) + "All" for admins
- Selecting a team filters Applications, Operations pods/events, and Security pipeline runs
- Filter persists across tab switches and page refreshes
- Admins can switch between teams or view all

---

### Task 10.2: Add One-Click Rollback in Applications Tab

**Problem:** Developers have no UI to roll back a bad deployment. They must use CLI (git revert, flux reconcile, or helm rollback). The Applications tab shows apps but has no rollback action.

**Where:** `apps/dashboard/client/src/` — Applications tab, app action buttons. `apps/dashboard/server.js` or equivalent route file.

**Steps:**
1. Add a "Rollback" button next to the existing "Restart" and "Delete" actions for each app in the Applications tab.
2. When clicked, show a modal with:
   - Current image tag (e.g., `v1.2.0`)
   - A dropdown of previous image tags (from Helm release history: `helm history <release> -n <namespace> -o json`)
   - A "Rollback to version X" confirmation button
3. Create a new server endpoint: `POST /api/apps/:namespace/:name/rollback` that:
   a. Gets the Helm release history
   b. Rolls back to the specified revision: `helm rollback <release> <revision> -n <namespace>`
   c. Returns success/failure
4. After rollback, show a toast notification and refresh the app status.
5. RBAC: Only users in the team's `-developers` group or `sre-admins` can rollback.

**Acceptance Criteria:**
- Rollback button visible on each app in Applications tab
- Modal shows version history and allows selecting a target revision
- Rollback executes via Helm and reports success/failure
- App status refreshes after rollback

---

### Task 10.3: Add Kyverno Policy Violations to Security Tab

**Problem:** The Security tab has a "Policy Violations" card that says "Kyverno integration coming." This is a placeholder. PolicyReports exist in the cluster but aren't surfaced in the UI.

**Where:** `apps/dashboard/client/src/` — Security tab. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/security/policy-violations` that queries:
   ```bash
   kubectl get policyreport -A -o json
   kubectl get clusterpolicyreport -o json
   ```
   And returns a summary: total violations by severity (critical/high/medium/low), by namespace, by policy name.

2. Create server endpoint: `GET /api/security/policy-violations/:namespace` for detailed violations in a specific namespace.

3. In the Security tab, replace the "coming soon" placeholder with:
   - Summary cards: Critical/High/Medium/Low violation counts
   - Table: namespace, resource, policy name, rule name, message, severity, timestamp
   - Filter by namespace (use the team selector from Task 10.1)
   - Click to expand the violation details and show the fix recommendation

4. Add a link from each violation to the policy exception process (`policies/custom/policy-exceptions/README.md`) for cases where the violation can't be fixed.

**Acceptance Criteria:**
- Security tab shows real Kyverno PolicyReport data
- Violations are filterable by namespace and severity
- "Coming soon" placeholder is removed
- Each violation links to how to fix it or request an exception

---

### Task 10.4: Add Resource Quota Visualization

**Problem:** Each tenant namespace has ResourceQuota and LimitRange, but developers can't see how much of their quota they've used. They only find out when a deploy fails with "exceeds quota."

**Where:** `apps/dashboard/client/src/` — Overview tab or new "Resources" sub-section. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/namespaces/:namespace/quota` that returns:
   - ResourceQuota spec (hard limits) and status (used)
   - LimitRange defaults
2. In the Overview tab (or a new section in Applications), show a resource usage widget for the selected team:
   - Progress bars for: CPU requests used/total, Memory requests used/total, Pods used/total
   - Color coding: green (<70%), yellow (70-90%), red (>90%)
   - Show the LimitRange defaults so developers know what each pod costs
3. Add a warning banner when any resource is >80% of quota.

**Acceptance Criteria:**
- Resource usage is visible per namespace with progress bars
- Warning when approaching quota limits
- Developers know their limits before a deploy fails

---

### Task 10.5: Add Post-Deploy Health Monitoring to DSOP Wizard Step 7

**Problem:** After deployment (Step 7), the wizard shows success with links but no health status. If the app crashes immediately (CrashLoopBackOff, ImagePullBackOff), the developer has to leave the wizard and check the Operations tab or kubectl.

**Where:** `apps/dsop-wizard/src/components/steps/Step7_Complete.tsx`

**Steps:**
1. After deployment completes, start polling the app's pod status: `GET /api/deploy/:namespace/:name/status`
2. Show a health section in Step 7 with:
   - Pod status (Running, Pending, CrashLoopBackOff, etc.)
   - Ready replicas vs desired
   - If unhealthy after 60s: show the pod's last log lines and events
   - Link to full logs in the dashboard
3. Use a simple state machine: `Deploying → Starting → Healthy / Unhealthy`
4. Show health indicator with color: green (all pods ready), yellow (starting), red (failed)

**Acceptance Criteria:**
- Step 7 shows live pod health status after deployment
- CrashLoopBackOff or ImagePullBackOff are detected and shown within 60s
- Pod logs are accessible from the wizard for failed deployments
- Healthy deployments show a green status with the app URL

---

### Task 10.6: Add Deployment History Timeline to Applications Tab

**Problem:** The Applications tab shows current state but not history. Developers can't see what version was running yesterday, when the last deploy happened, or who triggered it.

**Where:** `apps/dashboard/client/src/` — Applications tab, app detail view. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/apps/:namespace/:name/history` that returns:
   - Helm release history (`helm history <release> -n <namespace> -o json`)
   - Returns: revision, status, chart version, app version, description, updated timestamp
2. When a developer clicks on an app, show an expandable "History" section with:
   - Timeline of deployments (newest first)
   - Each entry: version, timestamp, status (deployed/failed/superseded/rolled_back), description
   - Rollback button per entry (reuses Task 10.2 rollback API)
3. Limit to last 20 revisions.

**Acceptance Criteria:**
- Each app has an expandable history showing version timeline
- Failed deployments are clearly marked
- Rollback is available from any history entry

---

### Task 10.7: Add Embedded Log Viewer in Applications Tab

**Problem:** Viewing logs requires leaving the dashboard to use kubectl or Grafana. The Operations tab has a basic "view logs" action that opens a pod's logs, but there's no searchable, streaming log viewer.

**Where:** `apps/dashboard/client/src/` — Applications tab. `apps/dashboard/server.js`.

**Steps:**
1. The existing `GET /api/cluster/pods/:namespace/:name/logs` endpoint returns logs. Extend it to support:
   - `?follow=true` for streaming (use Server-Sent Events)
   - `?since=1h` for time-based filtering
   - `?container=<name>` for multi-container pods
2. Add a "Logs" panel in the Applications tab that opens inline (slide-out panel or modal) when clicking "View Logs" on an app.
3. The log viewer should have:
   - Auto-scroll to bottom (with toggle to pause)
   - Search/filter within logs
   - Container selector dropdown (for pods with sidecars)
   - Time range selector (last 15m, 1h, 6h, 24h)
   - Download logs button
4. Use a monospace font, line numbers, and level-based color highlighting (ERROR=red, WARN=yellow, INFO=default).

**Acceptance Criteria:**
- Log viewer opens inline from the Applications tab
- Logs stream in near-real-time via SSE
- Search, container selection, and time filtering work
- JSON log lines are syntax-highlighted

---

### Task 10.8: Add Tenant Self-Service Onboarding Form

**Problem:** New teams must ask a platform admin to run `scripts/onboard-tenant.sh`. There's no way to request a namespace from the UI.

**Where:** `apps/dashboard/client/src/` — Admin tab (or new "Onboarding" section). `apps/dashboard/server.js`.

**Steps:**
1. Add a "Request Namespace" card to the Deploy tab (visible to all authenticated users).
2. The form collects: team name, team contact email, expected workload description, resource tier (small/medium/large mapping to different quotas).
3. For admin users: form directly triggers onboarding by calling a new server endpoint:
   `POST /api/admin/tenants` that runs the equivalent of `onboard-tenant.sh`:
   - Creates namespace manifests in `apps/tenants/<team>/`
   - Creates Harbor project
   - Creates OpenBao KV path
   - Creates Keycloak groups (from Task 2.2)
   - Generates Istio AuthorizationPolicies (from Task 2.1)
   - Commits to Git and pushes (Flux handles the rest)
4. For non-admin users: form creates a request that appears in the Admin tab for approval (store in a ConfigMap or CRD until approved).
5. Show onboarding status: pending approval → provisioning → ready.

**Acceptance Criteria:**
- Any authenticated user can request a namespace from the UI
- Admins can approve/provision directly
- Onboarding creates all required resources (namespace, RBAC, quota, policies, Keycloak groups, Harbor project)
- Status is visible until provisioning completes

---

### Task 10.9: Add Service Dependency Graph

**Problem:** As teams deploy multiple services, there's no visualization of how they connect. Istio has all the traffic data, but it's only visible in Kiali (if deployed) or Grafana.

**Where:** `apps/dashboard/client/src/` — new sub-tab in Applications or Operations. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/mesh/graph?namespace=<team>` that queries Prometheus for Istio traffic metrics:
   ```promql
   sum(rate(istio_requests_total{source_workload_namespace="team-alpha"}[5m])) by (source_workload, destination_workload, destination_workload_namespace)
   ```
2. Return a graph structure: nodes (workloads) and edges (traffic with request rate, error rate).
3. Render using a graph visualization library (e.g., `@xyflow/react` / React Flow, or `vis-network`, or `d3-force`).
4. Each node shows: service name, namespace, request rate, error rate badge.
5. Each edge shows: requests/sec, color-coded by error rate (green=healthy, red=errors).
6. Allow filtering by namespace.

**Acceptance Criteria:**
- Service graph shows real-time traffic between services
- Error rates are visually highlighted
- Filterable by namespace/team
- Updates on 30s polling interval

---

### Task 10.10: Add Export Deployment as YAML

**Problem:** Developers who deploy via the Dashboard's Quick Deploy or DSOP wizard can't see or export the generated HelmRelease YAML. If they want to version-control their deployment or modify it later via GitOps, they need the YAML.

**Where:** `apps/dashboard/client/src/` — Applications tab, per-app actions. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/apps/:namespace/:name/manifest` that returns the HelmRelease YAML from the cluster:
   ```bash
   kubectl get helmrelease <name> -n <namespace> -o yaml
   ```
2. Add an "Export YAML" button in the Applications tab per-app actions.
3. When clicked, show a modal with the YAML in a code editor (read-only, monospace, syntax highlighted).
4. Include a "Copy to Clipboard" button and a "Download" button.
5. Add a note: "Save this file to `apps/tenants/<team>/apps/<name>.yaml` in the Git repo to manage this deployment via GitOps."

**Acceptance Criteria:**
- Export button available for every app
- YAML is correctly formatted and valid
- Copy and download both work
- Instructions for GitOps management are included

---

### Task 10.11: Add Pipeline Retry on Failed Gates in DSOP Wizard

**Problem:** When a DSOP pipeline gate fails, the developer has no retry option. They must start the entire wizard over or ask an admin to override.

**Where:** `apps/dsop-wizard/src/components/pipeline/GateCard.tsx` and API.

**Steps:**
1. Add a "Retry" button on each failed gate card in Step 4.
2. Create or use an existing server endpoint: `POST /api/pipeline/:runId/gates/:gateId/retry`
3. When retried, the gate status resets to "running" and the gate re-executes.
4. Show retry count on the gate card (e.g., "Retry 2/3").
5. Limit to 3 retries per gate. After 3 failures, show "Request Exception" button instead.

**Acceptance Criteria:**
- Failed gate cards show a "Retry" button
- Retry re-executes the specific gate (not the entire pipeline)
- Retry count is visible
- After max retries, exception request is offered

---

### Task 10.12: Add Notification Center

**Problem:** Deployment events, policy violations, pipeline completions, and alerts happen asynchronously. The dashboard shows some of this scattered across tabs, but there's no centralized notification feed.

**Where:** `apps/dashboard/client/src/` — new component in header. `apps/dashboard/server.js`.

**Steps:**
1. Add a bell icon in the dashboard header with an unread count badge.
2. Clicking opens a notification panel (slide-out from right).
3. Aggregate events from:
   - Deployment status changes (deployed, failed, rolled back)
   - Pipeline completions (passed, failed, needs review)
   - Kyverno policy violations (new violations in user's namespace)
   - Prometheus alerts firing for user's namespace
   - PolicyException expiry warnings
4. Create server endpoint: `GET /api/notifications?namespace=<team>&since=<timestamp>` that aggregates from Kubernetes events + pipeline DB + Prometheus alerts.
5. Each notification: type icon, title, message, timestamp, link to relevant dashboard section.
6. Mark as read functionality. Persist read state in localStorage.

**Acceptance Criteria:**
- Bell icon with unread count in header
- Notification panel shows recent events scoped to user's team
- Click notification to navigate to relevant section
- Unread count updates on polling interval

---

### Task 10.13: Add Database Management UI

**Problem:** The Deploy tab can provision PostgreSQL via CloudNativePG, but there's no UI to view existing databases, their health, connection info, or backup status.

**Where:** `apps/dashboard/client/src/` — new "Databases" sub-section in Applications tab. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/databases?namespace=<team>` that lists CNPG Cluster resources:
   ```bash
   kubectl get clusters.postgresql.cnpg.io -n <namespace> -o json
   ```
2. Show a database card per cluster with:
   - Name, namespace, instances (running/total), storage size
   - Status: healthy/degraded/failed
   - Connection info (host, port, database name — from the `-app` secret, NOT the password)
   - Last backup time and status (from CNPG Cluster status)
3. Actions: "Connection Info" (shows host/port/dbname), "Restart" (deletes primary pod for failover test), "Delete".
4. The connection info modal should show the ExternalSecret pattern for getting credentials into an app.

**Acceptance Criteria:**
- Databases are listed with health status
- Connection info (non-secret) is viewable
- Backup status is visible
- Delete requires confirmation

---

### Task 10.14: Add Secrets Sync Status Dashboard

**Problem:** ExternalSecrets sync from OpenBao on a 1-hour refresh interval. If a sync fails, developers have no visibility — their app just uses stale secrets. There's no UI showing ExternalSecret health.

**Where:** `apps/dashboard/client/src/` — new sub-section in Operations or Applications tab. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/secrets/status?namespace=<team>` that lists ExternalSecret resources:
   ```bash
   kubectl get externalsecrets -n <namespace> -o json
   ```
2. Show a table with:
   - Secret name, namespace, status (SecretSynced/SecretSyncedError), last synced time, refresh interval
   - Red indicator for sync errors with the error message
3. Add a "Force Sync" button that annotates the ExternalSecret to trigger immediate refresh:
   ```bash
   kubectl annotate externalsecret <name> -n <namespace> force-sync=$(date +%s) --overwrite
   ```
4. Do NOT show secret values — only sync status.

**Acceptance Criteria:**
- ExternalSecret sync status is visible per namespace
- Sync errors are highlighted with error messages
- Force sync button triggers immediate refresh
- No secret values are exposed in the UI

---

### Task 10.15: Add Canary Deployment Progress to Applications Tab

**Problem:** Flagger canary deployments exist (Task 9.7) but there's no UI to monitor canary progress. Developers must use `kubectl get canary` to see traffic weight and analysis status.

**Where:** `apps/dashboard/client/src/` — Applications tab, per-app detail. `apps/dashboard/server.js`.

**Steps:**
1. Create server endpoint: `GET /api/apps/:namespace/:name/canary` that returns the Flagger Canary CRD status:
   ```bash
   kubectl get canary <name> -n <namespace> -o json
   ```
2. If the app has a canary in progress, show a canary progress widget in the app detail:
   - Progress bar: current traffic weight (0% → maxWeight)
   - Phase: Initializing, Progressing, Promoting, Succeeded, Failed
   - Metrics: success rate, latency, threshold
   - Timeline of canary analysis iterations
3. If canary failed: show the failure reason and "Rollback" action.
4. If no canary: don't show the widget.

**Acceptance Criteria:**
- Canary progress is visible in the Applications tab for apps with Flagger
- Traffic weight, success rate, and phase are shown in real-time
- Failed canaries show failure reason

---

### Task 10.16: Add Harbor Credentials Self-Service

**Problem:** Developers need Harbor robot account credentials to push images. Currently only admins can create robot accounts (Admin tab > Credentials). Developers must ask an admin or use the shared credentials.

**Where:** `apps/dashboard/client/src/` — Deploy tab or a "Credentials" section accessible to developers. `apps/dashboard/server.js`.

**Steps:**
1. Add a "Get Push Credentials" card in the Deploy tab.
2. When clicked, show the team's existing Harbor robot account credentials (from OpenBao, stored by Task 2.3).
3. Create server endpoint: `GET /api/credentials/:namespace/harbor` that:
   - Reads the robot credentials from OpenBao at `sre/<team>/harbor-robot`
   - Returns username only (not password) for display
   - Returns password only when explicitly requested (behind a "Show Password" button)
4. Include "Copy docker login command" button:
   ```
   docker login harbor.apps.sre.example.com -u <robot-name> -p <password>
   ```
5. RBAC: Only users in the team's `-developers` group can view credentials.

**Acceptance Criteria:**
- Developers can retrieve their team's Harbor credentials without admin help
- Password is hidden until explicitly revealed
- Docker login command is copy-paste ready
- Only the team's own credentials are visible

---

### Task 10.17: Add Compliance Evidence Export

**Problem:** The Compliance tab shows NIST 800-53 control mappings with health indicators, but there's no way to export this as an ATO evidence package. Assessors need downloadable artifacts.

**Where:** `apps/dashboard/client/src/` — Compliance tab. `apps/dashboard/server.js`.

**Steps:**
1. Add an "Export ATO Package" button to the Compliance tab.
2. Create server endpoint: `GET /api/compliance/export` that generates a ZIP containing:
   - `ssp.json` — OSCAL System Security Plan with current control implementation status
   - `policy-reports.json` — All Kyverno PolicyReport data
   - `helm-releases.json` — All HelmRelease statuses (proves components are deployed)
   - `scan-results/` — Latest Trivy scan results from Harbor for deployed images
   - `certificate-status.json` — cert-manager Certificate statuses
   - `network-policies.json` — All NetworkPolicies across tenant namespaces
   - `timestamp.txt` — Generation timestamp for evidence freshness
3. The export should be dated and include a hash for integrity verification.

**Acceptance Criteria:**
- One-click export generates a ZIP with compliance evidence
- Evidence is machine-readable (JSON) for assessor tooling
- Export includes timestamp and integrity hash
- All NIST control families have at least one evidence artifact

---

### Task 10.18: Add DSOP Wizard Theme Sync

**Problem:** The DSOP wizard opens in an iframe from the dashboard. The dashboard has a dark/light theme toggle, but the wizard always renders in its own theme. They look visually inconsistent.

**Where:** `apps/dsop-wizard/src/` — App.tsx and Tailwind config. `apps/dashboard/client/src/` — wherever the iframe is rendered.

**Steps:**
1. Pass the dashboard's current theme to the wizard via URL parameter: `?theme=dark` or `?theme=light`
2. In the wizard's App.tsx, read the theme param on mount and apply the appropriate Tailwind `dark` class.
3. If no theme param, default to system preference (`prefers-color-scheme`).
4. Ensure all wizard components use Tailwind dark mode variants (`dark:bg-gray-900`, `dark:text-white`, etc.).

**Acceptance Criteria:**
- Wizard theme matches the dashboard's theme setting
- Theme passed via URL parameter (no cross-origin postMessage needed)
- Both dark and light modes look correct in the wizard

---

### Task 10.19: Add Pipeline ETA and Duration to DSOP Wizard

**Problem:** During the DSOP pipeline (Step 4), the developer sees gates transitioning but has no idea how long the pipeline will take. There's no ETA or historical duration data.

**Where:** `apps/dsop-wizard/src/components/steps/Step4_SecurityPipeline.tsx` and `apps/dsop-wizard/src/hooks/usePipelinePolling.ts`.

**Steps:**
1. Create or extend server endpoint to return average gate durations from historical runs: `GET /api/pipeline/stats/durations`
2. Return: per-gate average duration (e.g., SAST: 45s, Trivy: 30s, SBOM: 15s, etc.)
3. In the wizard Step 4, show:
   - Overall ETA bar: "Estimated: ~3 minutes remaining"
   - Per-gate: "Usually takes ~45 seconds" next to each running gate
   - Elapsed time for the overall pipeline
4. Update the ETA as gates complete (subtract completed gate time from total estimate).

**Acceptance Criteria:**
- Overall ETA displayed during pipeline execution
- Per-gate estimated duration shown
- ETA updates as gates complete
- First run (no history) shows "Estimating..." instead of a number

---

### Task 10.20: Add Shareable Pipeline Run URL

**Problem:** After a DSOP pipeline runs, developers can't share the results with reviewers or colleagues. The pipeline run exists in sessionStorage which is per-tab. The wizard supports `?runId=` but this isn't surfaced in the UI.

**Where:** `apps/dsop-wizard/src/components/steps/Step4_SecurityPipeline.tsx` and `Step7_Complete.tsx`.

**Steps:**
1. When a pipeline run starts (Step 4), update the browser URL to include the run ID: `https://dsop.apps.sre.example.com/?runId=<id>`
2. Show a "Copy Link" button next to the pipeline run header.
3. In Step 7 (Complete), include a "Share Results" card with:
   - Copyable URL to the pipeline run
   - Note: "Share this link with your ISSM reviewer or team members"
4. When someone opens a shared link, the wizard loads the run from the API and displays the results (read-only for non-owners).
5. Read-only mode: hide "Deploy" and "Retry" buttons; show "This is a shared view" banner.

**Acceptance Criteria:**
- Browser URL updates with `?runId=` when pipeline starts
- Copy link button is visible in Step 4 and Step 7
- Shared links load the pipeline results in read-only mode
- Non-authenticated users are redirected to login first

---

## Phase 11: Deep-Link All Evidence and Service Links

Every link in the dashboard that points to an external service (Grafana, NeuVector, Harbor, Keycloak) currently goes to the service's homepage. These links should deep-link to the specific dashboard, page, or view that is relevant to the context where the link appears.

**Current state:** All links resolve via `serviceUrl(config, 'grafana')` → `https://grafana.apps.sre.example.com` (generic homepage). The Compliance tab, Security tab, Overview, and Operations tab all share this pattern.

**Key file:** `apps/dashboard/client/src/context/ConfigContext.tsx` — the `serviceUrl()` helper function.

**Architecture change:** Replace the single `serviceUrl(config, name)` pattern with a `deepLink(config, service, target)` helper that builds context-specific URLs.

---

### Task 11.1: Build Deep-Link URL Helper

**Where:** `apps/dashboard/client/src/context/ConfigContext.tsx` (or create a new `utils/deepLinks.ts`)

**Steps:**
1. Create a deep-link mapping that resolves service + context to a specific URL path:

```typescript
type DeepLinkTarget =
  // Grafana dashboards
  | 'grafana:cluster-overview'
  | 'grafana:kyverno-violations'
  | 'grafana:istio-mesh'
  | 'grafana:istio-workload'
  | 'grafana:cert-manager'
  | 'grafana:flux-reconciliation'
  | 'grafana:node-exporter'
  | 'grafana:loki-logs'
  | 'grafana:loki-audit-logs'
  | 'grafana:tempo-traces'
  | 'grafana:alertmanager'
  // Harbor
  | 'harbor:projects'
  | 'harbor:scan-results'
  | 'harbor:project-images'
  // NeuVector
  | 'neuvector:runtime-security'
  | 'neuvector:network-activity'
  | 'neuvector:vulnerabilities'
  | 'neuvector:compliance'
  | 'neuvector:admission-control'
  // Keycloak
  | 'keycloak:users'
  | 'keycloak:groups'
  | 'keycloak:sessions'
  | 'keycloak:events'
  // Kiali
  | 'kiali:graph'
  | 'kiali:workloads';

function deepLink(config: AppConfig, target: DeepLinkTarget, params?: Record<string, string>): string {
  const base = {
    grafana: serviceUrl(config, 'grafana'),
    harbor: serviceUrl(config, 'harbor'),
    neuvector: serviceUrl(config, 'neuvector'),
    keycloak: serviceUrl(config, 'keycloak'),
    kiali: serviceUrl(config, 'kiali'),
  };

  const paths: Record<DeepLinkTarget, string> = {
    // Grafana - use dashboard UIDs (stable across installs if provisioned via ConfigMaps)
    'grafana:cluster-overview': '/d/cluster-overview/kubernetes-cluster-overview',
    'grafana:kyverno-violations': '/d/kyverno/kyverno-policy-reports',
    'grafana:istio-mesh': '/d/istio-mesh/istio-mesh-dashboard',
    'grafana:istio-workload': '/d/istio-workload/istio-workload-dashboard',
    'grafana:cert-manager': '/d/cert-manager/cert-manager',
    'grafana:flux-reconciliation': '/d/flux/flux-cluster-stats',
    'grafana:node-exporter': '/d/node-exporter/node-exporter-full',
    'grafana:loki-logs': '/explore?orgId=1&left={"datasource":"Loki","queries":[{"refId":"A","expr":"{namespace=\\"${namespace}\\"}"}]}',
    'grafana:loki-audit-logs': '/explore?orgId=1&left={"datasource":"Loki","queries":[{"refId":"A","expr":"{job=\\"systemd-journal\\"} |= \\"audit\\""}]}',
    'grafana:tempo-traces': '/explore?orgId=1&left={"datasource":"Tempo"}',
    'grafana:alertmanager': '/alerting/list',
    // Harbor
    'harbor:projects': '/harbor/projects',
    'harbor:scan-results': '/harbor/projects/${project}/repositories',
    'harbor:project-images': '/harbor/projects/${project}/repositories',
    // NeuVector
    'neuvector:runtime-security': '/#/security-events',
    'neuvector:network-activity': '/#/network-activity',
    'neuvector:vulnerabilities': '/#/vulnerabilities',
    'neuvector:compliance': '/#/compliance',
    'neuvector:admission-control': '/#/admission-control',
    // Keycloak
    'keycloak:users': '/admin/realms/sre/users',
    'keycloak:groups': '/admin/realms/sre/groups',
    'keycloak:sessions': '/admin/realms/sre/sessions',
    'keycloak:events': '/admin/realms/sre/events',
    // Kiali
    'kiali:graph': '/kiali/console/graph/namespaces/?namespaces=${namespace}',
    'kiali:workloads': '/kiali/console/workloads?namespaces=${namespace}',
  };

  const [service] = target.split(':');
  let path = paths[target] || '';

  // Substitute params like ${namespace}, ${project}
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      path = path.replace(`\${${key}}`, encodeURIComponent(value));
    });
  }

  return base[service as keyof typeof base] + path;
}
```

2. Export this function for use across all dashboard components.

**Note:** Grafana dashboard UIDs depend on how dashboards are provisioned. If dashboards are provisioned via ConfigMaps (Task 9.9), the UIDs can be deterministic. If using kube-prometheus-stack defaults, check the actual UIDs from the Grafana API: `GET /api/search?type=dash-db`. The UIDs above are examples — replace with actual UIDs from the deployed Grafana.

**Acceptance Criteria:**
- `deepLink()` function exists and is importable
- All link targets resolve to specific paths (not homepages)
- Params (namespace, project) are substituted correctly

---

### Task 11.2: Deep-Link Compliance Tab Evidence Sources

**Problem:** The Compliance tab's NIST control evidence links all go to service homepages. An assessor clicking "Grafana" for AU-2 (Audit Events) should land on the audit log dashboard, not the Grafana login page.

**Where:** `apps/dashboard/client/src/components/compliance/ComplianceTab.tsx` — the `CONTROL_FAMILIES` array and `resolveUrl()` function (lines 179-204).

**Steps:**
1. Replace the generic `SVC_GRAFANA`, `SVC_NEUVECTOR`, etc. tokens in the `CONTROL_FAMILIES` evidence source definitions with specific deep-link targets. The mapping should be:

| NIST Control | Current Link | Should Deep-Link To |
|---|---|---|
| AC-2 (Account Management) | Keycloak homepage | `keycloak:users` — User management page |
| AC-3 (Access Enforcement) | Grafana homepage | `grafana:kyverno-violations` — Policy violation dashboard |
| AC-6(9) (Auditing Privileged Functions) | Grafana homepage | `grafana:loki-audit-logs` — Audit log explorer |
| AU-2 (Audit Events) | Grafana homepage | `grafana:loki-audit-logs` — Audit log explorer |
| AU-6 (Audit Review, Analysis) | Grafana homepage | `grafana:loki-logs` — Log explorer (general) |
| CA-7 (Continuous Monitoring) | Grafana + NeuVector | `grafana:cluster-overview` + `neuvector:runtime-security` |
| CA-8 (Vulnerability Testing) | Harbor homepage | `harbor:scan-results` — Vulnerability scan results |
| CM-2 (Baseline Configuration) | Grafana homepage | `grafana:flux-reconciliation` — Flux drift detection |
| CM-6 (Configuration Settings) | Grafana homepage | `grafana:kyverno-violations` — Configuration compliance |
| IA-2 (Identification/Auth) | Keycloak homepage | `keycloak:sessions` — Active sessions |
| IA-5 (Authenticator Management) | Grafana homepage | `grafana:cert-manager` — Certificate lifecycle |
| IR-4 (Incident Handling) | Grafana homepage | `grafana:alertmanager` — Alert history |
| RA-5 (Vulnerability Scanning) | Harbor + NeuVector | `harbor:scan-results` + `neuvector:vulnerabilities` |
| SC-8 (Transmission Confidentiality) | Grafana homepage | `grafana:istio-mesh` — mTLS enforcement dashboard |
| SI-3 (Malicious Code Protection) | NeuVector homepage | `neuvector:runtime-security` — Runtime protection events |
| SI-4 (System Monitoring) | Grafana + NeuVector | `grafana:cluster-overview` + `neuvector:network-activity` |
| SI-7 (Software Integrity) | Harbor homepage | `harbor:scan-results` — Image signature verification |

2. Update the `resolveUrl()` function to use the new `deepLink()` helper from Task 11.1.

3. For each evidence source link, show a tooltip with what the assessor will see (e.g., "Opens Grafana audit log dashboard").

**Acceptance Criteria:**
- Every evidence source link in the Compliance tab opens the specific relevant view
- Assessors see the actual evidence (audit logs, scan results, policy reports) without manual navigation
- Tooltips explain what each link shows

---

### Task 11.3: Deep-Link Security Tab Pipeline Evidence

**Problem:** Pipeline gate evidence in the Security tab is displayed inline (formatted tables), but there are no links to the source tools where the evidence came from. An ISSM reviewer should be able to jump to Harbor to see the full scan, or to Grafana to see runtime metrics.

**Where:** `apps/dashboard/client/src/components/security/` — `RunDetailOverlay.tsx`, `GateEvidenceRow.tsx`

**Steps:**
1. For each pipeline gate, add a "View in Source Tool" link that deep-links to the relevant service:

| Gate | Link Label | Deep-Link Target |
|---|---|---|
| GATE 1: SAST (Semgrep) | "View in Grafana" | `grafana:loki-logs` with filter for the pipeline run logs |
| GATE 2: SBOM (Syft) | "View in Harbor" | `harbor:project-images` for the specific image + tag |
| GATE 3: Secrets (Gitleaks) | N/A (inline only) | No external tool to link to |
| GATE 4: CVE Scan (Trivy) | "View in Harbor" | `harbor:scan-results` for the specific project |
| GATE 5: DAST (ZAP) | "View Report" | Link to SARIF artifact in GitHub Security tab (if available) |
| GATE 6: ISSM Review | "View Compliance" | Internal link to Compliance tab |
| GATE 7: Image Signing (Cosign) | "View in Harbor" | `harbor:project-images` for the specific image |
| GATE 8: Storage (Harbor) | "View in Harbor" | `harbor:project-images` for the specific image |

2. Use the pipeline run's metadata (image name, project, tag) to parameterize the deep links.

3. In the ISSM review form, add a "Quick Evidence Links" section at the top with one-click access to:
   - Harbor image scan results
   - NeuVector runtime security events
   - Grafana application metrics (if the app is already deployed)

**Acceptance Criteria:**
- Each pipeline gate has a contextual "View in [Tool]" link
- Links are parameterized with the specific image/project from the run
- ISSM reviewers have one-click access to evidence sources

---

### Task 11.4: Deep-Link Overview Tab Quick Actions

**Problem:** The Overview tab has "Open Grafana" and "Open Harbor" buttons that go to homepages.

**Where:** `apps/dashboard/client/src/components/overview/OverviewTab.tsx` (lines 336-352)

**Steps:**
1. Replace generic links with contextual deep links:
   - "Open Grafana" → `deepLink(config, 'grafana:cluster-overview')` — lands on the cluster overview dashboard
   - "Open Harbor" → `deepLink(config, 'harbor:projects')` — lands on the projects list
2. Add additional quick action buttons:
   - "View Alerts" → `deepLink(config, 'grafana:alertmanager')` — lands on alerting page
   - "View Logs" → `deepLink(config, 'grafana:loki-logs')` — lands on log explorer
   - "View Traces" → `deepLink(config, 'grafana:tempo-traces')` — lands on trace explorer

**Acceptance Criteria:**
- All quick action buttons deep-link to specific views
- Users land on actionable pages, not homepages

---

### Task 11.5: Deep-Link Operations Tab Service Tiles

**Problem:** Service health tiles in Operations tab open service homepages. The "Grafana" tile should link to the cluster overview dashboard, "Kyverno" should link to the policy reports dashboard, etc.

**Where:** `apps/dashboard/client/src/components/operations/OperationsTab.tsx` (lines 99-134) and `ServiceHealthGrid.tsx`

**Steps:**
1. Add a `deepLinkPath` field to the service status response or handle it client-side per service name:

| Service | Current URL | Deep-Link Path |
|---|---|---|
| Grafana | Homepage | `/d/cluster-overview/kubernetes-cluster-overview` |
| Prometheus | Homepage | `/targets` (show scrape targets health) |
| AlertManager | Homepage | `/#/alerts` (active alerts page) |
| Harbor | Homepage | `/harbor/projects` (projects list) |
| NeuVector | `#/login` | `#/security-events` (runtime events, auth will redirect to login if needed) |
| Keycloak | Homepage | `/admin/realms/sre/` (SRE realm admin) |
| OpenBao | `/ui/vault/auth?with=oidc` | Keep as-is (auth flow needs this) |
| Kiali | Homepage | `/kiali/console/graph/namespaces/` (service mesh graph) |

2. Update the special URL handling logic to use these paths.
3. Keep the login-redirect handling for NeuVector and OpenBao (they need auth first).

**Acceptance Criteria:**
- Each service tile opens the most useful view (not homepage)
- Auth redirects still work for NeuVector and OpenBao
- Services that require separate login still show the login warning

---

### Task 11.6: Fix Dashboard UIDs and Create Missing Dashboards

**Problem:** The 11 custom dashboards in `platform/core/monitoring/dashboards/` all use `"uid": "-- Grafana --"` (placeholder). This means Grafana auto-assigns UIDs on import, making them unpredictable for deep-linking. Additionally, several dashboards needed for deep-linking don't exist yet.

**Existing dashboards (11 in `platform/core/monitoring/dashboards/`):**

| JSON File | Current Title | UID to Set |
|---|---|---|
| `cluster-overview.json` | Cluster Summary | `sre-cluster-overview` |
| `namespace-resources.json` | Namespace Summary | `sre-namespace-resources` |
| `istio-mesh.json` | Mesh Summary | `sre-istio-mesh` |
| `kyverno-compliance.json` | Compliance Summary | `sre-kyverno-compliance` |
| `flux-gitops.json` | Flux Summary | `sre-flux-gitops` |
| `cost-allocation.json` | Namespace Cost Summary | `sre-cost-allocation` |
| `harbor-dashboard.json` | Registry Overview | `sre-harbor` |
| `neuvector-dashboard.json` | Security Overview | `sre-neuvector` |
| `keycloak-dashboard.json` | Identity Overview | `sre-keycloak` |
| `openbao-dashboard.json` | Vault Status | `sre-openbao` |
| `cert-manager-dashboard.json` | Certificate Overview | `sre-cert-manager` |

**Steps:**

**Part A: Set deterministic UIDs on existing dashboards**

1. In each of the 11 JSON files, replace `"uid": "-- Grafana --"` with the deterministic UID from the table above.
2. This ensures deep links using `/d/sre-cluster-overview/...` always resolve correctly.
3. After changing UIDs, Flux will reconcile the ConfigMaps, and Grafana sidecar will re-import the dashboards with the new UIDs.

**Part B: Create missing dashboards needed for deep-linking**

The following dashboards are referenced by deep-link targets but don't exist. Create them in `platform/core/monitoring/dashboards/`:

1. **`istio-workload.json`** — Per-workload Istio metrics dashboard
   - UID: `sre-istio-workload`
   - Panels: Request rate by workload, error rate by workload, p50/p95/p99 latency, TCP connections
   - Template variables: `$namespace`, `$workload`
   - Datasource: Prometheus
   - Queries use `istio_requests_total`, `istio_request_duration_milliseconds_bucket`
   - This is the dashboard developers need to see their app's traffic

2. **`audit-logs.json`** — Kubernetes audit log dashboard (Loki)
   - UID: `sre-audit-logs`
   - Panels: Audit events timeline, events by user, events by verb (create/update/delete), events by resource, recent audit log table
   - Datasource: Loki
   - Queries: `{job="systemd-journal"} |= "audit"` and `{namespace="kube-system", container="kube-apiserver"} | json`
   - This is the dashboard assessors need for AU-2, AU-6 compliance evidence

3. **`application-logs.json`** — Per-application log viewer dashboard (Loki)
   - UID: `sre-application-logs`
   - Panels: Log volume over time, logs table with level/message/timestamp, error rate (from log level)
   - Template variables: `$namespace`, `$app`, `$level`
   - Datasource: Loki
   - Queries: `{namespace="$namespace", container="$app"} | json`
   - This is what the "View Logs" deep link from Applications tab and pipeline evidence should open

4. **`alerting-overview.json`** — Alert history and active alerts dashboard
   - UID: `sre-alerting-overview`
   - Panels: Active alerts table, alert history timeline, alerts by severity, top firing alert rules
   - Datasource: Prometheus (AlertManager metrics)
   - Queries: `ALERTS{alertstate="firing"}`, `alertmanager_alerts`
   - This is the IR-4 (Incident Handling) evidence dashboard

5. **`node-overview.json`** — Node health dashboard (mentioned in README but not deployed)
   - UID: `sre-node-overview`
   - Panels: Node CPU/memory/disk/network, node conditions, kubelet status
   - Datasource: Prometheus
   - Queries: `node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, etc.
   - Referenced in README but was never created

**Part C: Add all new dashboards to the kustomization**

Update `platform/core/monitoring/dashboards/kustomization.yaml` to include the 5 new JSON files as ConfigMap generators with the `grafana_dashboard: "1"` label and `grafana_folder: "SRE Platform"` annotation.

**Part D: Update the deep-link mapping**

In the `deepLink()` helper from Task 11.1, use these paths:

```typescript
'grafana:cluster-overview': '/d/sre-cluster-overview/cluster-summary',
'grafana:kyverno-violations': '/d/sre-kyverno-compliance/compliance-summary',
'grafana:istio-mesh': '/d/sre-istio-mesh/mesh-summary',
'grafana:istio-workload': '/d/sre-istio-workload/workload-dashboard?var-namespace=${namespace}&var-workload=${workload}',
'grafana:cert-manager': '/d/sre-cert-manager/certificate-overview',
'grafana:flux-reconciliation': '/d/sre-flux-gitops/flux-summary',
'grafana:node-exporter': '/d/sre-node-overview/node-overview',
'grafana:loki-logs': '/d/sre-application-logs/application-logs?var-namespace=${namespace}&var-app=${app}',
'grafana:loki-audit-logs': '/d/sre-audit-logs/audit-logs',
'grafana:alertmanager': '/d/sre-alerting-overview/alerting-overview',
'grafana:harbor': '/d/sre-harbor/registry-overview',
'grafana:neuvector': '/d/sre-neuvector/security-overview',
'grafana:keycloak': '/d/sre-keycloak/identity-overview',
'grafana:openbao': '/d/sre-openbao/vault-status',
'grafana:tempo-traces': '/explore?orgId=1&left={"datasource":"Tempo"}',
```

**Acceptance Criteria:**
- All 11 existing dashboards have deterministic UIDs (not `-- Grafana --`)
- 5 new dashboards created and provisioned via ConfigMap
- Deep-link paths in Task 11.1 use real UIDs
- All deep links from the Compliance tab resolve to actual dashboards
- Template variables (`$namespace`, `$app`, `$workload`) pre-fill from the link context

---

## Execution Order Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| **Phase 1** | 1.1-1.5 | Small (policy YAML changes + Cosign setup) | CRITICAL — security enforcement |
| **Phase 2** | 2.1-2.3 | Medium (script modifications) | HIGH — onboarding automation |
| **Phase 3** | 3.1-3.3 | Small (defaults + docs) | MEDIUM — CI/CD correctness |
| **Phase 4** | 4.1-4.4 | Medium (ExternalSecret conversion) | MEDIUM — placeholder cleanup |
| **Phase 5** | 5.1-5.3 | Medium (doc writing) | MEDIUM — developer experience |
| **Phase 6** | 6.1 | Small (doc writing) | HIGH — proves the system works |
| **Phase 7** | 7.1 | Small (script writing) | LOW — reproducibility |
| **Phase 8** | 8.1-8.5 | Medium (docs + wizard + monitoring) | HIGH — override/exception self-service |
| **Phase 9** | 9.1-9.20 | Large (chart templates + docs + patterns) | HIGH — real-world integration |
| **Phase 10** | 10.1-10.20 | Large (React + Node.js + API endpoints) | MEDIUM — UI/UX polish |
| **Phase 11** | 11.1-11.6 | Medium (React + URL mapping) | HIGH — evidence deep-linking |

**Recommended parallel execution:**
- Phase 1 + Phase 3 (independent, both small)
- Phase 2 (depends on Phase 1 for Cosign key)
- Phase 4 (independent)
- Phase 5 + Phase 6 + Phase 8.1-8.2 (docs, can be done together)
- Phase 8.3 (DSOP wizard change, independent of docs)
- Phase 8.4-8.5 (monitoring + examples, independent)
- Phase 7 (independent, lowest priority)
- Phase 9 subgroups (can be parallelized):
  - **9A — Chart template features** (9.1, 9.2, 9.3, 9.5, 9.6, 9.9, 9.10, 9.14, 9.20): Helm chart changes, can be done by one or two developers in parallel
  - **9B — Documentation** (9.4, 9.7, 9.8, 9.11, 9.12, 9.13, 9.15, 9.16, 9.17, 9.18, 9.19): Pure docs, can all be written in parallel
- Phase 10 subgroups (can be parallelized):
  - **10A — Dashboard backend APIs** (10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.12, 10.13, 10.14, 10.15, 10.16, 10.17): Server endpoints + React components
  - **10B — DSOP wizard** (10.5, 10.11, 10.18, 10.19, 10.20): Wizard-specific React changes
- Phase 11 subgroups:
  - **11A — Grafana dashboards** (11.6 Parts A+B): Create missing dashboards + set deterministic UIDs. Do this FIRST — other tasks depend on the UIDs existing.
  - **11B — Deep-link wiring** (11.1, 11.2, 11.3, 11.4, 11.5): React changes to use the new `deepLink()` helper. Depends on 11A for UIDs.

---

## Verification Checklist

After all phases are complete, verify:

- [ ] `kyverno test policies/tests/` — all policy tests pass
- [ ] No `REPLACE_ME` in any file under `platform/` or `policies/` (except test fixtures)
- [ ] `grep -r "REPLACE_ME" policies/ platform/ ci/tekton/` returns zero results in live manifests
- [ ] `./scripts/onboard-tenant.sh test-verification` creates a complete tenant (namespace, RBAC, quotas, network policies, Istio auth policies, Keycloak groups, Harbor project + robot account)
- [ ] A pod deployed via sre-web-app Helm chart to the test-verification namespace starts successfully
- [ ] An unsigned image is rejected by Kyverno in the test-verification namespace
- [ ] An image from a non-Harbor registry is rejected by Kyverno
- [ ] A pod without security context is rejected by Kyverno
- [ ] `docs/README.md` exists with correct links
- [ ] `docs/quickstart.md` exists and is followable end-to-end
- [ ] `docs/troubleshooting.md` exists with consolidated content
- [ ] `scripts/bootstrap.sh` exists and is executable
- [ ] Policy exception process is linked from `docs/developer-guide.md`, `docs/quickstart.md`, and `docs/troubleshooting.md`
- [ ] All 4 Helm chart NOTES.txt files include troubleshooting + exception process link
- [ ] `policies/custom/policy-exceptions/example-neuvector-privileged.yaml` exists and NeuVector pods are not blocked
- [ ] `policies/custom/policy-exceptions/example-team-alpha-legacy-migration.yaml.example` exists as a tenant reference
- [ ] DSOP wizard security exception UI generates a pre-filled PolicyException YAML
- [ ] Expired PolicyExceptions are detectable via `scripts/compliance-report.sh` or monitoring alert
- [ ] `helm template` with `database.enabled=true` renders valid CNPG Cluster + DATABASE_URL injection
- [ ] `helm template` with `redis.enabled=true` renders valid Redis Deployment + REDIS_URL injection
- [ ] `helm template` with `migrations.enabled=true` renders valid init container
- [ ] Cross-namespace communication is documented with both caller and callee configuration
- [ ] `helm template` with `externalServices` renders valid Istio ServiceEntry resources
- [ ] Deployment templates include configurable `terminationGracePeriodSeconds` and `preStop`
- [ ] Canary deployments and preview environments are documented in developer guide
- [ ] Per-app Grafana dashboard auto-created when ServiceMonitor is enabled
- [ ] Per-app PrometheusRule alerts render when `alerts.enabled=true`
- [ ] `docs/logging-guide.md` exists with code examples for Node, Python, Go, Java
- [ ] `docs/tracing-guide.md` exists with OTel instrumentation examples
- [ ] Environment promotion pattern documented with Flux valuesFrom approach
- [ ] WebSocket VirtualService route renders with `timeout: 0s` when enabled
- [ ] Resource right-sizing PromQL queries documented in developer guide
- [ ] Rollback procedures documented with 3 methods in developer guide
- [ ] Health check guidance covers HTTP, TCP, and exec probe types
- [ ] Secret rotation lifecycle documented with auto-restart options
- [ ] `docs/local-development.md` exists with pre-push testing steps
- [ ] `helm template` with `rateLimit.enabled=true` renders valid Istio EnvoyFilter
- [ ] Dashboard has a team/namespace selector that filters all views
- [ ] Rollback button works in the Applications tab
- [ ] Security tab shows real Kyverno PolicyReport violations (no "coming soon" placeholder)
- [ ] Resource quota usage is visible per namespace with progress bars
- [ ] DSOP wizard Step 7 shows live pod health status after deployment
- [ ] Deployment history is viewable per app with rollback option
- [ ] Embedded log viewer works in Applications tab with search and streaming
- [ ] Tenant onboarding form is accessible from the Deploy tab
- [ ] Service dependency graph renders from Istio traffic metrics
- [ ] Export YAML button works for any deployed app
- [ ] Failed DSOP pipeline gates have a retry button
- [ ] Notification center shows deployment events and policy violations
- [ ] Database management UI shows CNPG cluster health and connection info
- [ ] ExternalSecret sync status is visible per namespace
- [ ] Canary deployment progress is shown for Flagger-managed apps
- [ ] Harbor credentials are self-service for developers (per-team)
- [ ] Compliance tab has one-click ATO evidence export (ZIP)
- [ ] DSOP wizard theme syncs with dashboard dark/light mode
- [ ] Pipeline ETA is shown during DSOP wizard Step 4
- [ ] Pipeline run URLs are shareable and load in read-only mode
- [ ] `deepLink()` helper function exists and resolves all link targets to specific paths
- [ ] Compliance tab evidence links deep-link to specific Grafana dashboards / NeuVector pages / Harbor scans
- [ ] Pipeline gate evidence links deep-link to source tools (Harbor scan results, Grafana logs)
- [ ] Overview quick actions deep-link to cluster overview dashboard and alert page
- [ ] Operations service tiles deep-link to most useful view per service
- [ ] All 11 existing Grafana dashboards have deterministic UIDs (not `-- Grafana --`)
- [ ] 5 new Grafana dashboards created: istio-workload, audit-logs, application-logs, alerting-overview, node-overview
- [ ] All dashboards provisioned via ConfigMap with `grafana_dashboard: "1"` label
- [ ] Deep links with template variables (`$namespace`, `$app`) pre-fill correctly
