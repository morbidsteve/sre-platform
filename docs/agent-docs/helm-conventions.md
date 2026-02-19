# Helm Chart Conventions for SRE

Read this before creating or modifying Helm charts in `apps/templates/`.

## Chart Structure

Every app template chart follows this layout:

```
apps/templates/<chart-name>/
├── Chart.yaml
├── values.yaml
├── values.schema.json          # REQUIRED — JSON Schema for values validation
├── README.md
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── serviceaccount.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── networkpolicy.yaml
│   ├── servicemonitor.yaml
│   ├── virtualservice.yaml     # Istio ingress (if app has external traffic)
│   ├── authorizationpolicy.yaml # Istio RBAC (for internal APIs)
│   ├── externalsecret.yaml     # ESO secret sync from OpenBao
│   └── NOTES.txt
└── tests/
    └── test-connection.yaml
```

## Chart.yaml

```yaml
apiVersion: v2
name: sre-web-app
description: SRE standard Helm chart for web applications
type: application
version: 0.1.0        # Chart version — bump on chart changes
appVersion: "1.0.0"   # Default app version — overridden per deployment
```

## values.yaml Conventions

Structure values in logical groups. Every value that a developer needs to set should be at the top level under `app:`.

```yaml
# --- Developer-facing values (what app teams configure) ---
app:
  name: ""                    # REQUIRED
  team: ""                    # REQUIRED
  image:
    repository: ""            # REQUIRED — e.g., harbor.sre.internal/teamname/appname
    tag: ""                   # REQUIRED — e.g., v1.2.3
    pullPolicy: IfNotPresent
  port: 8080
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
  env: []
  #  - name: DATABASE_URL
  #    secretRef: my-db-secret   # Synced from OpenBao via ESO
  probes:
    liveness:
      path: /healthz
      initialDelaySeconds: 10
    readiness:
      path: /readyz
      initialDelaySeconds: 5

# --- Ingress ---
ingress:
  enabled: false
  host: ""                     # e.g., my-app.apps.sre.example.com
  gateway: istio-system/main   # Istio gateway reference

# --- Autoscaling ---
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilization: 80

# --- Platform integration (usually not changed by app teams) ---
serviceMonitor:
  enabled: true
  interval: 30s
  path: /metrics

networkPolicy:
  enabled: true
  additionalIngress: []
  additionalEgress: []

podDisruptionBudget:
  enabled: true
  minAvailable: 1
```

## values.schema.json

REQUIRED for every chart. This validates values at install time and provides documentation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["app"],
  "properties": {
    "app": {
      "type": "object",
      "required": ["name", "team", "image"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "Application name, used for resource naming"
        },
        "team": {
          "type": "string",
          "minLength": 1,
          "description": "Owning team name, used for labels and RBAC"
        },
        "image": {
          "type": "object",
          "required": ["repository", "tag"],
          "properties": {
            "repository": {
              "type": "string",
              "pattern": "^harbor\\.sre\\.internal/",
              "description": "Must be from the internal Harbor registry"
            },
            "tag": {
              "type": "string",
              "minLength": 1,
              "not": { "const": "latest" },
              "description": "Image tag — must be pinned, never latest"
            }
          }
        }
      }
    }
  }
}
```

## Security Context — MANDATORY

Every Deployment template MUST include this security context. See @docs/agent-docs/security-contexts.md for the full reference.

```yaml
spec:
  template:
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ .Values.app.name }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop:
                - ALL
```

## Labels — MANDATORY

Every resource MUST have these labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: {{ .Values.app.name }}
    app.kubernetes.io/instance: {{ .Release.Name }}
    app.kubernetes.io/version: {{ .Values.app.image.tag }}
    app.kubernetes.io/managed-by: {{ .Release.Service }}
    app.kubernetes.io/part-of: sre-platform
    sre.io/team: {{ .Values.app.team }}
```

## NetworkPolicy — MANDATORY

Every chart includes a NetworkPolicy. Default: deny all, allow from Istio gateway (if ingress enabled) and from monitoring namespace.

## ExternalSecret Template

For apps that need secrets from OpenBao:

```yaml
{{- range .Values.app.env }}
{{- if .secretRef }}
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ .secretRef }}
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: {{ .secretRef }}
  data:
    - secretKey: value
      remoteRef:
        key: sre/{{ $.Values.app.team }}/{{ .secretRef }}
{{- end }}
{{- end }}
```

## Testing Charts

```bash
# Lint
helm lint apps/templates/<chart>/

# Template render (dry-run)
helm template test apps/templates/<chart>/ -f test-values.yaml

# Unit tests (requires helm-unittest plugin)
helm unittest apps/templates/<chart>/

# Schema validation
helm install --dry-run --debug test apps/templates/<chart>/ -f test-values.yaml
```

## Common Mistakes

- Missing `values.schema.json` — every chart MUST have one
- Missing security context — pods will be rejected by Kyverno
- Using `automountServiceAccountToken: true` — default should be false
- Forgetting NetworkPolicy — pods will have unrestricted network access
- Missing ServiceMonitor — component won't appear in monitoring dashboards
- Using `:latest` or unpinned image tags in values defaults
- Missing PodDisruptionBudget — unsafe for rolling upgrades
- Forgetting NOTES.txt — users get no post-install instructions
