# Round 4 Platform Hardening — Make It Work For Humans

## Context

Round 4 E2E testing deployed 3 real apps (go-httpbin, Uptime Kuma, Gitea) to the
live cluster and tested them through Playwright. Found 5 critical bugs that were
invisible to template validation. Three were "fixed" during testing, but all fixes
were WORKAROUNDS — manual one-off patches, not automated platform features.

This prompt makes every fix PERMANENT so the next developer (or the DSOP wizard)
never hits these problems.

## The 5 Bugs and Their Permanent Fixes

| # | Bug | Workaround Applied | Permanent Fix Needed |
|---|-----|--------------------|---------------------|
| 1 | NetworkPolicy breaks Istio sidecar in tenant namespaces | Manually added allow-istio-control-plane to team-test | Add to tenant _base template |
| 2 | ext-authz 403 on tenant apps | Added notHosts for 3 specific test apps | Flip model: SSO-gate platform UIs only |
| 3 | Kyverno Enforce blocks root pods even with securityContext override | Created manual PolicyException for team-test | Auto-generate PolicyException from deploy script + wizard |
| 4 | Deploy script only supports one --persist flag | Used only one mount, lost Gitea config | Support multiple --persist flags |
| 5 | DSOP wizard doesn't generate PolicyExceptions or handle ext-authz | N/A — wizard wasn't tested | Wire wizard pipeline to generate all required resources |

---

## The Prompt

```
You are fixing the SRE platform to make tenant app deployment work for humans —
not just for engineers with kubectl. Round 4 E2E testing found 5 critical bugs.
All were "fixed" with workarounds. Your job is to make each fix PERMANENT and
AUTOMATED so the deploy script, DSOP wizard, and onboard-tenant script all
handle these correctly.

BRANCH: fix/round4-platform-hardening

## OPERATING RULES

1. NEVER stop to ask questions. Make the best decision and document why.
2. After EACH fix, validate: task lint, helm template on all charts, and verify
   existing tenant apps (team-alpha, etc.) still work.
3. Test each fix against the REAL CLUSTER — not just templates.
4. Keep changes minimal and backwards-compatible. Do NOT break existing deployments.

## FIX 1: Istio NetworkPolicy in Tenant Base Template

PROBLEM: Default-deny NetworkPolicy in tenant namespaces blocks Istio sidecar
communication to istiod (port 15012 for xDS, port 15017 for webhook). Every pod
in a new tenant namespace has Istio sidecar CrashLoopBackOff until someone manually
adds a NetworkPolicy.

### What to do:

1. Read apps/tenants/_base/ to understand the current tenant template structure.

2. Add a new file: apps/tenants/_base/network-policies/allow-istio-control-plane.yaml
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-istio-control-plane
     labels:
       app.kubernetes.io/part-of: sre-platform
   spec:
     podSelector: {}
     policyTypes:
       - Egress
     egress:
       # Allow sidecar to reach istiod for xDS config
       - to:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: istio-system
         ports:
           - protocol: TCP
             port: 15012
           - protocol: TCP
             port: 15017
           - protocol: TCP
             port: 443
   ```

