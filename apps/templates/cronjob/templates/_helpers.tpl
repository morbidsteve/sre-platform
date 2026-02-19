{{/*
Common labels for all resources.
*/}}
{{- define "sre-cronjob.labels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.app.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sre-platform
sre.io/team: {{ .Values.app.team }}
{{- end }}

{{/*
Selector labels used for pod selection.
*/}}
{{- define "sre-cronjob.selectorLabels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
*/}}
{{- define "sre-cronjob.fullname" -}}
{{- printf "%s-%s" .Release.Name .Values.app.name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "sre-cronjob.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- include "sre-cronjob.fullname" . }}
{{- else }}
{{- "default" }}
{{- end }}
{{- end }}
