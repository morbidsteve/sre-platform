import { apiFetch } from './client';

export interface RbacAuditSubject { kind: string; name: string; namespace?: string; }
export interface ClusterAdminBinding { name: string; subjects: RbacAuditSubject[]; }
export interface WildcardRole { name: string; rules: number; }
export interface ServiceAccountBinding { binding: string; role: string; serviceAccounts: string[]; }
export interface TenantRbac { namespace: string; bindings: { name: string; role: string; subjects: string[] }[]; }

export interface RbacAuditResponse {
  timestamp: string;
  clusterAdminBindings: ClusterAdminBinding[];
  wildcardRoles: WildcardRole[];
  serviceAccountBindings: ServiceAccountBinding[];
  tenantRbac: TenantRbac[];
  summary: { clusterAdminCount: number; wildcardRoleCount: number; serviceAccountBindingCount: number; tenantCount: number; issues: number };
}

export function fetchRbacAudit(): Promise<RbacAuditResponse> {
  return apiFetch<RbacAuditResponse>('/api/admin/rbac-audit');
}