3. Also add allow-istio-sidecar-inbound.yaml for inbound mesh traffic:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-istio-sidecar-inbound
     labels:
       app.kubernetes.io/part-of: sre-platform
   spec:
     podSelector: {}
     policyTypes:
       - Ingress
     ingress:
       # Allow inbound from Istio gateway (for ingress traffic)
       - from:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: istio-system
   ```

4. Update scripts/onboard-tenant.sh (if it exists) to include these NetworkPolicies
   when creating new tenant namespaces.

5. Apply to team-test namespace to verify:
   ```bash
   kubectl apply -f apps/tenants/_base/network-policies/allow-istio-control-plane.yaml -n team-test
   kubectl apply -f apps/tenants/_base/network-policies/allow-istio-sidecar-inbound.yaml -n team-test
   ```

6. Verify existing pods recover (sidecar should reconnect to istiod):
   ```bash
   kubectl get pods -n team-test
   ```

7. Check that ALL existing tenant namespaces have these policies:
   ```bash
   for ns in $(kubectl get ns -l sre.io/tenant=true -o name); do
     echo "=== $ns ==="
     kubectl get networkpolicy -n ${ns##*/} | grep istio
   done
   ```
   If any are missing, apply to them.

Commit: git commit -m "fix(tenants): add Istio control plane NetworkPolicy to tenant base template"

## FIX 2: ext-authz Scope — Exclude Tenant Apps by Default

PROBLEM: The Istio ext-authz (OAuth2 proxy) intercepts ALL ingress traffic,
including tenant apps. Tenant apps get 403 because they're not registered as
SSO clients. The workaround was adding specific hostnames to a notHosts list,
but that doesn't scale — every new app would need a manual config change.

### What to do:

1. Find the ext-authz / OAuth2 proxy configuration. It's likely in one of:
   - platform/core/istio-config/ (AuthorizationPolicy or EnvoyFilter)
   - platform/addons/keycloak/ (OAuth2 proxy config)
   - An EnvoyFilter that applies ext-authz to the gateway

2. Read the current config to understand how ext-authz is applied.

3. Change the ext-authz scope from "everything except these hosts" to
   "ONLY these specific platform hosts":

   OPTION A (preferred): Use an AuthorizationPolicy with specific hosts:
   ```yaml
   apiVersion: security.istio.io/v1
   kind: AuthorizationPolicy
   metadata:
     name: platform-sso-gate
     namespace: istio-system
   spec:
     selector:
       matchLabels:
         istio: gateway
     action: CUSTOM
     provider:
       name: oauth2-proxy
     rules:
       - to:
           - operation:
               hosts:
                 - "dashboard.apps.sre.example.com"
                 - "portal.apps.sre.example.com"
                 - "dsop.apps.sre.example.com"
                 - "grafana.apps.sre.example.com"
                 - "kiali.apps.sre.example.com"
                 - "harbor.apps.sre.example.com"
                 - "neuvector.apps.sre.example.com"
                 # Only platform UIs — NOT tenant apps
   ```

   OPTION B: If it's an EnvoyFilter, add a match condition that only applies
   to platform service hosts.

4. After changing, verify:
   ```bash
   # Tenant app should return 200 (not 403)
   curl -sk https://go-httpbin.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
   # Should be 200

   # Platform UI should still require SSO (302 to Keycloak)
   curl -sk https://dashboard.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
   # Should be 302
   ```

5. Document the auth model: create or update docs/developer-guides/app-authentication.md
   - Tenant apps are NOT behind platform SSO by default
   - Tenant apps can opt-in to Keycloak OIDC (document how)
   - Platform UIs (dashboard, portal, grafana, etc.) ARE behind SSO
   - How to add a new platform UI to the SSO gate

Commit: git commit -m "fix(istio): scope ext-authz to platform UIs only — tenant apps excluded by default"

## FIX 3: Auto-Generate PolicyException from Deploy Script + Wizard

PROBLEM: When a developer uses --run-as-root, the deploy script generates
a HelmRelease with the correct security context, but Kyverno's
require-security-context ClusterPolicy in Enforce mode rejects the pod at
admission. The developer sees "pod rejected" with no explanation of how to fix it.

### What to do:

1. Read the current Kyverno policies to find which ones block root pods:
   ```bash
   kubectl get clusterpolicy -o name | while read p; do
     echo "=== $p ==="
     kubectl get $p -o jsonpath='{.spec.validationFailureAction}'
     echo
   done
   ```

2. Read scripts/sre-deploy-app.sh to find where --run-as-root is handled.

3. When --run-as-root, --writable-root, or --add-capability is used, the deploy
   script should ALSO generate a Kyverno PolicyException alongside the HelmRelease:

   ```yaml
   apiVersion: kyverno.io/v2beta1
   kind: PolicyException
   metadata:
     name: ${APP_NAME}-security-exception
     namespace: ${TEAM_NAMESPACE}
     labels:
       app.kubernetes.io/name: ${APP_NAME}
       sre.io/team: ${TEAM}
       sre.io/exception-reason: "legacy-app"
   spec:
     exceptions:
       - policyName: require-run-as-nonroot
         ruleNames:
           - require-run-as-nonroot
       - policyName: require-security-context
         ruleNames:
           - require-non-root-user
           - require-drop-all-capabilities
     match:
       any:
         - resources:
             kinds:
               - Pod
             namespaces:
               - ${TEAM_NAMESPACE}
             names:
               - "${APP_NAME}-*"
   ```

4. The PolicyException should be written to the SAME tenant apps directory:
   apps/tenants/${TEAM}/apps/${APP_NAME}-policy-exception.yaml

5. Only generate the exception for the specific policies that the flags violate:
   - --run-as-root → exception for require-run-as-nonroot, require-non-root-user
   - --writable-root → exception for require-read-only-root-filesystem
   - --add-capability → exception for require-drop-all-capabilities

6. IMPORTANT: Read the actual Kyverno ClusterPolicy names and rule names from the
   cluster to generate correct exceptions:
   ```bash
   kubectl get clusterpolicy -o json | jq -r '.items[] | .metadata.name + ": " + (.spec.rules[].name)'
   ```
   Use THESE exact names in the PolicyException, not guesses.

7. Update the DSOP wizard pipeline code too. Read the pipeline's deploy step:
   - apps/dashboard/server/ (the Node.js backend that handles deployments)
   - Look for where HelmRelease YAML is generated
   - After generating the HelmRelease, if security exceptions were flagged during
     the RAISE analysis, also generate and apply the PolicyException

8. Verify on the real cluster:
   ```bash
   # Delete the old manual PolicyException for team-test (if any)
   kubectl delete policyexception -n team-test --all

   # Re-run the deploy for uptime-kuma (which needs root)
   ./scripts/sre-deploy-app.sh \
     --name uptime-kuma-test2 --team team-test \
     --image louislam/uptime-kuma --tag 1 --port 3001 \
     --run-as-root --writable-root --add-capability SETGID --add-capability SETUID \
     --persist /app/data:2Gi --no-commit

   # Check that PolicyException was generated
   cat apps/tenants/team-test/apps/uptime-kuma-test2-policy-exception.yaml

   # Apply and verify pod starts
   kubectl apply -f apps/tenants/team-test/apps/uptime-kuma-test2.yaml
   kubectl apply -f apps/tenants/team-test/apps/uptime-kuma-test2-policy-exception.yaml
   kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=uptime-kuma-test2 \
     -n team-test --timeout=180s
   ```

   Clean up after test:
   ```bash
   kubectl delete -f apps/tenants/team-test/apps/uptime-kuma-test2.yaml
   kubectl delete -f apps/tenants/team-test/apps/uptime-kuma-test2-policy-exception.yaml
   rm apps/tenants/team-test/apps/uptime-kuma-test2*.yaml
   ```

Commit: git commit -m "feat(deploy): auto-generate Kyverno PolicyException for security overrides"

## FIX 4: Multiple --persist Flags

PROBLEM: Gitea needs two PVC mounts (/var/lib/gitea + /etc/gitea). The deploy
script only supports one --persist flag. Config is lost on pod restart.

### What to do:

1. Read scripts/sre-deploy-app.sh to find how --persist is parsed.

2. Change it to accept multiple --persist flags. Each creates a separate PVC
   and volume mount. Naming: ${APP_NAME}-data-0, ${APP_NAME}-data-1, etc.

3. In the generated HelmRelease values, this means either:
   - Multiple entries in a persistence array
   - Or using extraVolumes + extraVolumeMounts for the additional mounts

4. Check the Helm chart templates (web-app, api-service, worker) to see what
   structure they expect. If the chart only supports one persistence block,
   use the FIRST --persist for the main persistence and additional ones via
   extraVolumes/extraVolumeMounts with PVC references.

5. Verify with Gitea pattern:
   ```bash
   ./scripts/sre-deploy-app.sh \
     --name gitea-test2 --team team-test \
     --image gitea/gitea --tag 1.22-rootless --port 3000 \
     --persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi \
     --startup-probe / --writable-root --no-commit

   # Check generated YAML has two PVCs
   cat apps/tenants/team-test/apps/gitea-test2.yaml | grep -A5 persist
   ```

   Clean up: rm apps/tenants/team-test/apps/gitea-test2*.yaml

Commit: git commit -m "feat(deploy): support multiple --persist flags for multi-mount apps"

## FIX 5: Wire DSOP Wizard to Handle All of the Above

PROBLEM: The DSOP wizard auto-detects app requirements (root user, capabilities,
writable paths) during the RAISE pipeline analysis. But it doesn't generate
PolicyExceptions, doesn't handle ext-authz exclusion, and doesn't create the
Istio NetworkPolicy. A developer using the wizard would hit the same 403/rejection
bugs that Round 4 found.

### What to do:

1. Read the DSOP wizard and pipeline code:
   - apps/dsop-wizard/src/ — the React frontend
   - apps/dashboard/server/ — the Node.js backend (Express)
   - Look for: deploy route, HelmRelease generation, security exception handling

2. Find where the pipeline generates the HelmRelease for deployment. This is the
   integration point.

3. After generating the HelmRelease, the pipeline should ALSO:

   a) **Generate PolicyException** if security exceptions were flagged:
      - Read the RAISE analysis results (which flags root user, capabilities, etc.)
      - Generate a PolicyException YAML matching the exact Kyverno policy names
      - Apply it to the cluster: kubectl apply -f
      - Store it alongside the HelmRelease in the tenant directory

   b) **Verify ext-authz won't block the app**:
      - The ext-authz fix (Fix 2) should have already scoped it to platform UIs only
      - But verify: if the wizard is creating VirtualServices for tenant apps,
        ensure they're not in the SSO host list
      - Add a note in the wizard UI: "Your app will be publicly accessible at
        <URL>. To add SSO, see docs/developer-guides/app-authentication.md"

   c) **Ensure Istio NetworkPolicy exists in the target namespace**:
      - Before deploying, check if allow-istio-control-plane NetworkPolicy exists
      - If not, create it (this should already be handled by Fix 1 at the tenant
        level, but the wizard should verify)

4. Test the full wizard flow:
   - Open the DSOP wizard in a browser
   - Submit a test app (or use the existing Wireshark/ws deployment if available)
   - Verify the pipeline generates both HelmRelease AND PolicyException
   - Verify the deployed app is accessible via ingress without 403

5. Update the wizard UI if needed:
   - The security exceptions step should show what PolicyExceptions will be created
   - The deploy step should show the generated resources (HelmRelease + PolicyException)
   - The final status should include the ingress URL with a "Open App" link

Commit: git commit -m "feat(pipeline): auto-generate PolicyException + verify networking in deploy step"

## FINAL VALIDATION

After all 5 fixes, do a FULL end-to-end test:

### Test A: New tenant namespace from scratch
```bash
# Create a brand new tenant
./scripts/onboard-tenant.sh team-round4-test

# Verify it has the Istio NetworkPolicies
kubectl get networkpolicy -n team-round4-test

# Deploy go-httpbin to it
./scripts/sre-deploy-app.sh \
  --name httpbin --team team-round4-test \
  --image mccutchen/go-httpbin --tag v2.14.0 --port 8080 \
  --run-as-root --ingress httpbin-r4.apps.sre.example.com \
  --no-commit

# Apply
kubectl apply -f apps/tenants/team-round4-test/apps/httpbin.yaml
kubectl apply -f apps/tenants/team-round4-test/apps/httpbin-policy-exception.yaml 2>/dev/null

# Wait and test
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=httpbin \
  -n team-round4-test --timeout=180s

curl -sk https://httpbin-r4.apps.sre.example.com/get -o /dev/null -w '%{http_code}'
# MUST be 200 — not 403, not 503
```

### Test B: Platform UI still behind SSO
```bash
curl -sk https://dashboard.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
# MUST be 302 (redirect to Keycloak) — SSO is still enforced for platform UIs
```

### Test C: Gitea with multiple PVCs
```bash
./scripts/sre-deploy-app.sh \
  --name gitea-final --team team-round4-test \
  --image gitea/gitea --tag 1.22-rootless --port 3000 \
  --persist /var/lib/gitea:10Gi --persist /etc/gitea:100Mi \
  --startup-probe / --writable-root \
  --ingress gitea-r4.apps.sre.example.com --no-commit

kubectl apply -f apps/tenants/team-round4-test/apps/gitea-final.yaml
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=gitea-final \
  -n team-round4-test --timeout=300s

# Verify both PVCs exist
kubectl get pvc -n team-round4-test | grep gitea

# Access through browser
curl -sk https://gitea-r4.apps.sre.example.com/ -o /dev/null -w '%{http_code}'
```

### Test D: Clean up
```bash
kubectl delete ns team-round4-test
```

### Report
Create tests/e2e/round4/HARDENING-REPORT.md:
- Which fixes were applied
- Test A/B/C results
- Any issues remaining
- Screenshots if applicable

Commit: git commit -m "test(e2e): round 4 hardening validation — all 5 fixes verified"

Then push and create PR:
```bash
git push -u origin fix/round4-platform-hardening
gh pr create --title "fix: Round 4 platform hardening — 5 critical deployment bugs" \
  --body "$(cat <<'EOF'
## Summary
Fixes 5 critical bugs found during Round 4 E2E testing that were invisible
to template validation (Rounds 1-3):

1. **Istio NetworkPolicy in tenant base** — sidecars no longer CrashLoop in new namespaces
2. **ext-authz scoped to platform UIs** — tenant apps no longer get 403
3. **Auto-generate PolicyException** — --run-as-root creates the Kyverno exception automatically
4. **Multiple --persist flags** — apps like Gitea can mount 2+ PVCs
5. **DSOP wizard integration** — pipeline generates PolicyExceptions and verifies networking

## Test Plan
- [ ] New tenant namespace deploys app without manual fixes
- [ ] Tenant app returns 200 (not 403)
- [ ] Platform UIs still require SSO (302 to Keycloak)
- [ ] Root app deploys without manual PolicyException
- [ ] Multi-PVC app (Gitea) persists data after pod restart
- [ ] DSOP wizard deploy step generates all required resources

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
```

---

## Kick-Off Prompt

```
Read docs/round4-platform-hardening.md and execute the prompt in "The Prompt" section.
This fixes 5 critical bugs from Round 4 E2E testing — make each fix PERMANENT and
AUTOMATED. Test against the real cluster after each fix. Do not stop or ask questions.
Start with Fix 1 (Istio NetworkPolicy in tenant base).
```
