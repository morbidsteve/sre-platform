import React, { useEffect, useState, useCallback } from 'react';
import { Star, ExternalLink, Package } from 'lucide-react';
import { useConfig } from '../../context/ConfigContext';

const SERVICE_ICONS: Record<string, string> = {
  chart: '\uD83D\uDCCA',
  search: '\uD83D\uDD0D',
  bell: '\uD83D\uDD14',
  container: '\uD83D\uDC33',
  key: '\uD83D\uDD11',
  shield: '\uD83D\uDEE1\uFE0F',
  lock: '\uD83D\uDD10',
  layout: '\uD83D\uDCCB',
  package: '\uD83D\uDCE6',
};

interface PortalApp {
  name: string;
  displayName?: string;
  description: string;
  url: string;
  icon: string;
  namespace?: string;
  category?: string;
  status?: string;
}

interface PortalAppsGridProps {
  onOpenApp: (url: string, title: string) => void;
}

export function PortalAppsGrid({ onOpenApp }: PortalAppsGridProps) {
  const config = useConfig();
  const [apps, setApps] = useState<PortalApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<string[]>([]);

  const loadApps = useCallback(async () => {
    try {
      const resp = await fetch('/api/portal/apps');
      const data = await resp.json();
      setApps(data.apps || []);
    } catch {
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      const resp = await fetch('/api/favorites');
      const data = await resp.json();
      setFavorites(data.favorites || []);
    } catch {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    loadApps();
    loadFavorites();
  }, [loadApps, loadFavorites]);

  const toggleFavorite = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    const newFavs = favorites.includes(name)
      ? favorites.filter((f) => f !== name)
      : [...favorites, name];
    setFavorites(newFavs);
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites: newFavs }),
      });
    } catch {
      // non-critical
    }
  };

  const handleTileClick = (app: PortalApp) => {
    if (app.url && app.url.includes(`dsop.${config.domain}`)) {
      onOpenApp(app.url, 'DSOP Security Pipeline');
      return;
    }
    if (app.url && app.url.includes(`portal.${config.domain}`)) {
      onOpenApp(app.url, 'App Portal');
      return;
    }
    if (app.url) {
      window.open(app.url, '_blank', 'noopener');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (apps.length === 0) {
    return (
      <div className="text-center py-10 text-text-dim">
        <h3 className="text-lg text-text-primary mb-2">No applications available</h3>
        <p className="text-sm">Contact your administrator to get access to applications.</p>
      </div>
    );
  }

  const favSet = new Set(favorites);
  const favApps = apps.filter((a) => favSet.has(a.name));
  const platformApps = apps.filter((a) => !favSet.has(a.name) && !a.namespace);
  const deployedApps = apps.filter((a) => !favSet.has(a.name) && a.namespace);

  const renderTile = (app: PortalApp, isFav: boolean) => {
    const iconChar = SERVICE_ICONS[app.icon] || SERVICE_ICONS.package;

    return (
      <div
        key={app.name}
        className="bg-card border border-border rounded-[var(--radius)] p-4 cursor-pointer hover:border-border-hover hover:bg-surface-hover transition-all group"
        onClick={() => handleTileClick(app)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleTileClick(app);
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <span className="text-2xl">{iconChar}</span>
          <button
            className={`text-lg transition-colors ${
              isFav ? 'text-yellow' : 'text-text-muted hover:text-yellow'
            }`}
            onClick={(e) => toggleFavorite(e, app.name)}
            title="Toggle favorite"
          >
            {isFav ? '\u2605' : '\u2606'}
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-2 h-2 rounded-full bg-green" />
          <span className="font-semibold text-sm text-text-bright">
            {app.displayName || app.name.charAt(0).toUpperCase() + app.name.slice(1)}
          </span>
        </div>
        <div className="text-xs text-text-dim line-clamp-2">{app.description}</div>
      </div>
    );
  };

  return (
    <div>
      {favApps.length > 0 && (
        <>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-3 border-b border-border pb-1">
            Favorites
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {favApps.map((app) => renderTile(app, true))}
          </div>
        </>
      )}

      {platformApps.length > 0 && (
        <>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-3 border-b border-border pb-1">
            Platform Services
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {platformApps.map((app) => renderTile(app, false))}
          </div>
        </>
      )}

      {deployedApps.length > 0 && (
        <>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-3 border-b border-border pb-1">
            Deployed Apps
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {deployedApps.map((app) => renderTile(app, false))}
          </div>
        </>
      )}
    </div>
  );
}
