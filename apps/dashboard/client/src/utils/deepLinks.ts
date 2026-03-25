export type DeepLinkTarget =
  | 'grafana:cluster-overview' | 'grafana:kyverno-violations' | 'grafana:istio-mesh'
  | 'grafana:istio-workload' | 'grafana:cert-manager' | 'grafana:flux-reconciliation'
  | 'grafana:node-exporter' | 'grafana:loki-logs' | 'grafana:loki-audit-logs'
  | 'grafana:tempo-traces' | 'grafana:alertmanager'
  | 'harbor:projects' | 'harbor:scan-results' | 'harbor:project-images'
  | 'neuvector:runtime-security' | 'neuvector:network-activity' | 'neuvector:vulnerabilities'
  | 'keycloak:users' | 'keycloak:groups' | 'keycloak:sessions';

const DEEP_LINK_PATHS: Record<string, string> = {
  'grafana:cluster-overview': '/d/sre-cluster-overview/cluster-summary',
  'grafana:kyverno-violations': '/d/sre-kyverno-compliance/compliance-summary',
  'grafana:istio-mesh': '/d/sre-istio-mesh/mesh-summary',
  'grafana:cert-manager': '/d/sre-cert-manager/certificate-overview',
  'grafana:flux-reconciliation': '/d/sre-flux-gitops/flux-summary',
  'grafana:loki-logs': '/explore?orgId=1&left={"datasource":"Loki"}',
  'grafana:loki-audit-logs': '/explore?orgId=1&left={"datasource":"Loki","queries":[{"expr":"{job=\\"systemd-journal\\"} |= \\"audit\\""}]}',
  'grafana:tempo-traces': '/explore?orgId=1&left={"datasource":"Tempo"}',
  'grafana:alertmanager': '/alerting/list',
  'harbor:projects': '/harbor/projects',
  'harbor:scan-results': '/harbor/projects',
  'neuvector:runtime-security': '/#/security-events',
  'neuvector:vulnerabilities': '/#/vulnerabilities',
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
