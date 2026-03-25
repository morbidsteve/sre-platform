export interface TabDef {
  id: string;
  label: string;
  icon: string;
  adminOnly: boolean;
}

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard', adminOnly: false },
  { id: 'deploy', label: 'Deploy', icon: 'Rocket', adminOnly: false },
  { id: 'applications', label: 'Applications', icon: 'AppWindow', adminOnly: false },
  { id: 'security', label: 'Security', icon: 'Shield', adminOnly: false },
  { id: 'operations', label: 'Operations', icon: 'Activity', adminOnly: false },
  { id: 'compliance', label: 'Compliance', icon: 'ClipboardCheck', adminOnly: false },
  { id: 'admin', label: 'Admin', icon: 'Settings', adminOnly: true },
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
}

export const PLATFORM_SERVICES: PlatformServiceDef[] = [
  { name: 'grafana', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-grafana', icon: 'chart', description: 'Dashboards & observability' },
  { name: 'prometheus', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-prometheus', icon: 'search', description: 'Metrics collection & alerting rules' },
  { name: 'alertmanager', namespace: 'monitoring', serviceName: 'kube-prometheus-stack-alertmanager', icon: 'bell', description: 'Alert routing & notifications' },
  { name: 'harbor', namespace: 'harbor', serviceName: 'harbor-core', icon: 'container', description: 'Container image registry' },
  { name: 'keycloak', namespace: 'keycloak', serviceName: 'keycloak', icon: 'key', description: 'Identity & access management' },
  { name: 'neuvector', namespace: 'neuvector', serviceName: 'neuvector-service-webui', icon: 'shield', description: 'Container security platform' },
  { name: 'openbao', namespace: 'openbao', serviceName: 'openbao', icon: 'lock', description: 'Secrets management' },
  { name: 'dashboard', namespace: 'sre-dashboard', serviceName: 'sre-dashboard', icon: 'layout', description: 'This SRE Platform Dashboard' },
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
  { id: 'nav-overview', label: 'Go to Overview', action: 'navigate:overview', keywords: 'home dashboard landing' },
  { id: 'nav-deploy', label: 'Go to Deploy', action: 'navigate:deploy', keywords: 'deploy new app launch create' },
  { id: 'nav-apps', label: 'Go to Applications', action: 'navigate:applications', keywords: 'apps running deployed' },
  { id: 'nav-security', label: 'Go to Security', action: 'navigate:security', keywords: 'soc issm review pipeline dsop' },
  { id: 'nav-operations', label: 'Go to Operations', action: 'navigate:operations', keywords: 'noc platform cluster nodes pods services' },
  { id: 'nav-compliance', label: 'Go to Compliance', action: 'navigate:compliance', keywords: 'ato audit nist controls' },
  { id: 'nav-admin', label: 'Go to Admin', action: 'navigate:admin', keywords: 'users groups credentials', adminOnly: true },
  { id: 'deploy-app', label: 'Deploy New Application', action: 'navigate:deploy', keywords: 'create launch new' },
  { id: 'open-grafana', label: 'Open Grafana', action: 'open:grafana', keywords: 'monitoring dashboards' },
  { id: 'open-harbor', label: 'Open Harbor Registry', action: 'open:harbor', keywords: 'images container' },
  { id: 'open-keycloak', label: 'Open Keycloak', action: 'open:keycloak', keywords: 'sso identity' },
  { id: 'open-neuvector', label: 'Open NeuVector', action: 'open:neuvector', keywords: 'security runtime' },
  { id: 'toggle-theme', label: 'Toggle Dark/Light Theme', action: 'theme', keywords: 'dark light mode' },
];
