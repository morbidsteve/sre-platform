import React, { useState, useEffect, useCallback } from 'react';
import { X, Bell, CheckCircle2, XCircle } from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { EmptyState } from '../ui/EmptyState';
import { UsersPanel } from './UsersPanel';
import { GroupsList } from './GroupsList';
import { CredentialsPanel } from './CredentialsPanel';
import { CreateUserForm } from './CreateUserForm';
import { TenantsPanel } from './TenantsPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { SecretRotationPanel } from './SecretRotationPanel';
import { SsoConfigPanel } from './SsoConfigPanel';
import { RbacAuditPanel } from './RbacAuditPanel';
import { SetupWizard } from './SetupWizard';
import { useUser } from '../../hooks/useUser';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { fetchUsers, fetchGroups, createGroup, fetchSetupStatus } from '../../api/admin';
import type { AdminUser, AdminGroup } from '../../types/api';

interface NotificationReceiver {
  name: string;
  type: 'slack' | 'email' | 'pagerduty' | 'webhook';
  configured: boolean;
  endpoint?: string;
}

interface NotificationStatus {
  receivers: NotificationReceiver[];
  lastChecked: string;
}

function NotificationsPanel({ active }: { active: boolean }) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ops/notifications/status', { credentials: 'include' });
      if (!resp.ok) throw new Error(`Failed to load notification status (${resp.status})`);
      const data: NotificationStatus = await resp.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification status');
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const typeIcon: Record<string, string> = {
    slack: '#',
    email: '@',
    pagerduty: '!',
    webhook: '~',
  };

  const typeLabel: Record<string, string> = {
    slack: 'Slack',
    email: 'Email',
    pagerduty: 'PagerDuty',
    webhook: 'Webhook',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Notification Receivers
        </h3>
        <button
          className="btn text-sm inline-flex items-center gap-2"
          onClick={loadStatus}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && !status && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-text-dim">Loading notification configuration...</p>
        </div>
      )}

      {status && (
        <>
          <p className="text-xs text-text-dim">
            AlertManager notification receivers configured for this platform.
            Last checked: {new Date(status.lastChecked).toLocaleString()}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {status.receivers.map((receiver) => (
              <div
                key={receiver.name}
                className={`border rounded-lg p-4 ${
                  receiver.configured
                    ? 'bg-green-500/10 border-green-500/20'
                    : 'bg-surface border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-accent/10 text-accent flex items-center justify-center text-xs font-bold font-mono">
                      {typeIcon[receiver.type] || '?'}
                    </span>
                    <span className="text-sm font-medium text-text-bright">{receiver.name}</span>
                  </div>
                  {receiver.configured ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-text-dim flex-shrink-0" />
                  )}
                </div>
                <div className="text-xs text-text-dim space-y-1">
                  <div>Type: <span className="text-text-primary">{typeLabel[receiver.type] || receiver.type}</span></div>
                  <div>
                    Status:{' '}
                    <span className={receiver.configured ? 'text-green-400' : 'text-text-dim'}>
                      {receiver.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                  {receiver.endpoint && (
                    <div className="truncate">Endpoint: <span className="font-mono text-text-primary">{receiver.endpoint}</span></div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {status.receivers.length === 0 && (
            <div className="bg-surface border border-border rounded-lg p-8 text-center">
              <p className="text-sm text-text-dim">No notification receivers configured.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ADMIN_TABS = [
  { id: 'users', label: 'Users' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'rbac', label: 'RBAC Audit' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'sso', label: 'SSO Config' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'links', label: 'Quick Links' },
];

function QuickLinksPanel() {
  const config = useConfig();

  const services = [
    { name: 'Keycloak', description: 'Identity & SSO management', icon: '\u{1F510}', url: serviceUrl(config, 'keycloak'), badge: 'Auth' },
    { name: 'Harbor', description: 'Container registry & scanning', icon: '\u{1F6A2}', url: serviceUrl(config, 'harbor'), badge: 'Registry' },
    { name: 'Grafana', description: 'Metrics dashboards & logs', icon: '\u{1F4CA}', url: serviceUrl(config, 'grafana'), badge: 'Monitoring' },
    { name: 'Prometheus', description: 'Metrics & alerting', icon: '\u{1F525}', url: serviceUrl(config, 'prometheus'), badge: 'Monitoring' },
    { name: 'AlertManager', description: 'Alert routing & silencing', icon: '\u{1F514}', url: serviceUrl(config, 'alertmanager'), badge: 'Alerting' },
    { name: 'NeuVector', description: 'Runtime security & network', icon: '\u{1F6E1}\uFE0F', url: serviceUrl(config, 'neuvector'), badge: 'Security' },
    { name: 'OpenBao', description: 'Secrets management', icon: '\u{1F511}', url: serviceUrl(config, 'openbao'), badge: 'Secrets' },
    { name: 'Loki (via Grafana)', description: 'Log explorer', icon: '\u{1F4DD}', url: `${serviceUrl(config, 'grafana')}/explore`, badge: 'Logging' },
  ];

  return (
    <div>
      <p className="text-xs text-text-dim mb-4">Quick access to all platform management interfaces. Each opens in a new tab.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {services.map((svc) => (
          <a
            key={svc.name}
            href={svc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-surface border border-border rounded-lg p-4 hover:border-accent transition-colors no-underline group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{svc.icon}</span>
              <h4 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">{svc.name}</h4>
            </div>
            <p className="text-xs text-text-dim mb-2">{svc.description}</p>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">{svc.badge}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

interface AdminTabProps {
  active: boolean;
}

export function AdminTab({ active }: AdminTabProps) {
  const { isAdmin } = useUser();
  const [subTab, setSubTab] = useState('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  const loadData = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [usersData, groupsData] = await Promise.all([
        fetchUsers(),
        fetchGroups(),
      ]);
      setUsers(usersData);
      setGroups(groupsData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check setup wizard status on first load
  useEffect(() => {
    if (!active || !isAdmin || setupChecked) return;
    setSetupChecked(true);
    fetchSetupStatus()
      .then((status) => {
        if (!status.completed) {
          setShowSetupWizard(true);
        }
      })
      .catch(() => {
        // skip if API unavailable
      });
  }, [active, isAdmin, setupChecked]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [createGroupError, setCreateGroupError] = useState('');
  const [createGroupLoading, setCreateGroupLoading] = useState(false);

  if (!isAdmin) {
    return (
      <EmptyState
        title="Access Denied"
        description="You need admin privileges to access this section."
      />
    );
  }

  const handleShowCreateGroup = () => {
    setNewGroupName('');
    setCreateGroupError('');
    setShowCreateGroupModal(true);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) { setCreateGroupError('Group name is required'); return; }
    setCreateGroupLoading(true);
    setCreateGroupError('');
    try {
      await createGroup(name);
      setShowCreateGroupModal(false);
      loadData();
    } catch (err) {
      setCreateGroupError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateGroupLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-base font-semibold text-text-primary mb-4">Administration</h2>

      {/* Setup Wizard */}
      {showSetupWizard && (
        <SetupWizard
          onComplete={() => setShowSetupWizard(false)}
          onDismiss={() => setShowSetupWizard(false)}
        />
      )}

      <Tabs tabs={ADMIN_TABS} active={subTab} onChange={setSubTab} />

      {subTab === 'users' && (
        <>
          {showCreateUserModal ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              onClick={(e) => { if (e.target === e.currentTarget) setShowCreateUserModal(false); }}
            >
              <div className="bg-card border border-border rounded-xl max-w-[500px] w-[90%] max-h-[80vh] overflow-y-auto">
                <CreateUserForm
                  groups={groups}
                  onCreated={() => { setShowCreateUserModal(false); loadData(); }}
                  onCancel={() => setShowCreateUserModal(false)}
                />
              </div>
            </div>
          ) : null}

          {/* Create Group Modal */}
          {showCreateGroupModal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
              onClick={(e) => { if (e.target === e.currentTarget) setShowCreateGroupModal(false); }}
            >
              <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">Create Group</h3>
                  <button className="text-text-dim hover:text-text-primary" onClick={() => setShowCreateGroupModal(false)}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-text-secondary block mb-1">Group Name</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text-primary text-sm focus:outline-none focus:border-accent"
                      placeholder="e.g., developers, sre-viewers"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); }}
                      autoFocus
                    />
                  </div>
                  {createGroupError && (
                    <p className="text-xs text-red-400">{createGroupError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button className="btn text-sm" onClick={() => setShowCreateGroupModal(false)}>Cancel</button>
                    <button
                      className="btn btn-primary text-sm"
                      onClick={handleCreateGroup}
                      disabled={createGroupLoading || !newGroupName.trim()}
                    >
                      {createGroupLoading ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <UsersPanel
            users={users}
            groups={groups}
            loading={loading}
            onRefresh={loadData}
            onShowCreateUser={() => setShowCreateUserModal(true)}
            onShowCreateGroup={handleShowCreateGroup}
          />

          {/* Groups section */}
          <div className="mt-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-3">Groups</h3>
            <GroupsList groups={groups} users={users} onRefresh={loadData} />
          </div>
        </>
      )}

      {subTab === 'tenants' && <TenantsPanel active={active} />}

      {subTab === 'audit' && <AuditLogPanel active={active} />}

      {subTab === 'rbac' && <RbacAuditPanel />}

      {subTab === 'credentials' && <CredentialsPanel />}

      {subTab === 'secrets' && <SecretRotationPanel />}

      {subTab === 'sso' && <SsoConfigPanel />}

      {subTab === 'notifications' && <NotificationsPanel active={active} />}

      {subTab === 'links' && <QuickLinksPanel />}
    </div>
  );
}
