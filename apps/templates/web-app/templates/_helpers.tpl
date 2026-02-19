{{/*
Common labels for all resources.
*/}}
{{- define "sre-web-app.labels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.app.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sre-platform
sre.io/team: {{ .Values.app.team }}
{{- end }}

{{/*
Selector labels used by Deployment and Service.
*/}}
{{- define "sre-web-app.selectorLabels" -}}
app.kubernetes.io/name: {{ .Values.app.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
*/}}
{{- define "sre-web-app.fullname" -}}
{{- printf "%s-%s" .Release.Name .Values.app.name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "sre-web-app.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- include "sre-web-app.fullname" . }}
{{- else }}
{{- "default" }}
{{- end }}
{{- end }}
