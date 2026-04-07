import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { fetchSsoStatus, createSsoClient } from '../../api/sso';
import type { SsoClient } from '../../api/sso';

export function SsoConfigPanel() {
  const [clients, setClients] = useState<SsoClient[]>([]);
  const [keycloakReachable, setKeycloakReachable] = useState(false);
  const [realm, setRealm] = useState('');
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [secretModal, setSecretModal] = useState<{ clientId: string; secret: string; redirectUris: string[] } | null>(null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSsoStatus();
      setClients(data.clients);
      setKeycloakReachable(data.keycloakReachable);
      setRealm(data.realm);
    } catch {
      setKeycloakReachable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConfigure = async (clientId: string) => {
    setConfiguring(clientId);
    setError('');
    try {
      const data = await createSsoClient(clientId);
      setSecretModal({ clientId: data.clientId, secret: data.secret, redirectUris: data.redirectUris });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setConfiguring(null);
    }
  };

  const handleCopySecret = () => {
    if (secretModal) {
      navigator.clipboard.writeText(secretModal.secret).catch(() => {});
    }
  };

  if (loading && clients.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  const configuredCount = clients.filter(c => c.exists).length;
  const totalCount = clients.length;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary">SSO Configuration</h3>
          <p className="text-text-dim text-sm mt-1">
            Keycloak realm: <span className="text-text-secondary">{realm || 'unknown'}</span>
            {' '}&middot;{' '}
            <Badge variant={keycloakReachable ? 'green' : 'red'}>
              {keycloakReachable ? 'Connected' : 'Unreachable'}
            </Badge>
            {' '}&middot;{' '}
            {configuredCount}/{totalCount} clients configured
          </p>
        </div>
        <Button onClick={loadStatus}>Refresh</Button>
      </div>

      {error && (
        <div className="card-base p-3 mb-4 border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* OIDC Clients Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 text-text-dim font-medium">Client ID</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Status</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Enabled</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Redirect URIs</th>
              <th className="py-2 text-text-dim font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.clientId} className="border-b border-border/50">
                <td className="py-3 pr-4 text-text-primary font-medium font-mono text-xs">
                  {c.clientId}
                </td>
                <td className="py-3 pr-4">
                  <Badge variant={c.exists ? 'green' : 'red'}>
                    {c.exists ? 'Configured' : 'Missing'}
                  </Badge>
                </td>
                <td className="py-3 pr-4 text-text-secondary">
                  {c.exists ? (c.enabled ? 'Yes' : 'No') : '--'}
                </td>
                <td className="py-3 pr-4">
                  {c.exists && c.redirectUris.length > 0 ? (
                    <div className="space-y-0.5">
                      {c.redirectUris.map((uri, i) => (
                        <div key={i} className="text-text-dim text-xs font-mono truncate max-w-xs" title={uri}>
                          {uri}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-dim">--</span>
                  )}
                </td>
                <td className="py-3">
                  {!c.exists && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleConfigure(c.clientId)}
                      disabled={!!configuring || !keycloakReachable}
                    >
                      {configuring === c.clientId ? 'Creating...' : 'Configure'}
                    </Button>
                  )}
                  {c.error && (
                    <span className="text-red-400 text-xs ml-2">{c.error}</span>
                  )}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-text-dim">
                  {keycloakReachable ? 'No OIDC clients expected' : 'Cannot connect to Keycloak'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Secret Modal */}
      {secretModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setSecretModal(null); }}
        >
          <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Client Created: {secretModal.clientId}
            </h3>
            <p className="text-text-dim text-sm mb-4">
              Save this client secret now. It will not be shown again.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-dim uppercase tracking-wider block mb-1">Client Secret</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-background border border-border rounded px-3 py-2 text-xs font-mono text-text-primary break-all">
                    {secretModal.secret}
                  </code>
                  <Button size="sm" onClick={handleCopySecret}>Copy</Button>
                </div>
              </div>

              <div>
                <label className="text-xs text-text-dim uppercase tracking-wider block mb-1">Redirect URIs</label>
                <div className="bg-background border border-border rounded px-3 py-2 space-y-1">
                  {secretModal.redirectUris.map((uri, i) => (
                    <div key={i} className="text-xs font-mono text-text-secondary break-all">{uri}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <Button variant="primary" onClick={() => setSecretModal(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
