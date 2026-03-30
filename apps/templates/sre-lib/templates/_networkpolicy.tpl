{{/*
NetworkPolicy egress rules shared by all chart types.
Provides DNS resolution, same-namespace traffic, and HTTPS egress.
*/}}
{{- define "sre-lib.networkpolicy-egress" -}}
# DNS resolution
- to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
  ports:
    - port: 53
      protocol: UDP
    - port: 53
      protocol: TCP
# Allow traffic to same namespace
- to:
    - podSelector: {}
# Allow HTTPS egress (for external APIs)
- to:
    - ipBlock:
        cidr: 0.0.0.0/0
  ports:
    - port: 443
      protocol: TCP
{{- if .Values.networkPolicy.allowedServices }}
{{- include "sre-lib.networkpolicy-egress-allowed-services" . | nindent 0 }}
{{- end }}
{{- with .Values.networkPolicy.additionalEgress }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}

{{/*
NetworkPolicy ingress rule: allow Prometheus scraping from monitoring namespace.
Requires port as argument (uses app.port for web/api, serviceMonitor.port for worker/cronjob).
*/}}
{{- define "sre-lib.networkpolicy-ingress-monitoring" -}}
# Allow Prometheus scraping from monitoring namespace
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: monitoring
  ports:
    - port: {{ . }}
      protocol: TCP
{{- end -}}

{{/*
NetworkPolicy ingress rule: allow traffic from same namespace.
*/}}
{{- define "sre-lib.networkpolicy-ingress-same-namespace" -}}
# Allow traffic from same namespace
- from:
    - podSelector: {}
  ports:
    - port: {{ . }}
      protocol: TCP
{{- end -}}

{{/*
NetworkPolicy ingress rule: allow traffic from Istio ingress gateway.
*/}}
{{- define "sre-lib.networkpolicy-ingress-istio-gateway" -}}
# Allow traffic from Istio ingress gateway
- from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: istio-system
      podSelector:
        matchLabels:
          istio: gateway
  ports:
    - port: {{ . }}
      protocol: TCP
{{- end -}}

{{/*
NetworkPolicy egress rules for explicitly declared service dependencies.
Renders one egress rule per entry in .Values.networkPolicy.allowedServices.
*/}}
{{- define "sre-lib.networkpolicy-egress-allowed-services" -}}
{{- range .Values.networkPolicy.allowedServices }}
# Allow egress to {{ .name }}{{ if .namespace }} in {{ .namespace }}{{ end }}
- to:
    {{- if .namespace }}
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ .namespace }}
      podSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .name }}
    {{- else }}
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .name }}
    {{- end }}
  ports:
    - port: {{ .port | default 8080 }}
      protocol: TCP
{{- end }}
{{- end -}}

{{/*
NetworkPolicy ingress rules for explicitly declared callers.
Renders one ingress rule per entry in .Values.networkPolicy.allowedCallers.
*/}}
{{- define "sre-lib.networkpolicy-ingress-allowed-callers" -}}
{{- range .Values.networkPolicy.allowedCallers }}
# Allow ingress from {{ .name }}{{ if .namespace }} in {{ .namespace }}{{ end }}
- from:
    {{- if .namespace }}
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: {{ .namespace }}
      podSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .name }}
    {{- else }}
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .name }}
    {{- end }}
  ports:
    - port: {{ .port | default ($.Values.app.port | default 8080) }}
      protocol: TCP
{{- end }}
{{- end -}}
