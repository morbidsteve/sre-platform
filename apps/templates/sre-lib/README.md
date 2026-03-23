# sre-lib - Shared Helm Library Chart

A Helm library chart containing shared template helpers used by all SRE Platform application charts. This eliminates template duplication across the web-app, api-service, worker, and cronjob charts.

## What is a Library Chart?

A library chart (`type: library` in Chart.yaml) cannot be installed directly. It provides named templates that other charts import via the `dependencies` section of their `Chart.yaml`.

## Available Templates

### Helper Functions (\_helpers.tpl)

| Template | Description |
|----------|-------------|
| `sre-lib.labels` | Standard Kubernetes labels (name, instance, version, managed-by, part-of, team) |
| `sre-lib.selectorLabels` | Selector labels for Deployments and Services (name, instance) |
| `sre-lib.fullname` | Full resource name (`<release>-<app.name>`), truncated to 63 chars |
| `sre-lib.serviceAccountName` | ServiceAccount name (fullname if create=true, else "default") |
| `sre-lib.podSecurityContext` | Pod-level security context with hardened defaults (non-root, seccomp) |
| `sre-lib.containerSecurityContext` | Container-level security context (no privilege escalation, read-only rootfs, drop ALL caps) |
| `sre-lib.env` | Environment variables from `.Values.app.env` (plain values and secretRef) |
| `sre-lib.resources` | Resource requests and limits from `.Values.app.resources` |

### Resource Templates

| Template | Renders | Used By |
|----------|---------|---------|
| `sre-lib.serviceaccount` | ServiceAccount (when `.Values.serviceAccount.create` is true) | All charts |
| `sre-lib.pdb` | PodDisruptionBudget (when `.Values.podDisruptionBudget.enabled` is true) | web-app, api-service, worker |
| `sre-lib.hpa` | HorizontalPodAutoscaler (when `.Values.autoscaling.enabled` is true) | web-app, api-service, worker |
| `sre-lib.externalsecret` | ExternalSecret for each env entry with a secretRef | All charts |
| `sre-lib.servicemonitor` | ServiceMonitor (for charts with an existing Service) | web-app, api-service |
| `sre-lib.servicemonitor-headless` | Headless Service + ServiceMonitor (for charts without a main Service) | worker, cronjob |
| `sre-lib.service` | ClusterIP Service | web-app, api-service |

### NetworkPolicy Helpers

| Template | Description |
|----------|-------------|
| `sre-lib.networkpolicy-egress` | Standard egress rules: DNS, same-namespace, HTTPS, plus additionalEgress |
| `sre-lib.networkpolicy-ingress-monitoring` | Ingress rule allowing Prometheus scraping from monitoring namespace |
| `sre-lib.networkpolicy-ingress-same-namespace` | Ingress rule allowing traffic from same namespace |
| `sre-lib.networkpolicy-ingress-istio-gateway` | Ingress rule allowing traffic from Istio ingress gateway |

## How to Use

### 1. Add as a dependency

In the consuming chart's `Chart.yaml`:

```yaml
dependencies:
  - name: sre-lib
    version: "0.1.0"
    repository: "file://../sre-lib"
```

### 2. Create wrapper helpers

In the consuming chart's `_helpers.tpl`, create thin wrappers that delegate to the library:

```yaml
{{- define "my-chart.labels" -}}
{{ include "sre-lib.labels" . }}
{{- end -}}

{{- define "my-chart.fullname" -}}
{{ include "sre-lib.fullname" . }}
{{- end -}}
```

### 3. Use resource templates

For identical resources (ServiceAccount, PDB, HPA), replace the template file content with a single include:

```yaml
{{ include "sre-lib.serviceaccount" . }}
```

### 4. Use helper templates in chart-specific resources

For resources with chart-specific logic (Deployment, NetworkPolicy), use the library helpers for common parts:

```yaml
securityContext:
  {{- include "sre-lib.podSecurityContext" . | nindent 8 }}
containers:
  - name: {{ .Values.app.name }}
    securityContext:
      {{- include "sre-lib.containerSecurityContext" . | nindent 12 }}
    resources:
      {{- include "sre-lib.resources" . | nindent 12 }}
    env:
      {{- include "sre-lib.env" . | nindent 12 }}
```

### 5. Update dependencies

After adding the dependency, run:

```bash
helm dependency update apps/templates/<chart>/
```

## Required Values Structure

Consuming charts must provide these values for the library templates to work:

```yaml
app:
  name: ""
  team: ""
  image:
    tag: ""
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
  env: []

serviceAccount:
  create: true

# For pdb template:
podDisruptionBudget:
  enabled: true
  minAvailable: 1

# For hpa template:
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilization: 80

# For servicemonitor template:
serviceMonitor:
  enabled: true
  interval: "30s"
  path: /metrics

# For networkpolicy-egress template:
networkPolicy:
  additionalEgress: []
```
