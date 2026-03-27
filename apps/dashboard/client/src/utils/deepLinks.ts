export type DeepLinkTarget =
  | 'grafana:cluster-overview' | 'grafana:kyverno-violations' | 'grafana:istio-mesh'
  | 'grafana:istio-workload' | 'grafana:cert-manager' | 'grafana:flux-reconciliation'
  | 'grafana:node-exporter' | 'grafana:loki-logs' | 'grafana:loki-audit-logs'
  | 'grafana:tempo-traces' | 'grafana:alertmanager'
  | 'grafana:harbor' | 'grafana:keycloak' | 'grafana:neuvector' | 'grafana:openbao'
  | 'grafana:compliance-trend' | 'grafana:namespace-resources'
  | 'grafana:k8s-resources-cluster' | 'grafana:k8s-resources-namespace'
  | 'grafana:k8s-resources-pod' | 'grafana:k8s-resources-workload'
  | 'grafana:pv-usage' | 'grafana:alerts'
  | 'harbor:projects' | 'harbor:scan-results' | 'harbor:project-images'
  | 'neuvector:runtime-security' | 'neuvector:network-activity' | 'neuvector:vulnerabilities'
  | 'neuvector:compliance'
  | 'keycloak:users' | 'keycloak:groups' | 'keycloak:sessions';

const DEEP_LINK_PATHS: Record<string, string> = {
  // Grafana — named dashboards
  'grafana:cluster-overview': '/d/sre-cluster-overview/cluster-summary',
  'grafana:kyverno-violations': '/d/sre-kyverno-compliance/compliance-summary',
  'grafana:istio-mesh': '/d/sre-istio-mesh/mesh-summary',
  'grafana:cert-manager': '/d/sre-cert-manager/certificate-overview',
  'grafana:flux-reconciliation': '/d/sre-flux-gitops/flux-summary',
  'grafana:harbor': '/d/sre-harbor/harbor',
  'grafana:keycloak': '/d/sre-keycloak/keycloak',
  'grafana:neuvector': '/d/sre-neuvector/neuvector',
  'grafana:openbao': '/d/sre-openbao/openbao',
  'grafana:compliance-trend': '/d/sre-compliance-trend/compliance-trend',
  'grafana:namespace-resources': '/d/sre-namespace-resources/namespace-resources',
  // Grafana — UID-only dashboards (kube-prometheus-stack built-ins)
  'grafana:k8s-resources-cluster': '/d/efa86fd1d0c121a26444b636a3f509a8',
  'grafana:k8s-resources-namespace': '/d/85a562078cdf77779eaa1add43ccec1e',
  'grafana:k8s-resources-pod': '/d/6581e46e4e5c7ba40a07646395ef7b23',
  'grafana:k8s-resources-workload': '/d/a164a7f0339f99e89cea5cb47e9be617',
  'grafana:pv-usage': '/d/919b92a8e8041bd567af9edab12c840c',
  // Grafana — Explore / Alerting
  'grafana:loki-logs': '/explore?orgId=1&left={"datasource":"Loki"}',
  'grafana:loki-audit-logs': '/explore?orgId=1&left={"datasource":"Loki","queries":[{"expr":"{job=\\"systemd-journal\\"} |= \\"audit\\""}]}',
  'grafana:tempo-traces': '/explore?orgId=1&left={"datasource":"Tempo"}',
  'grafana:alertmanager': '/alerting/list',
  'grafana:alerts': '/alerting/list',
  // Harbor
  'harbor:projects': '/harbor/projects',
  'harbor:scan-results': '/harbor/projects',
  // NeuVector
  'neuvector:runtime-security': '/#/security-events',
  'neuvector:vulnerabilities': '/#/vulnerabilities',
  'neuvector:network-activity': '/#/network-activity',
  'neuvector:compliance': '/#/compliance',
  // Keycloak
  'keycloak:users': '/admin/realms/sre/users',
  'keycloak:groups': '/admin/realms/sre/groups',
  'keycloak:sessions': '/admin/realms/sre/sessions',
};

export function deepLink(
  config: { domain: string },
  target: DeepLinkTarget | string,
  params?: Record<string, string>,
): string {
  const [service] = target.split(':');
  const baseUrl = `https://${service}.${config.domain}`;
  let path = DEEP_LINK_PATHS[target] || '';
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      path = path.replace(`\${${key}}`, encodeURIComponent(value));
    });
  }
  return baseUrl + path;
}
