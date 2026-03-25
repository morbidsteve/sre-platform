import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { fetchSetupStatus, completeSetup, createTenant, createUser } from '../../api/admin';
import type { SetupStatus, CreateUserRequest } from '../../types/api';

interface SetupWizardProps {
  onComplete: () => void;
  onDismiss: () => void;
}

export function SetupWizard({ onComplete, onDismiss }: SetupWizardProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);

  // Step 3: Create tenant
  const [tenantName, setTenantName] = useState('');
  const [tenantTier, setTenantTier] = useState('medium');
  const [tenantCreating, setTenantCreating] = useState(false);
  const [tenantResult, setTenantResult] = useState('');

  // Step 4: Create user
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [userCreating, setUserCreating] = useState(false);
  const [userResult, setUserResult] = useState('');

  // Step 5: Completing
  const [completing, setCompleting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchSetupStatus();
      setStatus(s);
    } catch {
      // skip
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleCreateTenant = async () => {
    if (!tenantName.trim()) return;
    setTenantCreating(true);
    setTenantResult('');
    try {
      const result = await createTenant(tenantName.trim(), tenantTier);
      setTenantResult(`Tenant ${result.name} created successfully.`);
      setTenantName('');
      await loadStatus();
    } catch (err) {
      setTenantResult('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setTenantCreating(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword) return;
    setUserCreating(true);
    setUserResult('');
    try {
      const data: CreateUserRequest = {
        username: newUsername.trim(),
        password: newPassword,
        email: newEmail || undefined,
        groups: ['developers'],
        enabled: true,
      };
      await createUser(data);
      setUserResult(`User ${newUsername} created and added to developers group.`);
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');
      await loadStatus();
    } catch (err) {
      setUserResult('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUserCreating(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeSetup();
      onComplete();
    } catch {
      // ignore
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="card-base p-6 mb-6">
        <div className="flex justify-center py-8"><Spinner size="lg" /></div>
      </div>
    );
  }

  if (!status) return null;

  const checks = status.checks;
  const allGood = !checks.hasDefaultPasswords && checks.hasCustomTenants && checks.hasUsers;

  return (
    <div className="card-base p-6 mb-6 border-2" style={{ borderColor: 'var(--accent)' }}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-bright">Platform Setup Wizard</h3>
          <p className="text-sm text-text-dim mt-1">
            Complete these steps to configure your SRE platform for production use.
          </p>
        </div>
        <Button size="sm" onClick={onDismiss}>Dismiss</Button>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center border transition-colors cursor-pointer ${
              step === s
                ? 'bg-accent text-white border-accent'
                : step > s
                  ? 'bg-surface border-accent text-accent'
                  : 'bg-surface border-border text-text-dim'
            }`}
            onClick={() => setStep(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Step 1: Default Passwords */}
      {step === 1 && (
        <div>
          <h4 className="text-sm font-semibold text-text-bright mb-3">Step 1: Check Default Passwords</h4>
          {checks.hasDefaultPasswords ? (
            <div>
              <p className="text-sm text-text-dim mb-3">
                The following services still use default passwords. Change them before going to production.
              </p>
              <div className="space-y-2">
                {checks.defaultPasswordsRemaining.map((svc) => (
                  <div key={svc} className="flex items-center gap-2">
                    <Badge variant="yellow">Default</Badge>
                    <span className="text-sm text-text-primary">{svc}</span>
                    <span className="text-xs text-text-dim">
                      {svc === 'Harbor' && '(current: Harbor12345)'}
                      {svc === 'Grafana' && '(current: prom-operator)'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-dim mt-3">
                Change passwords in each service's admin UI, then update environment variables.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="green">Done</Badge>
              <span className="text-sm text-text-primary">No default passwords detected.</span>
            </div>
          )}
          <div className="mt-4">
            <Button variant="primary" onClick={() => setStep(2)}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 2: Notifications */}
      {step === 2 && (
        <div>
          <h4 className="text-sm font-semibold text-text-bright mb-3">Step 2: Configure Notifications</h4>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant={checks.slackConfigured ? 'green' : 'yellow'}>
              {checks.slackConfigured ? 'Configured' : 'Not Configured'}
            </Badge>
            <span className="text-sm text-text-primary">Slack Webhook</span>
          </div>
          {!checks.slackConfigured ? (
            <div>
              <p className="text-sm text-text-dim mb-2">
                Set the <code className="text-xs bg-surface px-1 py-0.5 rounded">ISSM_SLACK_WEBHOOK</code> environment
                variable to enable pipeline review notifications.
              </p>
              <p className="text-xs text-text-dim">
                You can also run <code className="bg-surface px-1 py-0.5 rounded">scripts/setup-notifications.sh</code> to configure all channels at once.
              </p>
            </div>
          ) : (
            <p className="text-sm text-text-dim">Slack notifications are active. ISSM will be notified of pipeline reviews.</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(3)}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 3: Create First Tenant */}
      {step === 3 && (
        <div>
          <h4 className="text-sm font-semibold text-text-bright mb-3">Step 3: Create First Tenant</h4>
          {checks.hasCustomTenants ? (
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="green">Done</Badge>
              <span className="text-sm text-text-primary">{checks.tenantCount} tenant(s) exist.</span>
            </div>
          ) : (
            <p className="text-sm text-text-dim mb-3">
              Create a tenant namespace for your first team. This sets up namespace, RBAC, quotas, and network policies.
            </p>
          )}
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-text-dim block mb-1">Team Name</label>
              <input
                type="text"
                className="form-input !mb-0 w-full"
                placeholder="e.g., engineering"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
              />
            </div>
            <div className="min-w-[140px]">
              <label className="text-xs text-text-dim block mb-1">Tier</label>
              <select className="form-input !mb-0 w-full" value={tenantTier} onChange={(e) => setTenantTier(e.target.value)}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
            <Button variant="primary" onClick={handleCreateTenant} disabled={tenantCreating || !tenantName.trim()}>
              {tenantCreating ? 'Creating...' : 'Create Tenant'}
            </Button>
          </div>
          {tenantResult && (
            <div className={`mt-2 text-sm ${tenantResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {tenantResult}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(4)}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 4: Create First User */}
      {step === 4 && (
        <div>
          <h4 className="text-sm font-semibold text-text-bright mb-3">Step 4: Create First User</h4>
          {checks.hasUsers ? (
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="green">Done</Badge>
              <span className="text-sm text-text-primary">{checks.userCount} user(s) exist.</span>
            </div>
          ) : (
            <p className="text-sm text-text-dim mb-3">
              Create a developer user who can deploy applications through the DSOP pipeline.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-text-dim block mb-1">Username</label>
              <input type="text" className="form-input !mb-0 w-full" placeholder="developer1" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-dim block mb-1">Password</label>
              <input type="password" className="form-input !mb-0 w-full" placeholder="Secure password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-dim block mb-1">Email (optional)</label>
              <input type="email" className="form-input !mb-0 w-full" placeholder="user@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
          </div>
          <div className="mt-3">
            <Button variant="primary" onClick={handleCreateUser} disabled={userCreating || !newUsername.trim() || !newPassword}>
              {userCreating ? 'Creating...' : 'Create User'}
            </Button>
          </div>
          {userResult && (
            <div className={`mt-2 text-sm ${userResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {userResult}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setStep(3)}>Back</Button>
            <Button variant="primary" onClick={() => setStep(5)}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 5: Verification */}
      {step === 5 && (
        <div>
          <h4 className="text-sm font-semibold text-text-bright mb-3">Step 5: Verification</h4>
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <Badge variant={!checks.hasDefaultPasswords ? 'green' : 'yellow'}>
                {!checks.hasDefaultPasswords ? 'Pass' : 'Warning'}
              </Badge>
              <span className="text-sm text-text-primary">Default passwords changed</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={checks.slackConfigured ? 'green' : 'yellow'}>
                {checks.slackConfigured ? 'Pass' : 'Skipped'}
              </Badge>
              <span className="text-sm text-text-primary">Notifications configured</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={checks.hasCustomTenants ? 'green' : 'yellow'}>
                {checks.hasCustomTenants ? 'Pass' : 'Skipped'}
              </Badge>
              <span className="text-sm text-text-primary">Tenant created ({checks.tenantCount} total)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={checks.hasUsers ? 'green' : 'yellow'}>
                {checks.hasUsers ? 'Pass' : 'Skipped'}
              </Badge>
              <span className="text-sm text-text-primary">Users created ({checks.userCount} total)</span>
            </div>
          </div>

          {allGood ? (
            <p className="text-sm" style={{ color: 'var(--green)' }}>All checks passed. Your platform is ready for use.</p>
          ) : (
            <p className="text-sm text-text-dim">Some items were skipped. You can complete them later from the Admin tab.</p>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={() => setStep(4)}>Back</Button>
            <Button variant="primary" onClick={handleComplete} disabled={completing}>
              {completing ? 'Completing...' : 'Complete Setup'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
