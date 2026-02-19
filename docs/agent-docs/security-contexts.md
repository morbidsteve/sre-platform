# Security Contexts for SRE

Read this before creating any Deployment, StatefulSet, DaemonSet, Job, or CronJob manifest. Every workload MUST have a security context. Kyverno will reject any pod without one.

## The Standard Security Context

This is the default security context for ALL application workloads. Copy this exactly unless you have a documented exception.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      # ----- Pod-level security context -----
      automountServiceAccountToken: false
      serviceAccountName: my-app          # Dedicated SA, never use default
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534                  # nobody user
        runAsGroup: 65534                 # nobody group
        fsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      # ----- Container-level security context -----
      containers:
        - name: my-app
          image: harbor.sre.internal/team/my-app:v1.2.3
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop:
                - ALL
          # ----- Resource limits are mandatory -----
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          # ----- Probes are mandatory -----
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          # ----- Writable directories use emptyDir -----
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 100Mi
        - name: cache
          emptyDir:
            sizeLimit: 200Mi
```

## Field-by-Field Explanation

### Pod-level

| Field | Value | Why |
|-------|-------|-----|
| `automountServiceAccountToken` | `false` | Pods should not access the Kubernetes API unless they need to. Set to `true` ONLY for controllers that require API access. |
| `serviceAccountName` | dedicated SA | Never use the `default` SA. Create one per workload for RBAC scoping. |
| `runAsNonRoot` | `true` | Prevents container from running as UID 0. DISA STIG requirement. |
| `runAsUser` | `65534` | The `nobody` user. Override only if the app requires a specific UID. |
| `runAsGroup` | `65534` | The `nobody` group. Override only if the app requires a specific GID. |
| `fsGroup` | `65534` | Group ownership for mounted volumes. Match `runAsGroup`. |
| `seccompProfile.type` | `RuntimeDefault` | Applies the container runtime's default seccomp profile. Blocks dangerous syscalls. |

### Container-level

| Field | Value | Why |
|-------|-------|-----|
| `allowPrivilegeEscalation` | `false` | Prevents `setuid` binaries from gaining elevated privileges. DISA STIG requirement. |
| `readOnlyRootFilesystem` | `true` | Container filesystem is read-only. Forces apps to write only to mounted volumes. |
| `runAsNonRoot` | `true` | Redundant with pod-level but acts as defense-in-depth at container level. |
| `capabilities.drop` | `ALL` | Drops all Linux capabilities. Add back specific ones ONLY if documented and approved. |

### Resources

| Field | Required | Why |
|-------|----------|-----|
| `requests.cpu` | Yes | Scheduler needs this for bin-packing. Kyverno rejects pods without it. |
| `requests.memory` | Yes | Scheduler needs this for bin-packing. Kyverno rejects pods without it. |
| `limits.cpu` | Yes | Prevents CPU starvation of other pods. |
| `limits.memory` | Yes | Prevents OOM kills of other pods. Pod is OOM-killed if it exceeds this. |

### Volumes

Apps that need writable directories (tmp files, caches, PID files) MUST use `emptyDir` mounts:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 100Mi    # Always set a size limit
```

## Platform Component Exceptions

Some platform components need elevated permissions. These are the ONLY approved exceptions:

### Istio sidecar (injected automatically)

```yaml
# Istio init container needs NET_ADMIN and NET_RAW to set up iptables rules
# This is handled by Istio injection — you do not write this manually
securityContext:
  capabilities:
    add:
      - NET_ADMIN
      - NET_RAW
```

**Kyverno exclusion**: Istio system namespace is excluded from the drop-ALL-capabilities policy.

### NeuVector

```yaml
# NeuVector enforcer runs as privileged to monitor container runtime
# This is configured in the NeuVector HelmRelease, not by users
securityContext:
  privileged: true
```

**Kyverno exclusion**: `neuvector` namespace is excluded from privileged container policies.

### Alloy (log collector)

```yaml
# Alloy needs to read log files from host
securityContext:
  runAsUser: 0              # Needs root to read /var/log
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
volumeMounts:
  - name: varlog
    mountPath: /var/log
    readOnly: true
```

**Kyverno exclusion**: `logging` namespace is excluded from the run-as-non-root policy.

### Velero / Node Agent

```yaml
# Velero node agent needs host access for filesystem backups
securityContext:
  privileged: true
```

**Kyverno exclusion**: `velero` namespace is excluded from privileged container policies.

## How Exceptions Work

Platform component exceptions are managed in Kyverno with explicit `exclude` blocks:

```yaml
spec:
  rules:
    - name: require-run-as-nonroot
      match:
        any:
          - resources:
              kinds:
                - Pod
      exclude:
        any:
          - resources:
              namespaces:
                - kube-system
                - istio-system
                - neuvector
                - logging
                - velero
```

New exceptions MUST be:
1. Documented in this file with the exact capabilities needed and why
2. Added to the relevant Kyverno policy exclude block
3. Reviewed and approved via PR
4. Annotated with the NIST control that justifies the exception (typically AC-6 with compensating controls documented)

## Kyverno Policies That Enforce These Contexts

These policies in `policies/` enforce the security context requirements:

| Policy | What It Enforces |
|--------|-----------------|
| `disallow-privileged.yaml` | No privileged containers |
| `disallow-privilege-escalation.yaml` | `allowPrivilegeEscalation: false` |
| `require-run-as-nonroot.yaml` | `runAsNonRoot: true` |
| `require-drop-all-capabilities.yaml` | `capabilities.drop: [ALL]` |
| `require-resource-limits.yaml` | CPU and memory requests and limits set |
| `require-readonly-rootfs.yaml` | `readOnlyRootFilesystem: true` |
| `require-seccomp-profile.yaml` | `seccompProfile.type: RuntimeDefault` |
| `disallow-default-serviceaccount.yaml` | Cannot use `default` ServiceAccount |

## Quick Copy-Paste Checklist

When writing a new Deployment, verify:

- [ ] `automountServiceAccountToken: false`
- [ ] `serviceAccountName` is NOT `default`
- [ ] `runAsNonRoot: true` at pod AND container level
- [ ] `seccompProfile.type: RuntimeDefault`
- [ ] `allowPrivilegeEscalation: false`
- [ ] `readOnlyRootFilesystem: true`
- [ ] `capabilities.drop: [ALL]`
- [ ] `resources.requests.cpu` and `resources.requests.memory` set
- [ ] `resources.limits.cpu` and `resources.limits.memory` set
- [ ] Writable paths use `emptyDir` with `sizeLimit`
- [ ] Liveness and readiness probes defined
- [ ] Image from `harbor.sre.internal` with pinned tag
