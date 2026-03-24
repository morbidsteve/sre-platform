import React, { useState } from 'react';
import { AppTile } from './AppTile';
import { Search, RefreshCw, Rocket } from 'lucide-react';

interface AppInfo {
  name: string;
  namespace: string;
  team?: string;
  image: string;
  tag: string;
  port?: number;
  host?: string;
  url?: string;
  ready: boolean;
  status?: string;
  _isPipelineRun?: boolean;
  _runId?: string;
  gates?: { short_name: string; gate_name: string; status: string }[];
  classification?: string;
  created_at?: string;
}

interface AppGalleryProps {
  apps: AppInfo[];
  loading: boolean;
  isAdmin: boolean;
  onRefresh: () => void;
  onDelete: (namespace: string, name: string) => void;
  onOpenService: (url: string) => void;
  onOpenDsopWizard: () => void;
  onShowRunDetail?: (runId: string) => void;
}

export function AppGallery({
  apps,
  loading,
  isAdmin,
  onRefresh,
  onDelete,
  onOpenService,
  onOpenDsopWizard,
  onShowRunDetail,
}: AppGalleryProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = searchQuery
    ? apps.filter((a) => {
        const q = searchQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          (a.team || '').toLowerCase().includes(q) ||
          (a.image || '').toLowerCase().includes(q) ||
          (a.namespace || '').toLowerCase().includes(q) ||
          (a.status || '').toLowerCase().includes(q)
        );
      })
    : apps;

  const pipeCount = filtered.filter((a) => a._isPipelineRun).length;
  const appCount = filtered.length - pipeCount;

  const countText =
    appCount > 0
      ? `${appCount} app${appCount !== 1 ? 's' : ''}${pipeCount > 0 ? `, ${pipeCount} in pipeline` : ''}`
      : '';

  return (
    <div>
      {/* Search and controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search apps by name, team, or image..."
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <span className="text-xs text-text-dim font-mono">{countText}</span>
        <button
          className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1"
          onClick={onRefresh}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Gallery */}
      {loading && apps.length === 0 ? (
        <div className="flex justify-center py-8">
          <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-card border border-border rounded-[var(--radius)]">
          <h3 className="text-base font-semibold text-text-primary mb-2">No apps deployed yet</h3>
          <p className="text-sm text-text-dim mb-4">Deploy your first app using the DSOP Wizard.</p>
          <button className="btn btn-primary" onClick={onOpenDsopWizard}>
            <Rocket className="w-4 h-4 inline-block mr-1" />
            Open DSOP Deploy Wizard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((app) => (
            <AppTile
              key={`${app.namespace}/${app.name}${app._runId ? `-${app._runId}` : ''}`}
              app={app}
              isAdmin={isAdmin}
              onDelete={onDelete}
              onOpenService={onOpenService}
              onShowRunDetail={onShowRunDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
