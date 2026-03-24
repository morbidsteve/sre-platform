import React, { useState, useEffect } from 'react';
import { Spinner } from '../ui/Spinner';
import { fetchCredentials } from '../../api/admin';

interface CredentialItem {
  service: string;
  username: string;
  password: string;
  url: string;
}

function MaskedValue({ value, isSensitive }: { value: string; isSensitive: boolean }) {
  const [visible, setVisible] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
  };

  if (!isSensitive) {
    return (
      <span
        className="text-xs text-text-primary cursor-pointer hover:bg-green/10 px-1 rounded transition-colors"
        onClick={handleCopy}
        title="Click to copy"
      >
        {value}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-text-primary">{visible ? value : '********'}</span>
      <button
        className="btn-outline text-[10px] !py-0.5 !px-2"
        onClick={() => {
          setVisible(!visible);
          if (!visible) setTimeout(() => setVisible(false), 15000);
        }}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
      <button className="btn-outline text-[10px] !py-0.5 !px-2" onClick={handleCopy}>
        Copy
      </button>
    </span>
  );
}

export function CredentialsPanel() {
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCredentials()
      .then((data) => setCredentials(data as unknown as Record<string, Record<string, string>>))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  const sensitiveKeys = ['password', 'secret', 'token', 'key'];
  const isSensitiveKey = (key: string) => sensitiveKeys.some((sk) => key.toLowerCase().includes(sk));

  // Extract SSO section if present
  const sso = (credentials as Record<string, unknown>)?.sso as Record<string, Record<string, string>> | undefined;
  const breakglass = (credentials as Record<string, unknown>)?.breakglass as Record<string, Record<string, string>> | undefined ?? credentials;

  return (
    <div>
      {/* SSO credentials */}
      {sso?.keycloak && (
        <div className="mb-6">
          <h3 className="text-[15px] font-semibold text-text-primary mb-2">Platform Login</h3>
          <p className="text-text-dim text-sm mb-4">
            All services use Keycloak SSO. Log in once and you are authenticated everywhere.
          </p>
          <div className="card-base p-4 max-w-[480px] border-accent">
            <h4 className="text-sm font-semibold text-text-primary mb-3">Keycloak SSO</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-[1px] text-text-dim w-20">Username</span>
                <MaskedValue value={sso.keycloak.username || ''} isSensitive={false} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-[1px] text-text-dim w-20">Password</span>
                <MaskedValue value={sso.keycloak.password || ''} isSensitive={true} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Break-glass credentials */}
      <details className="mt-2">
        <summary className="cursor-pointer text-text-dim text-sm select-none">
          Break-glass credentials (emergency use only)
        </summary>
        <p className="text-text-dim text-xs my-2">
          These local admin accounts bypass SSO. Use only when Keycloak is down or for initial setup.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
          {breakglass && Object.entries(breakglass).map(([service, creds]) => {
            if (typeof creds !== 'object' || creds === null) return null;
            const title = service.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

            return (
              <div key={service} className="card-base p-3">
                <h4 className="text-sm font-semibold text-text-primary mb-2">{title}</h4>
                <div className="space-y-1.5">
                  {Object.entries(creds as Record<string, string>).map(([k, v]) => {
                    if (k === 'note') return null;
                    return (
                      <div key={k} className="flex items-center gap-3">
                        <span className="text-[10px] uppercase tracking-[1px] text-text-dim w-20 shrink-0">{k}</span>
                        <MaskedValue value={String(v)} isSensitive={isSensitiveKey(k)} />
                      </div>
                    );
                  })}
                </div>
                {(creds as Record<string, string>).note && (
                  <p className="text-text-dim text-[11px] mt-2">{(creds as Record<string, string>).note}</p>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
