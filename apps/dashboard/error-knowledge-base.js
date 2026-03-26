'use strict';

/**
 * SRE Platform Error-to-Fix Knowledge Base
 *
 * Covers every enforcement layer a developer can be blocked by:
 *   - Kyverno admission policies (all 17 active policies)
 *   - Istio service-mesh errors
 *   - Kubernetes RBAC / forbidden errors
 *   - ResourceQuota / LimitRange violations
 *   - NetworkPolicy blocks
 *   - Image / registry errors
 *
 * Each entry shape:
 *   what        {string}        Plain-English explanation of why the deployment was blocked.
 *   fix         {string}        Step-by-step remediation for the developer.
 *   dockerfile  {string|null}   Dockerfile snippet to add/change (null if not applicable).
 *   helmValues  {string|null}   Helm values.yaml snippet to set (null if not applicable).
 *   docs        {string|null}   Path to further documentation (relative to repo root).
 *
 * Usage:
 *   const { ERROR_KNOWLEDGE_BASE, matchError, POLICY_FIXES } = require('./error-knowledge-base');
 */

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_KNOWLEDGE_BASE = {

  // ═══════════════════════════════════════════════════════════════════════════
  // KYVERNO — BASELINE POLICIES  (cluster-wide, Enforce)
  // Policy names match the ClusterPolicy metadata.name exactly so that
  // matchError() can look them up directly from Kyverno denial messages.
  // ═══════════════════════════════════════════════════════════════════════════

  'disallow-privileged-containers': {
    what: 'Your container requests privileged mode, which gives it full host access. This violates the platform security baseline and NIST CM-7.',
    fix: 'Remove `privileged: true` from your container securityContext.\n\n'
      + 'If your app genuinely needs privileged access (very rare), request a PolicyException:\n'
      + '  1. Open a ticket with the platform team.\n'
      + '  2. Document the business justification.\n'
      + '  3. Use the template: policies/custom/policy-exceptions/ for approval.',
    dockerfile: null,
    helmValues: 'Ensure you are NOT setting:\n'
      + '  securityContext:\n'
      + '    privileged: true\n\n'
      + 'The SRE Helm charts never set this — check your custom overrides.',
    docs: 'policies/baseline/disallow-privileged.yaml',
  },

  'disallow-host-namespaces': {
    what: 'Your pod requests access to the host PID, IPC, or network namespace. This breaks container isolation and is blocked cluster-wide.',
    fix: 'Remove hostPID, hostIPC, and hostNetwork from your pod spec.\n'
      + 'Use Kubernetes Services for inter-pod networking instead of host networking.\n\n'
      + 'Example of what NOT to set:\n'
      + '  spec:\n'
      + '    hostNetwork: true   # ← remove this\n'
      + '    hostPID: true       # ← remove this\n'
      + '    hostIPC: true       # ← remove this',
    dockerfile: null,
    helmValues: 'Do not set hostNetwork, hostPID, or hostIPC in your deployment values.',
    docs: 'policies/baseline/disallow-host-namespaces.yaml',
  },

  'disallow-host-ports': {
    what: 'Your container binds directly to a host port. Host ports bypass Kubernetes networking and break the service mesh.',
    fix: 'Remove hostPort from your container ports.\n\n'
      + 'Use a Service (ClusterIP) and Istio VirtualService for external access:\n'
      + '  ingress:\n'
      + '    enabled: true\n'
      + '    host: my-app.apps.sre.example.com',
    dockerfile: null,
    helmValues: 'Remove any hostPort entries from your container port definitions.',
    docs: 'policies/baseline/disallow-host-ports.yaml',
  },

  'restrict-unsafe-sysctls': {
    what: 'Your pod sets kernel parameters (sysctls) that are not on the safe-list. Unsafe sysctls can destabilise the host kernel.',
    fix: 'Remove unsafe sysctls from your pod spec.\n\n'
      + 'Safe sysctls (namespaced, allowed without exception):\n'
      + '  - kernel.shm_rmid_forced\n'
      + '  - net.ipv4.ip_local_port_range\n'
      + '  - net.ipv4.tcp_syncookies\n'
      + '  - net.ipv4.ping_group_range\n'
      + '  - net.ipv4.ip_unprivileged_port_start\n\n'
      + 'If you need a different sysctl, file a PolicyException request with a justification.',
    dockerfile: null,
    helmValues: null,
    docs: 'policies/baseline/restrict-sysctls.yaml',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KYVERNO — RESTRICTED POLICIES  (tenant namespaces, moving to Enforce)
  // ═══════════════════════════════════════════════════════════════════════════

  'require-run-as-nonroot': {
    what: 'Your container runs as root (UID 0). Running as root inside a container is a serious security risk — a container escape would give an attacker full node access.',
    fix: 'Add a non-root user to your Dockerfile and switch to it before the entrypoint.\n\n'
      + 'Also set the security context in your pod spec so Kubernetes enforces it even if the image forgets.',
    dockerfile: '# Add near the end of your Dockerfile, before CMD/ENTRYPOINT:\n'
      + 'RUN addgroup -S appgroup && adduser -S appuser -G appgroup\n'
      + 'USER appuser\n\n'
      + '# For Debian/Ubuntu base images:\n'
      + 'RUN groupadd -r appgroup && useradd -r -g appgroup appuser\n'
      + 'USER appuser',
    helmValues: 'The SRE Helm charts set this automatically. If using custom manifests:\n'
      + '  securityContext:\n'
      + '    runAsNonRoot: true\n'
      + '    runAsUser: 1000\n'
      + '    runAsGroup: 1000',
    docs: 'policies/restricted/require-run-as-nonroot.yaml',
  },

  'require-drop-all-capabilities': {
    what: "Your container retains Linux capabilities it doesn't need. The platform requires all capabilities to be dropped (principle of least privilege).",
    fix: 'Drop all capabilities in your container security context. If your app needs a specific capability (e.g., NET_BIND_SERVICE), add only that one back.',
    dockerfile: null,
    helmValues: 'The SRE Helm charts handle this automatically. If using custom manifests:\n'
      + '  securityContext:\n'
      + '    capabilities:\n'
      + '      drop:\n'
      + '        - ALL\n'
      + '      add:    # Only if genuinely needed:\n'
      + '        - NET_BIND_SERVICE',
    docs: 'policies/restricted/require-drop-all-capabilities.yaml',
  },

  'disallow-privilege-escalation': {
    what: 'Your container allows privilege escalation — a child process could gain more privileges than its parent. This is a common container-escape vector.',
    fix: 'Set allowPrivilegeEscalation: false in your container security context. This is safe for almost all applications.',
    dockerfile: null,
    helmValues: 'The SRE Helm charts set this automatically. If using custom manifests:\n'
      + '  securityContext:\n'
      + '    allowPrivilegeEscalation: false',
    docs: 'policies/restricted/disallow-privilege-escalation.yaml',
  },

  'restrict-volume-types': {
    what: 'Your pod uses a volume type that is not allowed (e.g., hostPath, nfs, glusterfs). These can bypass namespace isolation.',
    fix: 'Use only approved volume types:\n'
      + '  - configMap\n'
      + '  - secret\n'
      + '  - emptyDir\n'
      + '  - persistentVolumeClaim\n'
      + '  - projected\n'
      + '  - downwardAPI\n\n'
      + 'Do not mount host filesystem paths. Use a PVC backed by the platform storage class for persistent data.',
    dockerfile: null,
    helmValues: 'Replace hostPath volumes with emptyDir or a PVC:\n'
      + '  persistence:\n'
      + '    enabled: true\n'
      + '    size: 1Gi\n'
      + '    storageClass: local-path',
    docs: 'policies/restricted/restrict-volume-types.yaml',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KYVERNO — CUSTOM POLICIES
  // ═══════════════════════════════════════════════════════════════════════════

  'require-labels': {
    what: "Your resources are missing required labels. The platform uses these for tracking ownership, RBAC, and compliance reporting.",
    fix: 'Add the required labels to your pod template and other resources.',
    dockerfile: null,
    helmValues: 'The SRE Helm charts add these automatically from your values.yaml.\n'
      + 'Required labels in custom manifests:\n'
      + '  metadata:\n'
      + '    labels:\n'
      + '      app.kubernetes.io/name: <your-app-name>\n'
      + '      app.kubernetes.io/part-of: sre-platform\n'
      + '      sre.io/team: <your-team-name>',
    docs: 'policies/custom/require-labels.yaml',
  },

  'disallow-latest-tag': {
    what: 'Your container image uses the :latest tag or has no tag at all. This makes deployments unpredictable — a push to Harbor could silently change what code is running.',
    fix: 'Pin your image to a specific, immutable version tag (e.g., v1.2.3 or a git commit SHA).',
    dockerfile: '# Change FROM base images to pinned versions:\n'
      + '# WRONG:\n'
      + 'FROM node:latest\n\n'
      + '# CORRECT:\n'
      + 'FROM node:20-alpine3.19',
    helmValues: 'Set a specific tag in your HelmRelease values:\n'
      + '  app:\n'
      + '    image:\n'
      + '      repository: harbor.apps.sre.example.com/<team>/my-app\n'
      + '      tag: "v1.2.3"    # ← never use "latest"',
    docs: 'policies/custom/disallow-latest-tag.yaml',
  },

  'restrict-image-registries': {
    what: "Your image is from a registry that is not approved. All images must come from the platform's Harbor registry to ensure they've passed vulnerability scanning and are signed.",
    fix: 'Push your image to the platform Harbor registry before deploying.\n\n'
      + 'Steps:\n'
      + '  1. Log in to Harbor:\n'
      + '       docker login harbor.apps.sre.example.com\n'
      + '  2. Tag your image:\n'
      + '       docker tag my-app:v1.0 harbor.apps.sre.example.com/<team>/my-app:v1.0\n'
      + '  3. Push it:\n'
      + '       docker push harbor.apps.sre.example.com/<team>/my-app:v1.0\n'
      + '  4. Wait for the Trivy scan to complete (2-3 minutes).\n'
      + '  5. Update your image reference in values.yaml.',
    dockerfile: null,
    helmValues: 'Image repository MUST start with harbor.apps.sre.example.com/:\n'
      + '  app:\n'
      + '    image:\n'
      + '      repository: harbor.apps.sre.example.com/<team>/my-app',
    docs: 'policies/custom/restrict-image-registries.yaml',
  },

  'require-resource-limits': {
    what: 'Your containers must declare CPU and memory requests and limits. Without limits, one misbehaving app can starve all others in the cluster.',
    fix: 'Set resources.requests and resources.limits for every container.',
    dockerfile: null,
    helmValues: 'The SRE Helm charts set safe defaults. To customise:\n'
      + '  app:\n'
      + '    resources:\n'
      + '      requests:\n'
      + '        cpu: 100m\n'
      + '        memory: 128Mi\n'
      + '      limits:\n'
      + '        cpu: 500m\n'
      + '        memory: 512Mi',
    docs: 'policies/custom/require-resource-limits.yaml',
  },

  'require-probes': {
    what: 'Your containers must have liveness and readiness probes. Without them, Kubernetes cannot determine if your app is healthy and may route traffic to dead pods.',
    fix: 'Add /healthz and /readyz endpoints to your application, then configure probes.\n\n'
      + 'Minimum implementation (any HTTP framework):\n'
      + '  GET /healthz  → return 200 OK  (am I alive?)\n'
      + '  GET /readyz   → return 200 OK  (am I ready to serve traffic?)',
    dockerfile: null,
    helmValues: 'Configure in your Helm values:\n'
      + '  app:\n'
      + '    probes:\n'
      + '      liveness:\n'
      + '        path: /healthz\n'
      + '        initialDelaySeconds: 10\n'
      + '        periodSeconds: 15\n'
      + '      readiness:\n'
      + '        path: /readyz\n'
      + '        initialDelaySeconds: 5\n'
      + '        periodSeconds: 10\n\n'
      + '# For non-HTTP apps, use TCP probes:\n'
      + '  app:\n'
      + '    probes:\n'
      + '      liveness: { type: tcp }\n'
      + '      readiness: { type: tcp }',
    docs: 'policies/custom/require-probes.yaml',
  },

  'require-security-context': {
    what: 'Your pod is missing a security context. The platform requires non-root execution, a read-only root filesystem, and no privilege escalation on every container.',
    fix: 'Add a securityContext to both the pod spec and each container spec.',
    dockerfile: '# Ensure your app writes to /tmp or a mounted volume, not the root filesystem:\n'
      + 'RUN mkdir -p /app/tmp && chmod 1777 /app/tmp\n'
      + 'ENV TMPDIR=/app/tmp',
    helmValues: 'The SRE Helm charts set this automatically. If using custom manifests:\n'
      + '  spec:\n'
      + '    securityContext:          # Pod-level\n'
      + '      runAsNonRoot: true\n'
      + '      seccompProfile:\n'
      + '        type: RuntimeDefault\n'
      + '    containers:\n'
      + '      - securityContext:      # Container-level\n'
      + '          allowPrivilegeEscalation: false\n'
      + '          readOnlyRootFilesystem: true\n'
      + '          runAsNonRoot: true\n'
      + '          capabilities:\n'
      + '            drop:\n'
      + '              - ALL',
    docs: 'policies/custom/require-security-context.yaml',
  },

  'verify-image-signatures': {
    what: 'Your image is not signed with Cosign. The platform verifies image signatures to ensure supply chain integrity — unsigned images cannot be deployed.',
    fix: 'Sign your image after pushing it to Harbor.\n\n'
      + 'Manual signing:\n'
      + '  cosign sign --key cosign.key harbor.apps.sre.example.com/<team>/<app>:v1.0\n\n'
      + 'Recommended: use the DSOP pipeline (Deploy tab → Pipeline wizard). It runs Trivy, '
      + 'generates an SBOM, and signs with Cosign automatically. Images built through the '
      + 'pipeline are always signed.',
    dockerfile: null,
    helmValues: null,
    docs: 'policies/custom/verify-image-signatures.yaml',
  },

  'require-network-policies': {
    what: 'The namespace is missing required NetworkPolicies. This is a platform administration issue — the namespace was not onboarded correctly.',
    fix: 'Contact your platform admin. The namespace needs to be re-onboarded.\n\n'
      + 'Platform admin command:\n'
      + '  ./scripts/onboard-tenant.sh <team-name>\n\n'
      + 'This creates the default-deny NetworkPolicy plus allow rules for Istio, monitoring, '
      + 'and kube-dns.',
    dockerfile: null,
    helmValues: null,
    docs: 'policies/custom/require-network-policies.yaml',
  },

  'require-istio-sidecar': {
    what: 'The namespace does not have Istio sidecar injection enabled. Without the sidecar, your app has no mTLS, no telemetry, and no AuthorizationPolicy enforcement.',
    fix: 'Contact your platform admin — the namespace needs the Istio injection label.\n\n'
      + 'Platform admin command:\n'
      + '  kubectl label namespace <team-name> istio-injection=enabled\n\n'
      + 'This is set automatically by ./scripts/onboard-tenant.sh.',
    dockerfile: null,
    helmValues: null,
    docs: 'policies/custom/require-istio-sidecar.yaml',
  },

  'require-security-categorization': {
    what: 'The namespace is missing the required FIPS 199 security categorization label (sre.io/security-categorization). The RPOC is categorized at Moderate — all hosted applications must be Moderate or below.',
    fix: 'Add the security categorization label to the namespace.\n\n'
      + 'Platform admin command:\n'
      + '  kubectl label namespace <team-name> sre.io/security-categorization=moderate\n\n'
      + 'Valid values: "low" or "moderate".\n'
      + 'Applications cannot exceed the Moderate categorization level on this platform.',
    dockerfile: null,
    helmValues: null,
    docs: 'policies/custom/require-security-categorization.yaml',
  },

  'disallow-default-namespace': {
    what: 'You tried to deploy resources into the "default" namespace. All workloads must live in a dedicated team namespace for isolation and RBAC.',
    fix: 'Deploy to your team namespace instead of "default".\n\n'
      + 'If you do not have a namespace yet, request one:\n'
      + '  ./scripts/onboard-tenant.sh <team-name>\n\n'
      + 'Then update your HelmRelease or kubectl command to target that namespace:\n'
      + '  kubectl apply -n <team-name> -f ...\n'
      + '  # or in Flux HelmRelease: metadata.namespace: <team-name>',
    dockerfile: null,
    helmValues: 'Ensure your Flux HelmRelease targets your team namespace:\n'
      + '  metadata:\n'
      + '    namespace: team-alpha   # ← your team namespace',
    docs: 'policies/custom/disallow-default-namespace.yaml',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ISTIO SERVICE MESH ERRORS
  // ═══════════════════════════════════════════════════════════════════════════

  'istio-sidecar-injection-failed': {
    what: 'The Istio sidecar proxy failed to inject into your pod. Without the sidecar your app is outside the service mesh — it will not have mTLS, telemetry, or access-control enforcement.',
    fix: 'Check the namespace label:\n'
      + '  kubectl get namespace <team> --show-labels\n'
      + '  # Should include: istio-injection=enabled\n\n'
      + 'If the label is missing, contact your platform admin.\n\n'
      + 'Other causes:\n'
      + '  - Pod annotation sidecar.istio.io/inject: "false" — remove it.\n'
      + '  - Init containers that conflict with istio-init — check pod events for details.\n'
      + '  - Istiod is down — check: kubectl get pods -n istio-system',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  'istio-upstream-connect-error': {
    what: "Istio cannot connect to your application. Your app may not be listening on the expected port, or it crashed before Istio could route traffic.",
    fix: '1. Confirm your app listens on the port in your Helm values (app.port).\n'
      + '2. Check application logs:\n'
      + '     kubectl logs <pod> -c <app-container> -n <team>\n'
      + '3. Check Istio sidecar logs:\n'
      + '     kubectl logs <pod> -c istio-proxy -n <team>\n'
      + '4. Common cause: app crashes on startup and Istio routes traffic to a dead container.\n'
      + '5. Verify the Service port matches app.port:\n'
      + '     kubectl get svc -n <team>',
    dockerfile: null,
    helmValues: 'Ensure the port matches your app listen port:\n'
      + '  app:\n'
      + '    port: 8080   # ← must match what your app binds to',
    docs: null,
  },

  'istio-503-no-healthy-upstream': {
    what: 'Istio returned 503 because no healthy pods were available for your service. All pods may be crash-looping, not yet ready, or the deployment may have zero replicas.',
    fix: '1. Check pod status:\n'
      + '     kubectl get pods -n <team> -l app.kubernetes.io/name=<app>\n\n'
      + '2. If pods are in CrashLoopBackOff:\n'
      + '     kubectl logs <pod> -n <team>  # look for startup errors\n\n'
      + '3. If pods are Pending:\n'
      + '     kubectl describe pod <pod> -n <team>  # check for quota or scheduling issues\n'
      + '     kubectl describe quota -n <team>\n\n'
      + '4. If deployment has 0 replicas:\n'
      + '     kubectl scale deployment <app> --replicas=1 -n <team>',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  'istio-authorization-denied': {
    what: "An Istio AuthorizationPolicy is blocking traffic to your service. This is the service mesh's zero-trust access control — traffic is denied unless explicitly allowed.",
    fix: 'If you are calling from another namespace, the target service must allow your namespace.\n\n'
      + 'Add an AuthorizationPolicy to the target service\'s Helm values:\n'
      + '  authorizationPolicy:\n'
      + '    allowedCallers:\n'
      + '      - namespace: <your-namespace>\n'
      + '        serviceAccounts:\n'
      + '          - <your-app-service-account>\n\n'
      + 'If calling from the same namespace, check that the allow-same-namespace policy exists:\n'
      + '  kubectl get authorizationpolicy -n <team>',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  'istio-mtls-error': {
    what: 'mTLS handshake failed between services. One side may not have an Istio sidecar, certificates may be expired, or a DestinationRule is misconfigured.',
    fix: 'Verify both pods have the Istio sidecar:\n'
      + "  kubectl get pod -n <ns> <pod> -o jsonpath='{.spec.containers[*].name}'\n"
      + '  # Should include "istio-proxy"\n\n'
      + 'Check certificate expiry:\n'
      + '  istioctl proxy-config secret <pod> -n <ns>\n\n'
      + 'If calling an external service (outside the mesh), use a ServiceEntry and DestinationRule:\n'
      + '  spec:\n'
      + '    trafficPolicy:\n'
      + '      tls:\n'
      + '        mode: DISABLE   # for plain-HTTP external services\n'
      + '  # or mode: SIMPLE for TLS-only external services',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KUBERNETES RBAC / PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════════════

  'forbidden-rbac': {
    what: "You don't have permission to perform this action in this namespace. Your Keycloak group membership determines your Kubernetes RBAC role.",
    fix: 'Your access is controlled by Keycloak groups:\n'
      + '  • <team>-developers  → create, update, delete workloads in your namespace\n'
      + '  • <team>-viewers     → read-only access\n'
      + '  • platform-admins    → cluster-wide admin\n\n'
      + 'If you need more access, ask your team lead to add you to the correct Keycloak group.\n\n'
      + 'Platform-managed resources you cannot modify (by design):\n'
      + '  - RBAC (ClusterRole, RoleBinding)\n'
      + '  - ResourceQuotas and LimitRanges\n'
      + '  - NetworkPolicies\n'
      + '  - Kyverno policies',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  'forbidden-namespace': {
    what: "You tried to access a namespace that your team doesn't own. Cross-namespace access is not permitted by default.",
    fix: 'You can only deploy to your own team namespace.\n\n'
      + 'Check your namespace access:\n'
      + '  kubectl auth can-i list pods --all-namespaces\n\n'
      + 'If you need cross-namespace access, submit a request to the platform admin with a justification. '
      + 'Access is granted via an Istio AuthorizationPolicy, not by granting Kubernetes RBAC to foreign namespaces.',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOURCE QUOTA / LIMIT RANGE
  // ═══════════════════════════════════════════════════════════════════════════

  'quota-exceeded-cpu': {
    what: 'Your namespace has used all of its CPU allocation. No new pods can be scheduled until existing ones release CPU.',
    fix: 'Check current quota usage:\n'
      + '  kubectl describe quota -n <team>\n\n'
      + 'Options:\n'
      + '  1. Reduce CPU requests on existing deployments (app.resources.requests.cpu).\n'
      + '  2. Scale down or delete unused deployments.\n'
      + '  3. Ask the platform admin to increase your namespace CPU quota.',
    dockerfile: null,
    helmValues: 'Lower your CPU request if you requested more than needed:\n'
      + '  app:\n'
      + '    resources:\n'
      + '      requests:\n'
      + '        cpu: 100m    # ← try a smaller value',
    docs: null,
  },

  'quota-exceeded-memory': {
    what: 'Your namespace has used all of its memory allocation. No new pods can be scheduled until existing ones release memory.',
    fix: 'Check current quota usage:\n'
      + '  kubectl describe quota -n <team>\n\n'
      + 'Options:\n'
      + '  1. Reduce memory requests on existing deployments (app.resources.requests.memory).\n'
      + '  2. Scale down or delete unused deployments.\n'
      + '  3. Ask the platform admin to increase your namespace memory quota.',
    dockerfile: null,
    helmValues: 'Lower your memory request if you requested more than needed:\n'
      + '  app:\n'
      + '    resources:\n'
      + '      requests:\n'
      + '        memory: 128Mi   # ← try a smaller value',
    docs: null,
  },

  'quota-exceeded-pods': {
    what: 'Your namespace has reached the maximum number of pods allowed (default: 20). No new pods can be created.',
    fix: 'Check current pod count:\n'
      + '  kubectl get pods -n <team> --no-headers | wc -l\n\n'
      + 'Options:\n'
      + '  1. Delete unused or failed deployments.\n'
      + '  2. Reduce replica counts on existing deployments.\n'
      + '  3. Ask the platform admin to increase your namespace pod quota.',
    dockerfile: null,
    helmValues: null,
    docs: null,
  },

  'limitrange-violation': {
    what: 'Your container resource requests or limits are outside the bounds set by the namespace LimitRange — either too high (over the max) or too low (under the min).',
    fix: 'Check the namespace LimitRange:\n'
      + '  kubectl describe limitrange -n <team>\n\n'
      + 'Default bounds per container:\n'
      + '  Min CPU:    50m\n'
      + '  Max CPU:    2000m (2 cores)\n'
      + '  Min Memory: 64Mi\n'
      + '  Max Memory: 4096Mi (4 GiB)\n\n'
      + 'Adjust your values to fall within these bounds.\n'
      + 'If you need larger limits, ask the platform admin.',
    dockerfile: null,
    helmValues: 'Keep resources within the namespace LimitRange bounds:\n'
      + '  app:\n'
      + '    resources:\n'
      + '      requests:\n'
      + '        cpu: 100m       # min 50m, max 2000m\n'
      + '        memory: 128Mi   # min 64Mi, max 4096Mi\n'
      + '      limits:\n'
      + '        cpu: 500m\n'
      + '        memory: 512Mi',
    docs: null,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NETWORK POLICY
  // ═══════════════════════════════════════════════════════════════════════════

  'networkpolicy-egress-blocked': {
    what: "Your app's outbound traffic is being blocked by a NetworkPolicy. The platform default allows only: HTTPS (443), DNS (53 UDP/TCP), and same-namespace traffic.",
    fix: 'To call an external API on a non-standard port, add egress rules in your Helm values.\n\n'
      + 'Also add an Istio ServiceEntry for the external hostname (required for DNS resolution through the mesh).',
    dockerfile: null,
    helmValues: 'Add extra egress rules:\n'
      + '  networkPolicy:\n'
      + '    additionalEgress:\n'
      + '      - to:\n'
      + '          - ipBlock:\n'
      + '              cidr: 0.0.0.0/0\n'
      + '        ports:\n'
      + '          - port: 8080\n'
      + '            protocol: TCP\n\n'
      + '# Also add a ServiceEntry for the external hostname:\n'
      + '  externalServices:\n'
      + '    - name: my-external-api\n'
      + '      host: api.example.com\n'
      + '      port: 8080',
    docs: 'apps/templates/web-app/',
  },

  'networkpolicy-ingress-blocked': {
    what: 'Traffic to your app is being blocked by a NetworkPolicy. By default only the Istio gateway, monitoring (Prometheus), and same-namespace traffic can reach your pods.',
    fix: 'If another namespace needs to call your service directly, add ingress rules.',
    dockerfile: null,
    helmValues: 'Add extra ingress rules:\n'
      + '  networkPolicy:\n'
      + '    additionalIngress:\n'
      + '      - from:\n'
      + '          - namespaceSelector:\n'
      + '              matchLabels:\n'
      + '                kubernetes.io/metadata.name: <calling-namespace>\n'
      + '        ports:\n'
      + '          - port: 8080\n'
      + '            protocol: TCP',
    docs: 'apps/templates/web-app/',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IMAGE / REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  'image-pull-backoff': {
    what: 'Kubernetes cannot pull your container image. The image may not exist in Harbor, the tag may be wrong, or Harbor credentials may be missing from the namespace.',
    fix: 'Troubleshooting steps:\n'
      + '  1. Verify the image exists in Harbor:\n'
      + '       https://harbor.apps.sre.example.com (Projects > <team> > Repositories)\n'
      + '  2. Check for tag typos:\n'
      + '       docker pull harbor.apps.sre.example.com/<team>/<app>:<tag>\n'
      + '  3. Verify the Harbor image pull secret exists in your namespace:\n'
      + '       kubectl get secret -n <team> | grep harbor\n\n'
      + 'Push the image if it is missing:\n'
      + '  docker tag my-app:v1 harbor.apps.sre.example.com/<team>/my-app:v1\n'
      + '  docker push harbor.apps.sre.example.com/<team>/my-app:v1',
    dockerfile: null,
    helmValues: 'Double-check the repository and tag:\n'
      + '  app:\n'
      + '    image:\n'
      + '      repository: harbor.apps.sre.example.com/<team>/my-app\n'
      + '      tag: "v1.2.3"   # ← must exactly match the tag in Harbor',
    docs: null,
  },

  'image-not-scanned': {
    what: 'Your image has not been scanned for vulnerabilities by Trivy in Harbor, or the scan found critical/high CVEs that block deployment.',
    fix: 'Harbor scans images automatically on push.\n\n'
      + 'If the scan has not completed yet:\n'
      + '  1. Wait 2-3 minutes after pushing.\n'
      + '  2. Check scan status in Harbor:\n'
      + '       https://harbor.apps.sre.example.com → Projects > <team> > <image> > Vulnerabilities\n'
      + '  3. Trigger a manual scan in Harbor UI if the automated scan did not start.\n\n'
      + 'If the scan found CRITICAL or HIGH CVEs:\n'
      + '  - Rebuild your image with a newer, patched base image.\n'
      + '  - Or update the vulnerable dependency in your application.',
    dockerfile: '# Use a minimal, regularly updated base image to reduce CVE surface:\n'
      + '# Preferred (Chainguard — low CVE count, free tier):\n'
      + 'FROM cgr.dev/chainguard/node:latest-dev AS builder\n'
      + 'FROM cgr.dev/chainguard/node:latest AS runtime\n\n'
      + '# Alternative (Alpine — smaller than Debian/Ubuntu):\n'
      + 'FROM node:20-alpine3.19',
    helmValues: null,
    docs: null,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCHER FUNCTION
// Parses real Kubernetes / Kyverno / Istio error strings and returns the
// matching knowledge base entries.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match an error message (and optional pod events array) against the knowledge
 * base and return an array of matching entries.
 *
 * @param {string}   errorMessage  Raw error string from Kubernetes / Kyverno.
 * @param {Array}    events        Optional array of pod/deployment event objects
 *                                 with a `message` string field.
 * @returns {Array}  Array of { key, ...entry } objects from ERROR_KNOWLEDGE_BASE.
 *                   May be empty if no match is found.
 */
function matchError(errorMessage = '', events = []) {
  const matches = [];
  const seen = new Set();

  function addMatch(key) {
    if (key && ERROR_KNOWLEDGE_BASE[key] && !seen.has(key)) {
      seen.add(key);
      matches.push({ key, ...ERROR_KNOWLEDGE_BASE[key] });
    }
  }

  const msg = String(errorMessage);
  const msgLower = msg.toLowerCase();

  // ── Kyverno admission webhook denials ───────────────────────────────────
  // Kyverno embeds the policy name in several forms:
  //   "admission webhook ... denied the request: ... policy <name> ..."
  //   "resource violated policy <name>/<rule>"
  //   "Policy <name> ... validation error"
  //   "[<policy-name>]"
  const kyvernoPatterns = [
    /admission webhook[^:]*denied[^:]*:\s*(?:[^;]*;\s*)?(?:policy\s+)?([a-z][a-z0-9-]+)/i,
    /resource violated policy ([a-z][a-z0-9-]+)/i,
    /policy\s+([a-z][a-z0-9-]+)\s+(?:validation error|denied|violated)/i,
    /\[([a-z][a-z0-9-]+)\]\s+(?:validation error|fail|deny)/i,
    // Kyverno 1.10+ format: "...violates ClusterPolicy disallow-latest-tag..."
    /violates\s+(?:Cluster)?[Pp]olicy\s+([a-z][a-z0-9-]+)/i,
  ];

  for (const pattern of kyvernoPatterns) {
    const m = msg.match(pattern);
    if (m) {
      addMatch(m[1]);
      // Also try stripping a trailing rule suffix (policy/rule → policy)
      const policyOnly = m[1].split('/')[0];
      if (policyOnly !== m[1]) addMatch(policyOnly);
    }
  }

  // Fallback: direct substring match against every known policy name.
  // Kyverno always includes the policy name verbatim in its denial message.
  for (const key of Object.keys(ERROR_KNOWLEDGE_BASE)) {
    if (!seen.has(key) && msg.includes(key)) {
      addMatch(key);
    }
  }

  // ── Istio errors ────────────────────────────────────────────────────────
  if (
    (msgLower.includes('503') || msgLower.includes('upstream connect error')) &&
    (msgLower.includes('upstream') || msgLower.includes('no healthy'))
  ) {
    addMatch('istio-503-no-healthy-upstream');
  }

  if (msgLower.includes('upstream connect error') && !msgLower.includes('503')) {
    addMatch('istio-upstream-connect-error');
  }

  if (
    msgLower.includes('rbac: access denied') ||
    msgLower.includes('authorizationpolicy') ||
    (msgLower.includes('access denied') && msgLower.includes('istio'))
  ) {
    addMatch('istio-authorization-denied');
  }

  if (
    msgLower.includes('transport failure reason: tls') ||
    msgLower.includes('tls_error') ||
    (msgLower.includes('ssl') && msgLower.includes('handshake')) ||
    msgLower.includes('mtls') ||
    msgLower.includes('peer authentication')
  ) {
    addMatch('istio-mtls-error');
  }

  if (
    msgLower.includes('sidecar injection') ||
    msgLower.includes('istio-init') ||
    (msgLower.includes('sidecar') && msgLower.includes('failed'))
  ) {
    addMatch('istio-sidecar-injection-failed');
  }

  // ── Kubernetes RBAC ─────────────────────────────────────────────────────
  if (msgLower.includes('forbidden') || msgLower.includes(' is forbidden:')) {
    // Distinguish namespace-crossing from generic forbidden
    if (
      msgLower.includes('cannot get') ||
      msgLower.includes('namespace') ||
      msgLower.includes('is not allowed')
    ) {
      addMatch('forbidden-namespace');
    } else {
      addMatch('forbidden-rbac');
    }
  }

  // ── ResourceQuota / LimitRange ──────────────────────────────────────────
  if (msgLower.includes('exceeded quota') || msgLower.includes('exceeded the quota')) {
    if (msgLower.includes('cpu')) {
      addMatch('quota-exceeded-cpu');
    } else if (msgLower.includes('memory')) {
      addMatch('quota-exceeded-memory');
    } else if (msgLower.includes('pods') || msgLower.includes('count/pods')) {
      addMatch('quota-exceeded-pods');
    } else {
      // Cannot tell from message alone — surface both CPU and memory
      addMatch('quota-exceeded-cpu');
      addMatch('quota-exceeded-memory');
    }
  }

  if (
    (msgLower.includes('pods') || msgLower.includes('count/pods')) &&
    (msgLower.includes('exceeded') || msgLower.includes('maximum'))
  ) {
    addMatch('quota-exceeded-pods');
  }

  if (
    msgLower.includes('limitrange') ||
    msgLower.includes('maximum cpu') ||
    msgLower.includes('maximum memory') ||
    msgLower.includes('minimum cpu') ||
    msgLower.includes('minimum memory') ||
    (msgLower.includes('must be less than') && msgLower.includes('limit'))
  ) {
    addMatch('limitrange-violation');
  }

  // ── NetworkPolicy ───────────────────────────────────────────────────────
  // NetworkPolicy drops are silent at the TCP level; we detect them from events.
  if (
    msgLower.includes('networkpolicy') ||
    msgLower.includes('network policy') ||
    events.some(
      (e) =>
        e &&
        typeof e.message === 'string' &&
        (e.message.toLowerCase().includes('networkpolicy') ||
          e.message.toLowerCase().includes('network policy'))
    )
  ) {
    addMatch('networkpolicy-egress-blocked');
    addMatch('networkpolicy-ingress-blocked');
  }

  // ── Image / Registry ────────────────────────────────────────────────────
  if (
    msgLower.includes('imagepullbackoff') ||
    msgLower.includes('errimagepull') ||
    msgLower.includes('failed to pull image') ||
    msgLower.includes('back-off pulling image')
  ) {
    addMatch('image-pull-backoff');
  }

  if (
    msgLower.includes('not scanned') ||
    msgLower.includes('scan pending') ||
    (msgLower.includes('harbor') && msgLower.includes('vulnerability'))
  ) {
    addMatch('image-not-scanned');
  }

  // ── Kyverno image registry fallback ─────────────────────────────────────
  if (
    msgLower.includes('registry') &&
    (msgLower.includes('not allowed') || msgLower.includes('not approved') || msgLower.includes('disallow'))
  ) {
    addMatch('restrict-image-registries');
  }

  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY_FIXES — one-line quick fix strings for every Kyverno policy
// Used in toasts, tooltips, and compact error banners.
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_FIXES = {
  // Baseline
  'disallow-privileged-containers': 'Remove securityContext.privileged: true from your container spec.',
  'disallow-host-namespaces': 'Remove hostPID, hostIPC, and hostNetwork from your pod spec.',
  'disallow-host-ports': 'Remove hostPort from container ports; use a Service + VirtualService instead.',
  'restrict-unsafe-sysctls': 'Remove unsafe sysctls; only kernel.shm_rmid_forced, net.ipv4.* safe list is allowed.',

  // Restricted
  'require-run-as-nonroot': 'Add a non-root USER to your Dockerfile and set securityContext.runAsNonRoot: true.',
  'require-drop-all-capabilities': 'Add securityContext.capabilities.drop: [ALL] to every container.',
  'disallow-privilege-escalation': 'Set securityContext.allowPrivilegeEscalation: false on every container.',
  'restrict-volume-types': 'Replace hostPath / NFS volumes with emptyDir, secret, configMap, or a PVC.',

  // Custom
  'require-labels': 'Add app.kubernetes.io/name, app.kubernetes.io/part-of: sre-platform, and sre.io/team labels.',
  'disallow-latest-tag': 'Replace :latest with a pinned version tag (e.g., v1.2.3 or a git SHA).',
  'restrict-image-registries': 'Push your image to harbor.apps.sre.example.com/<team>/<app>:<tag> first.',
  'require-resource-limits': 'Set resources.requests and resources.limits (CPU + memory) on every container.',
  'require-probes': 'Add /healthz (liveness) and /readyz (readiness) HTTP endpoints to your app.',
  'require-security-context': 'Use the SRE Helm chart; it sets runAsNonRoot, readOnlyRootFilesystem, and drops ALL caps automatically.',
  'verify-image-signatures': 'Sign your image with Cosign after pushing to Harbor, or use the DSOP pipeline which signs automatically.',
  'require-network-policies': 'Namespace not fully onboarded — ask platform admin to run: ./scripts/onboard-tenant.sh <team>.',
  'require-istio-sidecar': 'Namespace missing istio-injection=enabled label — ask platform admin to re-run onboarding.',
  'require-security-categorization': 'Add label sre.io/security-categorization: moderate (or low) to the namespace.',
  'disallow-default-namespace': 'Deploy to your team namespace (e.g., team-alpha), not the "default" namespace.',
};

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { ERROR_KNOWLEDGE_BASE, matchError, POLICY_FIXES };
