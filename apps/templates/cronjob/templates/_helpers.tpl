{{/*
Common labels for all resources.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-cronjob.labels" -}}
{{ include "sre-lib.labels" . }}
{{- end }}

{{/*
Selector labels used for pod selection.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-cronjob.selectorLabels" -}}
{{ include "sre-lib.selectorLabels" . }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-cronjob.fullname" -}}
{{ include "sre-lib.fullname" . }}
{{- end }}

{{/*
ServiceAccount name.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-cronjob.serviceAccountName" -}}
{{ include "sre-lib.serviceAccountName" . }}
{{- end }}
