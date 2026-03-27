import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PlatformService } from '../../api/platform';
import { ServiceDetailSlideOut } from './DetailSlideOut';

const HUD_ACCENT = '#34d399';
const HUD_RED = '#f87171';
const HUD_BORDER = '#374151';
const HUD_LABEL = '#9ca3af';
const HUD_TEXT = '#e5e7eb';

interface ServiceHealthProps {
  services: PlatformService[];
  loading: boolean;
  onOpenService?: (url: string, name: string) => void;
}

const PLATFORM_SERVICES_ORDER = [
  'istio', 'kyverno', 'monitoring', 'prometheus', 'grafana',
  'loki', 'logging', 'alloy', 'harbor', 'keycloak',
  'openbao', 'neuvector', 'cert-manager', 'certmanager', 'velero', 'tempo',
];

function serviceDisplayName(name: string): string {
  const map: Record<string, string> = {
    'istio': 'Istio', 'kyverno': 'Kyverno', 'monitoring': 'Prometheus',
    'prometheus': 'Prometheus', 'grafana': 'Grafana', 'loki': 'Loki',
    'logging': 'Loki', 'alloy': 'Alloy', 'harbor': 'Harbor',
    'keycloak': 'Keycloak', 'openbao': 'OpenBao', 'neuvector': 'NeuVector',
    'cert-manager': 'cert-mgr', 'certmanager': 'cert-mgr',
    'velero': 'Velero', 'tempo': 'Tempo',
  };
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return name.length > 10 ? name.slice(0, 9) + '…' : name.charAt(0).toUpperCase() + name.slice(1);
}

function serviceIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('istio')) return '◈';
  if (lower.includes('kyverno')) return '⬡';
  if (lower.includes('grafana')) return '▣';
  if (lower.includes('prometheus') || lower.includes('monitoring')) return '◉';
  if (lower.includes('loki') || lower.includes('logging')) return '≡';
  if (lower.includes('alloy')) return '⋈';
  if (lower.includes('harbor')) return '⚓';
  if (lower.includes('keycloak')) return '◎';
  if (lower.includes('openbao') || lower.includes('vault')) return '⬢';
  if (lower.includes('neuvector')) return '◆';
  if (lower.includes('cert') || lower.includes('certmanager')) return '✦';
  if (lower.includes('velero')) return '▤';
  if (lower.includes('tempo')) return '◈';
  return '◇';
}

export function ServiceHealthPanel({ services, loading, onOpenService }: ServiceHealthProps) {
  const [selectedService, setSelectedService] = useState<PlatformService | null>(null);

  const sorted = [...services].sort((a, b) => {
    const ai = PLATFORM_SERVICES_ORDER.findIndex((k) => a.name.toLowerCase().includes(k));
    const bi = PLATFORM_SERVICES_ORDER.findIndex((k) => b.name.toLowerCase().includes(k));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const healthyCount = services.filter((s) => s.healthy).length;
  const totalCount = services.length;
  const allHealthy = totalCount > 0 && healthyCount === totalCount;
  const statusColor = totalCount === 0 ? HUD_LABEL : allHealthy ? HUD_ACCENT : healthyCount === 0 ? HUD_RED : '#fbbf24';

  return (
    <>
      <div
        className="flex flex-col overflow-hidden h-full rounded"
        style={{ background: '#111827', border: `1px solid ${HUD_BORDER}` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: `1px solid ${HUD_BORDER}` }}
        >
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-[3px]"
            style={{ color: HUD_LABEL }}
          >
            Platform Services
          </span>
          {!loading && totalCount > 0 && (
            <span
              className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded"
              style={{
                color: statusColor,
                background: `${statusColor}18`,
                border: `1px solid ${statusColor}30`,
              }}
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
                <div
                  key={i}
                  className="h-16 rounded animate-pulse"
                  style={{ background: '#1f2937', border: `1px solid ${HUD_BORDER}` }}
                />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div
              className="flex items-center justify-center py-8 text-[10px] font-mono uppercase tracking-widest"
              style={{ color: HUD_LABEL }}
            >
              No services found
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {sorted.map((svc) => {
                const healthy = svc.healthy;
                const accentC = healthy ? HUD_ACCENT : HUD_RED;
                return (
                  <button
                    key={svc.name + svc.namespace}
                    className="relative flex flex-col items-start gap-1.5 p-2.5 rounded text-left transition-all group"
                    style={{
                      background: healthy ? '#1f2937' : 'rgba(248,113,113,0.06)',
                      border: `1px solid ${healthy ? '#374151' : 'rgba(248,113,113,0.25)'}`,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = healthy
                        ? '#273344'
                        : 'rgba(248,113,113,0.10)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = healthy ? '#4b5563' : 'rgba(248,113,113,0.4)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = healthy ? '#1f2937' : 'rgba(248,113,113,0.06)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = healthy ? '#374151' : 'rgba(248,113,113,0.25)';
                    }}
                    onClick={() => setSelectedService(svc)}
                    title={`${svc.name} (${svc.namespace})`}
                  >
                    {/* Status dot */}
                    <span
                      className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: accentC }}
                    />

                    {/* Icon */}
                    <span
                      className="text-sm leading-none font-mono"
                      style={{ color: healthy ? HUD_ACCENT : HUD_RED }}
                    >
                      {svc.icon || serviceIcon(svc.name)}
                    </span>

                    {/* Name */}
                    <span
                      className="text-[10px] font-mono font-bold leading-tight"
                      style={{ color: HUD_TEXT }}
                    >
                      {serviceDisplayName(svc.name)}
                    </span>

                    {/* Namespace */}
                    <span className="text-[8px] font-mono truncate w-full" style={{ color: HUD_LABEL }}>
                      {svc.namespace}
                    </span>

                    {/* External link */}
                    {svc.url && (
                      <ExternalLink
                        className="absolute bottom-2 right-2 w-2.5 h-2.5 opacity-0 group-hover:opacity-40 transition-opacity"
                        style={{ color: accentC }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedService && (
        <ServiceDetailSlideOut
          service={selectedService}
          onClose={() => setSelectedService(null)}
        />
      )}
    </>
  );
}
