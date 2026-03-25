import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { fetchTenants, fetchTenantOverview, createTenant, updateTenantQuota, deleteTenant } from '../../api/admin';
import type { Tenant, TenantOverview } from '../../types/api';

interface TenantsPanelProps {
  active: boolean;
}

export function TenantsPanel({ active }: TenantsPanelProps) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [overview, setOverview] = useState<TenantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTier, setCreateTier] = useState('medium');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [quotaEdit, setQuotaEdit] = useState<string | null>(null);
  const [quotaTier, setQuotaTier] = useState('medium');

  const loadData = useCallback(async () => {
    if (!active) return;
    try {
      const [tenantsData, overviewData] = await Promise.all([
        fetchTenants(),
        fetchTenantOverview(),
      ]);
      setTenants(tenantsData);
      setOverview(overviewData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      await createTenant(createName.trim(), createTier);
      setShowCreate(false);
      setCreateName('');
      setCreateTier('medium');
      await loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (deleteInput !== name) return;
    try {
      await deleteTenant(name);
      setDeleteConfirm(null);
      setDeleteInput('');
      await loadData();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleQuotaUpdate = async (name: string) => {
    try {
      await updateTenantQuota(name, quotaTier);
      setQuotaEdit(null);
      await loadData();
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const healthVariant = (h: string): 'green' | 'yellow' | 'red' | 'dim' => {
    if (h === 'healthy') return 'green';
    if (h === 'degraded') return 'yellow';
    if (h === 'unhealthy') return 'red';
    return 'dim';
  };

  if (loading && tenants.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="card-base p-3 text-center">
            <div className="text-2xl font-bold text-text-bright">{overview.totalTenants}</div>
            <div className="text-xs text-text-dim mt-1">Total Tenants</div>
          </div>
          <div className="card-base p-3 text-center">
            <div className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{overview.healthyTenants}</div>
            <div className="text-xs text-text-dim mt-1">Healthy</div>
          </div>
          <div className="card-base p-3 text-center">
            <div className="text-2xl font-bold" style={{ color: overview.degradedTenants > 0 ? 'var(--yellow)' : 'var(--text-dim)' }}>
              {overview.degradedTenants}
            </div>
            <div className="text-xs text-text-dim mt-1">Degraded</div>
          </div>
          <div className="card-base p-3 text-center">
            <div className="text-2xl font-bold text-text-bright">{overview.totalPods}</div>
            <div className="text-xs text-text-dim mt-1">Total Pods</div>
          </div>
          <div className="card-base p-3 text-center">
            <div className="text-2xl font-bold text-text-bright">{overview.totalApps}</div>
            <div className="text-xs text-text-dim mt-1">Total Apps</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[15px] font-semibold text-text-primary">Tenant Namespaces</h3>
        <Button variant="primary" onClick={() => setShowCreate(true)}>Create Tenant</Button>
      </div>

      {/* Create Tenant Form */}
      {showCreate && (
        <div className="card-base p-4 mb-4">
          <h4 className="text-sm font-semibold text-text-bright mb-3">New Tenant</h4>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-text-dim block mb-1">Tenant Name</label>
              <input
                type="text"
                className="form-input !mb-0 w-full"
                placeholder="my-team (will be prefixed with team-)"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="min-w-[140px]">
              <label className="text-xs text-text-dim block mb-1">Resource Tier</label>
              <select
                className="form-input !mb-0 w-full"
                value={createTier}
                onChange={(e) => setCreateTier(e.target.value)}
              >
                <option value="small">Small (2 CPU / 4Gi)</option>
                <option value="medium">Medium (4 CPU / 8Gi)</option>
                <option value="large">Large (8 CPU / 16Gi)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
              <Button onClick={() => { setShowCreate(false); setCreateError(''); }}>Cancel</Button>
            </div>
          </div>
          {createError && (
            <div className="mt-2 text-sm" style={{ color: 'var(--red)' }}>{createError}</div>
          )}
        </div>
      )}

      {/* Tenants Table */}
      {tenants.length === 0 ? (
        <EmptyState title="No tenants found" description="Create your first tenant to get started." />
      ) : (
        <div className="card-base overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Health</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Namespace</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Pods</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Apps</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">CPU Used</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Memory Used</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Quota</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Created</th>
                <th className="py-2 px-3 text-text-dim font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <React.Fragment key={t.name}>
                  <tr className="border-b border-border hover:bg-surface/50 transition-colors">
                    <td className="py-2 px-3">
                      <Badge variant={healthVariant(t.health)}>{t.health}</Badge>
                    </td>
                    <td className="py-2 px-3 font-medium text-text-primary">{t.name}</td>
                    <td className="py-2 px-3 text-text-dim">{t.runningPods}/{t.podCount}</td>
                    <td className="py-2 px-3 text-text-dim">{t.appCount}</td>
                    <td className="py-2 px-3 text-text-dim">{t.cpu.used}</td>
                    <td className="py-2 px-3 text-text-dim">{t.memory.used}</td>
                    <td className="py-2 px-3 text-text-dim text-xs">
                      {t.quota ? (
                        <span>
                          {t.quota.used?.pods || '0'}/{t.quota.hard?.pods || '?'} pods,{' '}
                          {t.quota.used?.['requests.cpu'] || '0'}/{t.quota.hard?.['requests.cpu'] || '?'} CPU
                        </span>
                      ) : (
                        <span className="text-text-dim">No quota</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs text-text-dim">
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => { setQuotaEdit(t.name); setQuotaTier('medium'); }}>
                          Quota
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => { setDeleteConfirm(t.name); setDeleteInput(''); }}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {/* Quota edit row */}
                  {quotaEdit === t.name && (
                    <tr className="border-b border-border bg-surface/30">
                      <td colSpan={9} className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-text-dim">Update quota for {t.name}:</span>
                          <select
                            className="form-input !mb-0 min-w-[160px]"
                            value={quotaTier}
                            onChange={(e) => setQuotaTier(e.target.value)}
                          >
                            <option value="small">Small (2 CPU / 4Gi)</option>
                            <option value="medium">Medium (4 CPU / 8Gi)</option>
                            <option value="large">Large (8 CPU / 16Gi)</option>
                          </select>
                          <Button size="sm" variant="primary" onClick={() => handleQuotaUpdate(t.name)}>Apply</Button>
                          <Button size="sm" onClick={() => setQuotaEdit(null)}>Cancel</Button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Delete confirmation row */}
                  {deleteConfirm === t.name && (
                    <tr className="border-b border-border" style={{ background: 'rgba(239,68,68,0.05)' }}>
                      <td colSpan={9} className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs" style={{ color: 'var(--red)' }}>
                            Type "{t.name}" to confirm deletion:
                          </span>
                          <input
                            type="text"
                            className="form-input !mb-0 w-[200px]"
                            placeholder={t.name}
                            value={deleteInput}
                            onChange={(e) => setDeleteInput(e.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={deleteInput !== t.name}
                            onClick={() => handleDelete(t.name)}
                          >
                            Confirm Delete
                          </Button>
                          <Button size="sm" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
