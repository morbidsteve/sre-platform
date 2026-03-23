{{/*
Common labels for all resources.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-api-service.labels" -}}
{{ include "sre-lib.labels" . }}
{{- end }}

{{/*
Selector labels used by Deployment and Service.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-api-service.selectorLabels" -}}
{{ include "sre-lib.selectorLabels" . }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-api-service.fullname" -}}
{{ include "sre-lib.fullname" . }}
{{- end }}

{{/*
ServiceAccount name.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-api-service.serviceAccountName" -}}
{{ include "sre-lib.serviceAccountName" . }}
{{- end }}
