import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
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
import { fetchUsers, fetchGroups, createGroup, fetchSetupStatus } from '../../api/admin';
import type { AdminUser, AdminGroup } from '../../types/api';

const ADMIN_TABS = [
  { id: 'users', label: 'Users' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'rbac', label: 'RBAC Audit' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'sso', label: 'SSO Config' },
];

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
    </div>
  );
}
