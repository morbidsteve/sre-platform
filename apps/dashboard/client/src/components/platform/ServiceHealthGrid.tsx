import React from 'react';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';

interface ServiceInfo {
  name: string;
  namespace: string;
  healthy: boolean;
  url: string;
  icon: string;
  description: string;
}

interface ServiceHealthGridProps {
  services: ServiceInfo[];
  lastChecked: string;
  loading: boolean;
  onOpenService?: (url: string, name: string) => void;
}

export function ServiceHealthGrid({ services, lastChecked, loading, onOpenService }: ServiceHealthGridProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!services || services.length === 0) {
    return <p className="text-text-dim">No services to check.</p>;
  }

  const handleClick = (svc: ServiceInfo) => {
    if (onOpenService) {
      onOpenService(svc.url, svc.name);
    } else {
      window.open(svc.url, '_blank', 'noopener');
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-start gap-3 cursor-pointer hover:border-border-hover hover:bg-surface-hover transition-all group"
            onClick={() => handleClick(svc)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleClick(svc);
            }}
          >
            <div className="mt-0.5">
              {svc.healthy ? (
                <CheckCircle className="w-5 h-5 text-green" />
              ) : (
                <XCircle className="w-5 h-5 text-red" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-semibold text-sm text-text-bright">
                  {svc.name.charAt(0).toUpperCase() + svc.name.slice(1)}
                </span>
                <ExternalLink className="w-3 h-3 text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-[11px] text-text-dim mb-1">{svc.description}</div>
              <div
                className="text-xs text-text-dim hover:text-accent truncate block"
                title={svc.url}
              >
                {svc.url.replace('https://', '')}
              </div>
              <span
                className={`inline-block mt-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                  svc.healthy
                    ? 'bg-[rgba(64,192,87,0.15)] text-green'
                    : 'bg-[rgba(250,82,82,0.15)] text-red'
                }`}
              >
                {svc.healthy ? 'UP' : 'DOWN'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {lastChecked && (
        <div className="text-[11px] text-text-dim mt-3">
          Last checked: {lastChecked}
        </div>
      )}
    </div>
  );
}
