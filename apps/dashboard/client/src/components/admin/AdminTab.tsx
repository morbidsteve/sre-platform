import React, { useState, useEffect, useCallback } from 'react';
import { Tabs } from '../ui/Tabs';
import { EmptyState } from '../ui/EmptyState';
import { UsersPanel } from './UsersPanel';
import { GroupsList } from './GroupsList';
import { CredentialsPanel } from './CredentialsPanel';
import { CreateUserForm } from './CreateUserForm';
import { TenantsPanel } from './TenantsPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { SetupWizard } from './SetupWizard';
import { useUser } from '../../hooks/useUser';
import { fetchUsers, fetchGroups, createGroup, fetchSetupStatus } from '../../api/admin';
import type { AdminUser, AdminGroup } from '../../types/api';

const ADMIN_TABS = [
  { id: 'users', label: 'Users' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'credentials', label: 'Credentials' },
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

  if (!isAdmin) {
    return (
      <EmptyState
        title="Access Denied"
        description="You need admin privileges to access this section."
      />
    );
  }

  const handleShowCreateGroup = () => {
    const name = prompt('Enter new group name:');
    if (!name) return;
    createGroup(name.trim())
      .then(() => loadData())
      .catch((err) => alert('Failed: ' + (err instanceof Error ? err.message : String(err))));
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

      {subTab === 'credentials' && <CredentialsPanel />}
    </div>
  );
}
