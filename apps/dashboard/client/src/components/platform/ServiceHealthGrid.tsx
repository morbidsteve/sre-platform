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
}

export function ServiceHealthGrid({ services, lastChecked, loading }: ServiceHealthGridProps) {
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

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="bg-card border border-border rounded-[var(--radius)] p-4 flex items-start gap-3"
          >
            <div className="mt-0.5">
              {svc.healthy ? (
                <CheckCircle className="w-5 h-5 text-green" />
              ) : (
                <XCircle className="w-5 h-5 text-red" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-text-bright mb-0.5">
                {svc.name.charAt(0).toUpperCase() + svc.name.slice(1)}
              </div>
              <a
                href={svc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-text-dim hover:text-accent truncate block"
                title={svc.url}
              >
                {svc.url.replace('https://', '')}
              </a>
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
