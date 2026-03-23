{{/*
ServiceMonitor resource template (simple variant).
For charts that already have a Service (web-app, api-service).
Renders a ServiceMonitor when .Values.serviceMonitor.enabled is true.
*/}}
{{- define "sre-lib.servicemonitor" -}}
{{- if .Values.serviceMonitor.enabled }}
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "sre-lib.fullname" . }}
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "sre-lib.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: http
      path: {{ .Values.serviceMonitor.path }}
      interval: {{ .Values.serviceMonitor.interval }}
{{- end }}
{{- end -}}

{{/*
ServiceMonitor with headless Service (for charts without a main Service).
Used by worker and cronjob charts that expose metrics on a dedicated port.
Renders both the headless Service and ServiceMonitor.
*/}}
{{- define "sre-lib.servicemonitor-headless" -}}
{{- if .Values.serviceMonitor.enabled }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "sre-lib.fullname" . }}-metrics
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  clusterIP: None
  ports:
    - port: {{ .Values.serviceMonitor.port }}
      targetPort: {{ .Values.serviceMonitor.port }}
      protocol: TCP
      name: metrics
  selector:
    {{- include "sre-lib.selectorLabels" . | nindent 4 }}
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "sre-lib.fullname" . }}
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "sre-lib.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: metrics
      path: {{ .Values.serviceMonitor.path }}
      interval: {{ .Values.serviceMonitor.interval }}
{{- end }}
{{- end -}}
