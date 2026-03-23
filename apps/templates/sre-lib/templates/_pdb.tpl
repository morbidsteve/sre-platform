{{/*
PodDisruptionBudget resource template.
Renders a PDB when .Values.podDisruptionBudget.enabled is true.
*/}}
{{- define "sre-lib.pdb" -}}
{{- if .Values.podDisruptionBudget.enabled }}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "sre-lib.fullname" . }}
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "sre-lib.selectorLabels" . | nindent 6 }}
{{- end }}
{{- end -}}
