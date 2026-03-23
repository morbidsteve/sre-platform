{{/*
ExternalSecret resource template.
Renders ExternalSecret resources for each env entry that has a secretRef.
Syncs secrets from OpenBao via the External Secrets Operator.
*/}}
{{- define "sre-lib.externalsecret" -}}
{{- range .Values.app.env }}
{{- if .secretRef }}
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ .secretRef }}
  labels:
    {{- include "sre-lib.labels" $ | nindent 4 }}
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
{{- end -}}
