{{/*
Common labels for all resources.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-worker.labels" -}}
{{ include "sre-lib.labels" . }}
{{- end }}

{{/*
Selector labels used by Deployment.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-worker.selectorLabels" -}}
{{ include "sre-lib.selectorLabels" . }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-worker.fullname" -}}
{{ include "sre-lib.fullname" . }}
{{- end }}

{{/*
ServiceAccount name.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-worker.serviceAccountName" -}}
{{ include "sre-lib.serviceAccountName" . }}
{{- end }}
