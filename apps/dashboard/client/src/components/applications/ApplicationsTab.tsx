import React, { useState } from 'react';
import { Search, RefreshCw, Rocket, ExternalLink, BarChart3, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { SkeletonCard } from '../ui/Skeleton';

interface ApplicationsTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onOpenApp: (url: string, title: string) => void;
  onSwitchTab: (tab: string) => void;
}

export function ApplicationsTab({ user, onOpenApp, onSwitchTab }: ApplicationsTabProps) {
  const config = useConfig();
  const { apps: appsData } = useData();
  const { apps, loading, refreshApps } = appsData;
  const [searchQuery, setSearchQuery] = useState('');
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());

  const handleDelete = async (namespace: string, name: string) => {
    if (!confirm(`Delete ${name} from ${namespace}? This removes all pods, services, and resources.`)) {
      return;
    }
    try {
      const resp = await fetch(
        `/api/apps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      );
      if (resp.ok) {
        setDeletedKeys((prev) => new Set(prev).add(`${namespace}/${name}`));
        setTimeout(refreshApps, 3000);
      }
    } catch {
      // handle silently
    }
  };

  const handleOpenService = (url: string) => {
    if (url.includes(`dsop.${config.domain}`)) {
      onOpenApp(url, 'DSOP Security Pipeline');
      return;
    }
    if (url.includes(`portal.${config.domain}`)) {
      onOpenApp(url, 'App Portal');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  // Filter out optimistically deleted apps, then apply search
  const visibleApps = apps.filter((a) => !deletedKeys.has(`${a.namespace}/${a.name}`));

  const filtered = searchQuery
    ? visibleApps.filter((a) => {
        const q = searchQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          (a.team || '').toLowerCase().includes(q) ||
          (a.image || '').toLowerCase().includes(q) ||
          (a.namespace || '').toLowerCase().includes(q)
        );
      })
    : visibleApps;

  const runningCount = filtered.filter((a) => a.ready).length;
  const deployingCount = filtered.filter((a) => !a.ready).length;
  const countText =
    filtered.length > 0
      ? `${runningCount} running${deployingCount > 0 ? `, ${deployingCount} deploying` : ''}`
      : '';

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright mb-1">Applications</h2>
          <p className="text-text-dim text-[13px]">
            Running applications on the SRE Platform.
          </p>
        </div>
      </div>

      {/* Search and controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search apps by name, team, namespace, or image..."
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-xs text-text-dim font-mono">{countText}</span>
        <button
          className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1"
          onClick={refreshApps}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* App Cards Grid */}
      {loading && visibleApps.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-card border border-border rounded-[var(--radius)]">
          <h3 className="text-base font-semibold text-text-primary mb-2">
            {visibleApps.length === 0 ? 'No applications deployed yet' : 'No apps match your search'}
          </h3>
          {visibleApps.length === 0 && (
            <>
              <p className="text-sm text-text-dim mb-4">
                Get started by deploying your first application.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => onSwitchTab('deploy')}
              >
                <Rocket className="w-4 h-4 inline-block mr-1" />
                Go to Deploy
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((app) => {
            const hasUrl = !!(app.url && app.host);
            const grafanaUrl = `${serviceUrl(config, 'grafana')}/explore?orgId=1&left=%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22expr%22:%22%7Bnamespace%3D%5C%22${encodeURIComponent(app.namespace)}%5C%22%7D%22%7D%5D%7D`;

            return (
              <div
                key={`${app.namespace}/${app.name}`}
                className={`bg-card border border-border border-l-[3px] rounded-[var(--radius)] p-4 transition-all ${
                  app.ready ? 'border-l-green' : 'border-l-yellow'
                } ${
                  hasUrl ? 'cursor-pointer hover:border-border-hover hover:bg-surface-hover' : ''
                }`}
                onClick={hasUrl ? () => handleOpenService(app.url!) : undefined}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-text-bright">{app.name}</span>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                      app.ready
                        ? 'bg-[rgba(64,192,87,0.15)] text-green'
                        : 'bg-[rgba(250,176,5,0.15)] text-yellow'
                    }`}
                  >
                    {app.ready ? 'Running' : 'Deploying'}
                  </span>
                </div>

                <div className="text-xs text-text-dim font-mono mb-2 truncate">
                  {app.image ? `${app.image}:${app.tag}` : 'unknown'}
                </div>

                {hasUrl ? (
                  <a
                    className="text-xs text-accent hover:underline block mb-2 truncate"
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {app.host}
                  </a>
                ) : (
                  <span className="text-xs text-text-dim block mb-2">Cluster-internal only</span>
                )}

                <div className="flex items-center gap-3 text-[11px] text-text-dim mb-3">
                  <span>{app.team || app.namespace}</span>
                  <span>{app.namespace}</span>
                  {app.port && <span>:{app.port}</span>}
                </div>

                <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <a
                    className="btn text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
                    href={grafanaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BarChart3 className="w-3 h-3" />
                    Logs
                  </a>
                  {hasUrl && (
                    <a
                      className="btn btn-primary text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1 no-underline"
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                  )}
                  {user.isAdmin && (
                    <button
                      className="btn btn-danger text-[11px] !px-2 !py-1 !min-h-0 inline-flex items-center gap-1"
                      onClick={() => handleDelete(app.namespace, app.name)}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
