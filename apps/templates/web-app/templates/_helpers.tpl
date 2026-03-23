{{/*
Common labels for all resources.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-web-app.labels" -}}
{{ include "sre-lib.labels" . }}
{{- end }}

{{/*
Selector labels used by Deployment and Service.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-web-app.selectorLabels" -}}
{{ include "sre-lib.selectorLabels" . }}
{{- end }}

{{/*
Full resource name, truncated to 63 characters.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-web-app.fullname" -}}
{{ include "sre-lib.fullname" . }}
{{- end }}

{{/*
ServiceAccount name.
Delegates to sre-lib shared helper.
*/}}
{{- define "sre-web-app.serviceAccountName" -}}
{{ include "sre-lib.serviceAccountName" . }}
{{- end }}
