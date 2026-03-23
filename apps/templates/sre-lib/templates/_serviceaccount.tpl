{{/*
ServiceAccount resource template.
Renders a ServiceAccount when .Values.serviceAccount.create is true.
*/}}
{{- define "sre-lib.serviceaccount" -}}
{{- if .Values.serviceAccount.create }}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "sre-lib.serviceAccountName" . }}
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
automountServiceAccountToken: false
{{- end }}
{{- end -}}
