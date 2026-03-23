{{/*
sre-lib: Shared template helpers for SRE Platform Helm charts.

All charts should define thin wrappers that call these templates,
so chart-specific names still work while the logic lives here.

Example in a consuming chart's _helpers.tpl:
  {{- define "sre-web-app.labels" -}}
  {{ include "sre-lib.labels" . }}
  {{- end -}}
*/}}

{{/*
Common labels for all resources.
*/}}
{{- define "sre-lib.labels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.app.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sre-platform
sre.io/team: {{ .Values.app.team }}
{{- end }}

{{/*
Selector labels used by Deployment, Service, and other selectors.
*/}}
{{- define "sre-lib.selectorLabels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
*/}}
{{- define "sre-lib.fullname" -}}
{{- printf "%s-%s" .Release.Name .Values.app.name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "sre-lib.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- include "sre-lib.fullname" . }}
{{- else }}
{{- "default" }}
{{- end }}
{{- end }}

{{/*
Pod-level security context with hardened defaults.
Consumers can override via .Values.podSecurityContext.
*/}}
{{- define "sre-lib.podSecurityContext" -}}
{{- if .Values.podSecurityContext }}
{{- toYaml .Values.podSecurityContext }}
{{- else }}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end }}
{{- end }}

{{/*
Container-level security context with hardened defaults.
Consumers can override via .Values.containerSecurityContext.
*/}}
{{- define "sre-lib.containerSecurityContext" -}}
{{- if .Values.containerSecurityContext }}
{{- toYaml .Values.containerSecurityContext }}
{{- else }}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop:
    - ALL
{{- end }}
{{- end }}

{{/*
Environment variables from .Values.app.env, supporting both
plain values and secretRef (for ExternalSecrets/OpenBao).
*/}}
{{- define "sre-lib.env" -}}
{{- range .Values.app.env }}
{{- if .value }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
{{- if .secretRef }}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ .secretRef }}
      key: value
{{- end }}
{{- end }}
{{- end }}

{{/*
Resource requests and limits from .Values.app.resources.
*/}}
{{- define "sre-lib.resources" -}}
requests:
  cpu: {{ .Values.app.resources.requests.cpu }}
  memory: {{ .Values.app.resources.requests.memory }}
limits:
  cpu: {{ .Values.app.resources.limits.cpu }}
  memory: {{ .Values.app.resources.limits.memory }}
{{- end }}
