import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { PlatformService } from '../../api/platform';

interface ServiceHealthProps {
  services: PlatformService[];
  loading: boolean;
  onOpenService?: (url: string, name: string) => void;
}

// Ordered list of key platform services to always display (with fallback icons)
const PLATFORM_SERVICES_ORDER = [
  'istio',
  'kyverno',
  'monitoring',
  'prometheus',
  'grafana',
  'loki',
  'logging',
  'alloy',
  'harbor',
  'keycloak',
  'openbao',
  'neuvector',
  'cert-manager',
  'certmanager',
  'velero',
  'tempo',
];

function serviceDisplayName(name: string): string {
  const map: Record<string, string> = {
    'istio': 'Istio',
    'kyverno': 'Kyverno',
    'monitoring': 'Prometheus',
    'prometheus': 'Prometheus',
    'grafana': 'Grafana',
    'loki': 'Loki',
    'logging': 'Loki',
    'alloy': 'Alloy',
    'harbor': 'Harbor',
    'keycloak': 'Keycloak',
    'openbao': 'OpenBao',
    'neuvector': 'NeuVector',
    'cert-manager': 'cert-manager',
    'certmanager': 'cert-manager',
    'velero': 'Velero',
    'tempo': 'Tempo',
  };
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function serviceIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('istio')) return '🕸';
  if (lower.includes('kyverno')) return '🛡';
  if (lower.includes('grafana')) return '📊';
  if (lower.includes('prometheus') || lower.includes('monitoring')) return '📈';
  if (lower.includes('loki') || lower.includes('logging')) return '📋';
  if (lower.includes('alloy')) return '🔗';
  if (lower.includes('harbor')) return '⚓';
  if (lower.includes('keycloak')) return '🔑';
  if (lower.includes('openbao') || lower.includes('vault')) return '🔐';
  if (lower.includes('neuvector')) return '🦺';
  if (lower.includes('cert') || lower.includes('certmanager')) return '📜';
  if (lower.includes('velero')) return '💾';
  if (lower.includes('tempo')) return '🔎';
  return '⬡';
}

export function ServiceHealthPanel({ services, loading, onOpenService }: ServiceHealthProps) {
  // Sort services by the PLATFORM_SERVICES_ORDER priority
  const sorted = [...services].sort((a, b) => {
    const ai = PLATFORM_SERVICES_ORDER.findIndex((k) => a.name.toLowerCase().includes(k));
    const bi = PLATFORM_SERVICES_ORDER.findIndex((k) => b.name.toLowerCase().includes(k));
    const aIdx = ai === -1 ? 999 : ai;
    const bIdx = bi === -1 ? 999 : bi;
    return aIdx - bIdx;
  });

  const healthyCount = services.filter((s) => s.healthy).length;
  const totalCount = services.length;

  return (
    <div className="bg-[#0d1117] border border-border rounded-lg flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim">
          Platform Services
        </span>
        {!loading && totalCount > 0 && (
          <span
            className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded ${
              healthyCount === totalCount
                ? 'bg-green/10 text-green'
                : healthyCount === 0
                ? 'bg-red/15 text-red'
                : 'bg-yellow/10 text-yellow'
            }`}
          >
            {healthyCount}/{totalCount} UP
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[11px] text-text-muted font-mono">
            No services found
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {sorted.map((svc) => (
              <button
                key={svc.name + svc.namespace}
                className={`relative flex flex-col items-start gap-1.5 p-2.5 rounded border text-left transition-all hover:border-border-hover group ${
                  svc.healthy
                    ? 'bg-green/[0.04] border-green/20 hover:bg-green/[0.07]'
                    : 'bg-red/[0.04] border-red/20 hover:bg-red/[0.07]'
                }`}
                onClick={() => svc.url && onOpenService?.(svc.url, svc.name)}
                title={`${svc.name} (${svc.namespace}) — ${svc.podCount ?? 0} pods`}
              >
                {/* Status dot */}
                <div
                  className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${
                    svc.healthy ? 'bg-green' : 'bg-red'
                  }`}
                  style={svc.healthy ? { boxShadow: '0 0 4px var(--green)' } : undefined}
                />

                {/* Icon */}
                <span className="text-base leading-none">{svc.icon || serviceIcon(svc.name)}</span>

                {/* Name */}
                <span className="text-[10px] font-mono font-semibold text-text-primary leading-tight">
                  {serviceDisplayName(svc.name)}
                </span>

                {/* Pod count + namespace */}
                <span className="text-[9px] text-text-dim font-mono">
                  {svc.namespace}
                </span>

                {/* External link hint */}
                {svc.url && (
                  <ExternalLink className="absolute bottom-2 right-2 w-2.5 h-2.5 text-text-dim opacity-0 group-hover:opacity-60 transition-opacity" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
