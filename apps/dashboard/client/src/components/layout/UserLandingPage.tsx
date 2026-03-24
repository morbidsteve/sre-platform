import React, { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { useUserContext } from '../../context/UserContext';
import { Spinner } from '../ui/Spinner';
import { EmptyState } from '../ui/EmptyState';

interface PortalApp {
  name: string;
  url: string;
  icon?: string;
  description?: string;
  category?: string;
}

export function UserLandingPage() {
  const { user } = useUserContext();
  const [apps, setApps] = useState<PortalApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal/apps')
      .then((r) => r.json())
      .then((data) => setApps(data.apps || data || []))
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">
          Welcome{user?.email ? `, ${user.email.split('@')[0]}` : ''}
        </h1>
        <p className="text-text-dim text-sm">
          Access your applications and services below.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon="\uD83D\uDCE6"
          title="No applications available"
          description="Contact your administrator to get access to applications."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map((app) => (
            <a
              key={app.name}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-card border border-border rounded p-5 cursor-pointer transition-all hover:border-accent hover:shadow-lg no-underline group flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {app.icon && <span className="text-2xl">{app.icon}</span>}
                  <span className="text-[15px] font-semibold text-text-bright">
                    {app.name}
                  </span>
                </div>
                <ExternalLink
                  size={14}
                  className="text-text-dim group-hover:text-accent transition-colors"
                />
              </div>
              {app.description && (
                <p className="text-[11px] text-text-dim">{app.description}</p>
              )}
              {app.category && (
                <span className="font-mono text-[9px] text-text-dim uppercase tracking-[0.5px] bg-bg-secondary inline-block self-start px-2 py-0.5 rounded">
                  {app.category}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
