import React from 'react';

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

interface ServiceInfo {
  name: string;
  namespace: string;
  healthy: boolean;
  url: string;
  icon: string;
  description: string;
}

interface ServiceTilesGridProps {
  services: ServiceInfo[];
  favorites: string[];
  loading: boolean;
  onToggleFavorite: (name: string) => void;
  onOpenService: (url: string) => void;
}

export function ServiceTilesGrid({
  services,
  favorites,
  loading,
  onToggleFavorite,
  onOpenService,
}: ServiceTilesGridProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!services || services.length === 0) {
    return <p className="text-text-dim">No services found.</p>;
  }

  const favSet = new Set(favorites);
  const favServices = services.filter((s) => favSet.has(s.name));
  const otherServices = services.filter((s) => !favSet.has(s.name));

  const renderTile = (svc: ServiceInfo, isFav: boolean) => {
    const iconChar = SERVICE_ICONS[svc.icon] || SERVICE_ICONS.package;

    return (
      <div
        key={svc.name}
        className="bg-card border border-border rounded-[var(--radius)] p-4 cursor-pointer hover:border-border-hover hover:bg-surface-hover transition-all"
        onClick={() => onOpenService(svc.url)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpenService(svc.url);
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <span className="text-2xl">{iconChar}</span>
          <button
            className={`text-lg transition-colors ${
              isFav ? 'text-yellow' : 'text-text-muted hover:text-yellow'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(svc.name);
            }}
            title="Toggle favorite"
          >
            {isFav ? '\u2605' : '\u2606'}
          </button>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-2 h-2 rounded-full ${svc.healthy ? 'bg-green' : 'bg-red'}`} />
          <span className="font-semibold text-sm text-text-bright">
            {svc.name.charAt(0).toUpperCase() + svc.name.slice(1)}
          </span>
        </div>
        <div className="text-xs text-text-dim line-clamp-2">{svc.description}</div>
      </div>
    );
  };

  return (
    <div>
      {favServices.length > 0 && (
        <>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-3 border-b border-border pb-1">
            Favorites
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {favServices.map((svc) => renderTile(svc, true))}
          </div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-dim mb-3 border-b border-border pb-1">
            All Services
          </div>
        </>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {otherServices.map((svc) => renderTile(svc, false))}
      </div>
    </div>
  );
}
