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
