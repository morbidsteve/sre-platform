import React, { useState, useCallback } from 'react';
import { RefreshCw, Shield, AlertTriangle, ChevronDown, ChevronUp, Download, Users, Key, Lock } from 'lucide-react';
import { fetchRbacAudit, type RbacAuditResponse } from '../../api/rbacAudit';

export function RbacAuditPanel() {
  const [data, setData] = useState<RbacAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRbacAudit();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run RBAC audit');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rbac-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Shield className="w-4 h-4" />
          RBAC Audit
        </h3>
        <div className="flex items-center gap-2">
          {data && (
            <button
              className="btn text-sm inline-flex items-center gap-2"
              onClick={downloadJson}
            >
              <Download className="w-4 h-4" />
              Download JSON
            </button>
          )}
          <button
            className="btn btn-primary text-sm inline-flex items-center gap-2"
            onClick={runAudit}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Scanning...' : data ? 'Re-run Audit' : 'Run RBAC Audit'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-4 h-4 text-text-dim" />
                <span className="text-xs font-mono uppercase tracking-wider text-text-dim">Cluster Admin</span>
              </div>
              <div className="text-2xl font-bold font-mono text-text-primary">{data.summary.clusterAdminCount}</div>
              <div className="text-[11px] text-text-dim">bindings</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Key className="w-4 h-4 text-text-dim" />
                <span className="text-xs font-mono uppercase tracking-wider text-text-dim">Wildcard Roles</span>
              </div>
              <div className="text-2xl font-bold font-mono text-text-primary">{data.summary.wildcardRoleCount}</div>
              <div className="text-[11px] text-text-dim">non-system roles</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-text-dim" />
                <span className="text-xs font-mono uppercase tracking-wider text-text-dim">SA Bindings</span>
              </div>
              <div className="text-2xl font-bold font-mono text-text-primary">{data.summary.serviceAccountBindingCount}</div>
              <div className="text-[11px] text-text-dim">service accounts</div>
            </div>
            <div className={`bg-card border rounded-lg p-4 ${data.summary.issues > 0 ? 'border-red-500/40' : 'border-border'}`}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className={`w-4 h-4 ${data.summary.issues > 0 ? 'text-red-400' : 'text-green-400'}`} />
                <span className="text-xs font-mono uppercase tracking-wider text-text-dim">Issues</span>
              </div>
              <div className={`text-2xl font-bold font-mono ${data.summary.issues > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {data.summary.issues}
              </div>
              <div className="text-[11px] text-text-dim">{data.summary.issues > 0 ? 'requires review' : 'no issues found'}</div>
            </div>
          </div>

          {/* Timestamp */}
          <div className="text-xs text-text-dim">
            Scanned: {new Date(data.timestamp).toLocaleString()}
          </div>

          {/* Cluster Admin Bindings */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors text-left"
              onClick={() => toggleSection('clusterAdmin')}
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-text-dim" />
                <span className="text-sm font-semibold text-text-primary">Cluster Admin Bindings</span>
                <span className="text-xs text-text-dim">({data.clusterAdminBindings.length})</span>
              </div>
              {expandedSection === 'clusterAdmin' ? <ChevronUp className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
            </button>
            {expandedSection === 'clusterAdmin' && (
              <div className="border-t border-border">
                {data.clusterAdminBindings.length === 0 ? (
                  <p className="p-4 text-sm text-text-dim">No cluster-admin bindings found.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 px-4 text-text-dim font-medium">Binding Name</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Subjects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.clusterAdminBindings.map((b) => (
                        <tr key={b.name} className="border-b border-border/50 hover:bg-surface/50">
                          <td className="py-2 px-4 font-mono text-text-primary">{b.name}</td>
                          <td className="py-2 px-4">
                            {b.subjects.map((s, i) => (
                              <span key={i} className="inline-block mr-2 mb-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface text-text-secondary">
                                {s.kind}: {s.namespace ? `${s.namespace}/` : ''}{s.name}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Wildcard Roles */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors text-left"
              onClick={() => toggleSection('wildcardRoles')}
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-text-dim" />
                <span className="text-sm font-semibold text-text-primary">Wildcard ClusterRoles</span>
                <span className="text-xs text-text-dim">({data.wildcardRoles.length})</span>
              </div>
              {expandedSection === 'wildcardRoles' ? <ChevronUp className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
            </button>
            {expandedSection === 'wildcardRoles' && (
              <div className="border-t border-border">
                {data.wildcardRoles.length === 0 ? (
                  <p className="p-4 text-sm text-text-dim">No wildcard ClusterRoles found (excluding system: roles).</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 px-4 text-text-dim font-medium">Role Name</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Rule Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.wildcardRoles.map((r) => (
                        <tr key={r.name} className="border-b border-border/50 hover:bg-surface/50">
                          <td className="py-2 px-4 font-mono text-text-primary">{r.name}</td>
                          <td className="py-2 px-4 text-text-secondary">{r.rules} rules</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Service Account Bindings */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors text-left"
              onClick={() => toggleSection('saBindings')}
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-text-dim" />
                <span className="text-sm font-semibold text-text-primary">Service Account Bindings</span>
                <span className="text-xs text-text-dim">({data.serviceAccountBindings.length})</span>
              </div>
              {expandedSection === 'saBindings' ? <ChevronUp className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
            </button>
            {expandedSection === 'saBindings' && (
              <div className="border-t border-border">
                {data.serviceAccountBindings.length === 0 ? (
                  <p className="p-4 text-sm text-text-dim">No service account bindings found.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 px-4 text-text-dim font-medium">Binding</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Role</th>
                        <th className="py-2 px-4 text-text-dim font-medium">Service Accounts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.serviceAccountBindings.map((b) => (
                        <tr key={b.binding} className="border-b border-border/50 hover:bg-surface/50">
                          <td className="py-2 px-4 font-mono text-text-primary">{b.binding}</td>
                          <td className="py-2 px-4 font-mono text-text-secondary">{b.role}</td>
                          <td className="py-2 px-4">
                            {b.serviceAccounts.map((sa, i) => (
                              <span key={i} className="inline-block mr-2 mb-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface text-text-secondary">
                                {sa}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Tenant RBAC */}
          {data.tenantRbac.length > 0 && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors text-left"
                onClick={() => toggleSection('tenantRbac')}
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-text-dim" />
                  <span className="text-sm font-semibold text-text-primary">Tenant Namespace RBAC</span>
                  <span className="text-xs text-text-dim">({data.tenantRbac.length} namespaces)</span>
                </div>
                {expandedSection === 'tenantRbac' ? <ChevronUp className="w-4 h-4 text-text-dim" /> : <ChevronDown className="w-4 h-4 text-text-dim" />}
              </button>
              {expandedSection === 'tenantRbac' && (
                <div className="border-t border-border divide-y divide-border/50">
                  {data.tenantRbac.map((t) => (
                    <div key={t.namespace} className="p-4">
                      <h4 className="text-xs font-mono font-semibold text-accent mb-2">{t.namespace}</h4>
                      {t.bindings.length === 0 ? (
                        <span className="text-xs text-text-dim">No role bindings</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {t.bindings.map((b) => (
                            <div key={b.name} className="text-[10px] bg-surface rounded px-2 py-1">
                              <span className="font-mono text-text-primary">{b.name}</span>
                              <span className="text-text-dim mx-1">-&gt;</span>
                              <span className="font-mono text-accent">{b.role}</span>
                              {b.subjects.length > 0 && (
                                <span className="text-text-dim ml-1">({b.subjects.join(', ')})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
