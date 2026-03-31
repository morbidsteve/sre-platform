{{/*
ClusterIP Service resource template.
Used by web-app and api-service charts.
*/}}
{{- define "sre-lib.service" -}}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "sre-lib.fullname" . }}
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.app.port }}
      targetPort: http
      protocol: TCP
      name: {{ if and .Values.ingress (.Values.ingress.backendProtocol | default "" | eq "HTTPS") }}tcp{{ else }}http{{ end }}
      {{- if and (hasKey .Values "appProtocol") (ne .Values.appProtocol "http") }}
      appProtocol: {{ .Values.appProtocol }}
      {{- end }}
    {{- range .Values.extraPorts | default list }}
    - name: {{ .name }}
      port: {{ .port }}
      targetPort: {{ .targetPort }}
      protocol: {{ .protocol | default "TCP" }}
    {{- end }}
  selector:
    {{- include "sre-lib.selectorLabels" . | nindent 4 }}
{{- end -}}
