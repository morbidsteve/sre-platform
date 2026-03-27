import React, { useState } from 'react';
import { RefreshCw, Pause, ChevronDown, ChevronUp } from 'lucide-react';
import type { FluxStatus, FluxKustomization, FluxHelmRelease } from '../../api/platform';
import { FluxKustDetailSlideOut, FluxHelmDetailSlideOut } from './DetailSlideOut';

interface FluxStatusProps {
  data: FluxStatus | null;
  loading: boolean;
  onRefresh: () => void;
}

function StatusIcon({ ready, suspended }: { ready: boolean; suspended: boolean }) {
  if (suspended) return <Pause className="w-3 h-3" style={{ color: 'var(--yellow)' }} />;
  if (ready) {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: 'var(--green)' }}
      />
    );
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: 'var(--red)' }}
    />
  );
}

function KustomizationRow({
  k,
  onClick,
}: {
  k: FluxKustomization;
  onClick: () => void;
}) {
  const isFailed = !k.ready && !k.suspended;

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded text-[11px] font-mono transition-all cursor-pointer"
      style={{
        opacity: k.suspended ? 0.5 : 1,
        background: isFailed ? 'rgba(248,113,113,0.06)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isFailed
          ? 'rgba(248,113,113,0.10)'
          : 'var(--surface)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isFailed
          ? 'rgba(248,113,113,0.06)'
          : 'transparent';
      }}
      onClick={onClick}
      title="Click for details"
    >
      <div className="flex-shrink-0 mt-0.5 flex items-center">
        <StatusIcon ready={k.ready} suspended={k.suspended} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold truncate" style={{ color: 'var(--text-bright)' }}>{k.name}</span>
          <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>{k.namespace}</span>
          {k.suspended && (
            <span
              className="px-1 py-0.5 text-[8px] font-bold uppercase rounded tracking-wider"
              style={{ color: 'var(--yellow)', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}
            >
              SUSPENDED
            </span>
          )}
          {isFailed && (
            <span
              className="px-1 py-0.5 text-[8px] font-bold uppercase rounded tracking-wider"
              style={{ color: 'var(--red)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }}
            >
              FAILED
            </span>
          )}
        </div>
        {k.revision && (
          <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>{k.revision}</div>
        )}
        {isFailed && k.lastMessage && (
          <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--red)' }} title={k.lastMessage}>
            {k.lastMessage}
          </div>
        )}
      </div>
      <span className="text-[8px] font-mono flex-shrink-0 self-center opacity-40 ml-1" style={{ color: 'var(--accent)' }}>›</span>
    </div>
  );
}

function HelmReleaseRow({
  h,
  onClick,
}: {
  h: FluxHelmRelease;
  onClick: () => void;
}) {
  const isFailed = !h.ready && !h.suspended;

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded text-[11px] font-mono transition-all cursor-pointer"
      style={{
        opacity: h.suspended ? 0.5 : 1,
        background: isFailed ? 'rgba(248,113,113,0.06)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isFailed
          ? 'rgba(248,113,113,0.10)'
          : 'var(--surface)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = isFailed
          ? 'rgba(248,113,113,0.06)'
          : 'transparent';
      }}
      onClick={onClick}
      title="Click for details"
    >
      <div className="flex-shrink-0 mt-0.5 flex items-center">
        <StatusIcon ready={h.ready} suspended={h.suspended} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold truncate" style={{ color: 'var(--text-bright)' }}>{h.name}</span>
          <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>{h.namespace}</span>
          {h.version && (
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {h.chart}@{h.version}
            </span>
          )}
          {h.suspended && (
            <span
              className="px-1 py-0.5 text-[8px] font-bold uppercase rounded tracking-wider"
              style={{ color: 'var(--yellow)', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}
            >
              SUSPENDED
            </span>
          )}
          {isFailed && (
            <span
              className="px-1 py-0.5 text-[8px] font-bold uppercase rounded tracking-wider"
              style={{ color: 'var(--red)', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)' }}
            >
              FAILED
            </span>
          )}
        </div>
        {h.revision && (
          <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>{h.revision}</div>
        )}
        {isFailed && h.lastMessage && (
          <div className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--red)' }} title={h.lastMessage}>
            {h.lastMessage}
          </div>
        )}
      </div>
      <span className="text-[8px] font-mono flex-shrink-0 self-center opacity-40 ml-1" style={{ color: 'var(--accent)' }}>›</span>
    </div>
  );
}

export function FluxStatusPanel({ data, loading, onRefresh }: FluxStatusProps) {
  const [kustCollapsed, setKustCollapsed] = useState(false);
  const [helmCollapsed, setHelmCollapsed] = useState(false);
  const [selectedKust, setSelectedKust] = useState<FluxKustomization | null>(null);
  const [selectedHelm, setSelectedHelm] = useState<FluxHelmRelease | null>(null);

  const syncedCount = data?.syncedCount ?? 0;
  const totalCount = data?.totalCount ?? 0;
  const allSynced = totalCount > 0 && syncedCount === totalCount;
  const failedKust = data?.kustomizations.filter((k) => !k.ready && !k.suspended) ?? [];
  const failedHelm = data?.helmReleases.filter((h) => !h.ready && !h.suspended) ?? [];
  const failedCount = failedKust.length + failedHelm.length;

  const statusColor = failedCount > 0 ? 'var(--red)' : allSynced ? 'var(--green)' : 'var(--yellow)';
  const statusLabel = failedCount > 0
    ? `${failedCount} FAILED`
    : allSynced
    ? 'ALL SYNCED'
    : `${syncedCount}/${totalCount}`;

  return (
    <>
      <div
        className="flex flex-col overflow-hidden h-full rounded"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-mono font-bold uppercase tracking-[3px]"
              style={{ color: 'var(--text-dim)' }}
            >
              Flux GitOps
            </span>
            {!loading && (
              <span
                className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded"
                style={{
                  color: statusColor,
                  background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${statusColor} 30%, transparent)`,
                }}
              >
                {statusLabel}
              </span>
            )}
          </div>
          <button
            className={`transition-opacity hover:opacity-60 ${loading ? 'animate-spin' : ''}`}
            style={{ color: 'var(--accent)' }}
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && !data ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : (
            <div>
              {/* Kustomizations */}
              <div>
                <button
                  className="w-full flex items-center justify-between px-4 py-2 text-[9px] font-mono font-bold uppercase tracking-[3px] transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}
                  onClick={() => setKustCollapsed((v) => !v)}
                >
                  <span>
                    Kustomizations
                    <span className="ml-1.5 font-normal normal-case tracking-normal" style={{ color: 'var(--text-muted)' }}>
                      ({data?.kustomizations.length ?? 0})
                    </span>
                  </span>
                  {kustCollapsed
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronUp className="w-3 h-3" />}
                </button>
                {!kustCollapsed && (
                  <div className="pb-1">
                    {(data?.kustomizations ?? []).map((k) => (
                      <KustomizationRow
                        key={k.name + k.namespace}
                        k={k}
                        onClick={() => setSelectedKust(k)}
                      />
                    ))}
                    {(data?.kustomizations.length ?? 0) === 0 && (
                      <div className="px-4 py-3 text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                        No kustomizations found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* HelmReleases */}
              <div>
                <button
                  className="w-full flex items-center justify-between px-4 py-2 text-[9px] font-mono font-bold uppercase tracking-[3px] transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}
                  onClick={() => setHelmCollapsed((v) => !v)}
                >
                  <span>
                    HelmReleases
                    <span className="ml-1.5 font-normal normal-case tracking-normal" style={{ color: 'var(--text-muted)' }}>
                      ({data?.helmReleases.length ?? 0})
                    </span>
                  </span>
                  {helmCollapsed
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronUp className="w-3 h-3" />}
                </button>
                {!helmCollapsed && (
                  <div className="pb-1">
                    {(data?.helmReleases ?? []).map((h) => (
                      <HelmReleaseRow
                        key={h.name + h.namespace}
                        h={h}
                        onClick={() => setSelectedHelm(h)}
                      />
                    ))}
                    {(data?.helmReleases.length ?? 0) === 0 && (
                      <div className="px-4 py-3 text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                        No helm releases found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-outs */}
      {selectedKust && (
        <FluxKustDetailSlideOut
          item={selectedKust}
          onClose={() => setSelectedKust(null)}
          onRefresh={onRefresh}
        />
      )}
      {selectedHelm && (
        <FluxHelmDetailSlideOut
          item={selectedHelm}
          onClose={() => setSelectedHelm(null)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
