export interface TabDef {
  id: string;
  label: string;
  icon: string;
  adminOnly: boolean;
}

export const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', adminOnly: false },
  { id: 'applications', label: 'Applications', icon: 'grid', adminOnly: false },
  { id: 'platform', label: 'Platform', icon: 'layers', adminOnly: false },
  { id: 'cluster', label: 'Cluster', icon: 'server', adminOnly: false },
  { id: 'pipeline', label: 'Pipeline', icon: 'git-branch', adminOnly: false },
  { id: 'audit', label: 'Audit', icon: 'clipboard', adminOnly: false },
  { id: 'admin', label: 'Admin', icon: 'settings', adminOnly: true },
];

export const SERVICE_ICONS: Record<string, string> = {
  grafana: 'chart',
  prometheus: 'search',
  alertmanager: 'bell',
  harbor: 'container',
  keycloak: 'key',
  neuvector: 'shield',
  openbao: 'lock',
  dashboard: 'layout',
  loki: 'file-text',
  tempo: 'activity',
  istio: 'globe',
  kyverno: 'check-circle',
  velero: 'archive',
};

export interface PlatformServiceDef {
  name: string;
  namespace: string;
  serviceName: string;
  icon: string;
  description: string;
  url: string;
}

export const PLATFORM_SERVICES: PlatformServiceDef[] = [
  { name: 'grafana', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-grafana', icon: 'chart', description: 'Dashboards & observability', url: 'https://grafana.apps.sre.example.com' },
  { name: 'prometheus', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-prometheus', icon: 'search', description: 'Metrics collection & alerting rules', url: 'https://prometheus.apps.sre.example.com' },
  { name: 'alertmanager', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-alertmanager', icon: 'bell', description: 'Alert routing & notifications', url: 'https://alertmanager.apps.sre.example.com' },
  { name: 'harbor', namespace: 'harbor', serviceName: 'harbor-core', icon: 'container', description: 'Container image registry', url: 'https://harbor.apps.sre.example.com' },
  { name: 'keycloak', namespace: 'keycloak', serviceName: 'keycloak', icon: 'key', description: 'Identity & access management', url: 'https://keycloak.apps.sre.example.com' },
  { name: 'neuvector', namespace: 'neuvector', serviceName: 'neuvector-service-webui', icon: 'shield', description: 'Container security platform', url: 'https://neuvector.apps.sre.example.com' },
  { name: 'openbao', namespace: 'openbao', serviceName: 'openbao', icon: 'lock', description: 'Secrets management', url: 'https://openbao.apps.sre.example.com' },
  { name: 'dashboard', namespace: 'sre-dashboard', serviceName: 'sre-dashboard', icon: 'layout', description: 'This SRE Platform Dashboard', url: 'https://dashboard.apps.sre.example.com' },
];

export interface ClusterPanelDef {
  id: string;
  label: string;
}

export const CLUSTER_PANELS: ClusterPanelDef[] = [
  { id: 'nodes', label: 'Nodes' },
  { id: 'pods', label: 'Pods' },
  { id: 'logs', label: 'Logs' },
  { id: 'events', label: 'Events' },
  { id: 'namespaces', label: 'Namespaces' },
  { id: 'resources', label: 'Resources' },
  { id: 'actions', label: 'Quick Actions' },
];

export interface CommandItem {
  id: string;
  label: string;
  action: string;
  keywords: string;
  adminOnly?: boolean;
}

export const COMMAND_ITEMS: CommandItem[] = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', action: 'navigate:dashboard', keywords: 'home overview' },
  { id: 'nav-apps', label: 'Go to Applications', action: 'navigate:applications', keywords: 'apps deploy' },
  { id: 'nav-platform', label: 'Go to Platform Services', action: 'navigate:platform', keywords: 'services status' },
  { id: 'nav-cluster', label: 'Go to Cluster', action: 'navigate:cluster', keywords: 'nodes pods' },
  { id: 'nav-pipeline', label: 'Go to Pipeline', action: 'navigate:pipeline', keywords: 'dsop security' },
  { id: 'nav-audit', label: 'Go to Audit Log', action: 'navigate:audit', keywords: 'events log' },
  { id: 'nav-admin', label: 'Go to Admin', action: 'navigate:admin', keywords: 'users groups credentials', adminOnly: true },
  { id: 'deploy-app', label: 'Deploy New Application', action: 'deploy', keywords: 'create launch new' },
  { id: 'open-grafana', label: 'Open Grafana', action: 'open:https://grafana.apps.sre.example.com', keywords: 'monitoring dashboards' },
  { id: 'open-harbor', label: 'Open Harbor Registry', action: 'open:https://harbor.apps.sre.example.com', keywords: 'images container' },
  { id: 'open-keycloak', label: 'Open Keycloak', action: 'open:https://keycloak.apps.sre.example.com', keywords: 'sso identity' },
  { id: 'open-neuvector', label: 'Open NeuVector', action: 'open:https://neuvector.apps.sre.example.com', keywords: 'security runtime' },
  { id: 'toggle-theme', label: 'Toggle Dark/Light Theme', action: 'theme', keywords: 'dark light mode' },
];
