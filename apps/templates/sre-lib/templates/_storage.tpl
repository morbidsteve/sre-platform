{{/*
Storage ExternalSecret resource.
Generates an ExternalSecret to sync S3-compatible storage credentials from OpenBao.
*/}}
{{- define "sre-lib.storage-externalsecret" -}}
{{- if and (hasKey .Values "storage") .Values.storage.enabled }}
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ include "sre-lib.fullname" . }}-storage-creds
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: openbao-backend
    kind: ClusterSecretStore
  target:
    name: {{ include "sre-lib.fullname" . }}-storage-creds
  data:
    - secretKey: AWS_ACCESS_KEY_ID
      remoteRef:
        key: sre/{{ .Values.app.team }}/storage/{{ .Values.app.name }}
        property: access_key_id
    - secretKey: AWS_SECRET_ACCESS_KEY
      remoteRef:
        key: sre/{{ .Values.app.team }}/storage/{{ .Values.app.name }}
        property: secret_access_key
{{- end }}
{{- end -}}

{{/*
Storage ConfigMap resource.
Generates a ConfigMap with S3 endpoint and bucket configuration.
*/}}
{{- define "sre-lib.storage-configmap" -}}
{{- if and (hasKey .Values "storage") .Values.storage.enabled }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "sre-lib.fullname" . }}-storage-config
  labels:
    {{- include "sre-lib.labels" . | nindent 4 }}
data:
  STORAGE_ENDPOINT: {{ .Values.storage.endpoint | default "https://minio.sre.internal" | quote }}
  STORAGE_BUCKET: {{ .Values.storage.bucket | default (printf "%s-%s" .Values.app.team .Values.app.name) | quote }}
  STORAGE_REGION: {{ .Values.storage.region | default "us-east-1" | quote }}
  STORAGE_USE_SSL: "true"
{{- end }}
{{- end -}}
