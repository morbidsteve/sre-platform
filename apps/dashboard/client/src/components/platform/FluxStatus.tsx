import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Pause, ChevronDown, ChevronUp } from 'lucide-react';
import type { FluxStatus, FluxKustomization, FluxHelmRelease } from '../../api/platform';
import { triggerFluxReconcile } from '../../api/platform';
import { useToast } from '../../context/ToastContext';

interface FluxStatusProps {
  data: FluxStatus | null;
  loading: boolean;
  onRefresh: () => void;
}

function KustomizationRow({ k, onReconcile }: { k: FluxKustomization; onReconcile: (name: string, ns: string) => void }) {
  const isFailed = !k.ready && !k.suspended;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded text-[11px] font-mono transition-colors hover:bg-white/[0.03] ${
        k.suspended ? 'opacity-50' : ''
      }`}
    >
      {/* Status icon */}
      <div className="flex-shrink-0 mt-0.5">
        {k.suspended ? (
          <Pause className="w-3 h-3 text-text-dim" />
        ) : k.ready ? (
          <CheckCircle2 className="w-3 h-3 text-green" style={{ filter: 'drop-shadow(0 0 3px var(--green))' }} />
        ) : (
          <XCircle className="w-3 h-3 text-red" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-text-bright font-semibold truncate">{k.name}</span>
          <span className="text-text-dim text-[9px]">{k.namespace}</span>
          {k.suspended && (
            <span className="px-1 py-0.5 text-[8px] font-bold uppercase rounded bg-text-dim/20 text-text-dim tracking-wider">
              SUSPENDED
            </span>
          )}
          {isFailed && (
            <span className="px-1 py-0.5 text-[8px] font-bold uppercase rounded bg-red/15 text-red tracking-wider">
              FAILED
            </span>
          )}
        </div>
        {k.revision && (
          <div className="text-[9px] text-text-muted mt-0.5 truncate">{k.revision}</div>
        )}
        {isFailed && k.lastMessage && (
          <div className="text-[10px] text-red/80 mt-0.5 truncate" title={k.lastMessage}>
            {k.lastMessage}
          </div>
        )}
      </div>

      {/* Actions */}
      <button
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 hover:text-accent text-text-dim transition-colors"
        title="Reconcile"
        onClick={() => onReconcile(k.name, k.namespace)}
      >
        <RefreshCw className="w-3 h-3" />
      </button>
    </div>
  );
}

function HelmReleaseRow({ h, onReconcile }: { h: FluxHelmRelease; onReconcile: (name: string, ns: string) => void }) {
  const isFailed = !h.ready && !h.suspended;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded text-[11px] font-mono transition-colors hover:bg-white/[0.03] ${
        h.suspended ? 'opacity-50' : ''
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {h.suspended ? (
          <Pause className="w-3 h-3 text-text-dim" />
        ) : h.ready ? (
          <CheckCircle2 className="w-3 h-3 text-green" style={{ filter: 'drop-shadow(0 0 3px var(--green))' }} />
        ) : (
          <XCircle className="w-3 h-3 text-red" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-text-bright font-semibold truncate">{h.name}</span>
          <span className="text-text-dim text-[9px]">{h.namespace}</span>
          {h.version && (
            <span className="text-[9px] text-accent/70">{h.chart}@{h.version}</span>
          )}
          {h.suspended && (
            <span className="px-1 py-0.5 text-[8px] font-bold uppercase rounded bg-text-dim/20 text-text-dim tracking-wider">
              SUSPENDED
            </span>
          )}
          {isFailed && (
            <span className="px-1 py-0.5 text-[8px] font-bold uppercase rounded bg-red/15 text-red tracking-wider">
              FAILED
            </span>
          )}
        </div>
        {h.revision && (
          <div className="text-[9px] text-text-muted mt-0.5 truncate">{h.revision}</div>
        )}
        {isFailed && h.lastMessage && (
          <div className="text-[10px] text-red/80 mt-0.5 truncate" title={h.lastMessage}>
            {h.lastMessage}
          </div>
        )}
      </div>

      <button
        className="flex-shrink-0 opacity-0 hover:text-accent text-text-dim transition-colors"
        title="Reconcile"
        onClick={() => onReconcile(h.name, h.namespace)}
      >
        <RefreshCw className="w-3 h-3" />
      </button>
    </div>
  );
}

export function FluxStatusPanel({ data, loading, onRefresh }: FluxStatusProps) {
  const { showToast } = useToast();
  const [kustCollapsed, setKustCollapsed] = useState(false);
  const [helmCollapsed, setHelmCollapsed] = useState(false);

  const handleReconcile = async (name: string, namespace: string, kind: 'kustomization' | 'helmrelease') => {
    try {
      await triggerFluxReconcile(name, namespace, kind);
      showToast(`Reconcile triggered: ${name}`, 'success');
      onRefresh();
    } catch {
      showToast(`Failed to reconcile ${name}`, 'error');
    }
  };

  const syncedCount = data?.syncedCount ?? 0;
  const totalCount = data?.totalCount ?? 0;
  const allSynced = totalCount > 0 && syncedCount === totalCount;
  const failedKust = data?.kustomizations.filter((k) => !k.ready && !k.suspended) ?? [];
  const failedHelm = data?.helmReleases.filter((h) => !h.ready && !h.suspended) ?? [];
  const failedCount = failedKust.length + failedHelm.length;

  return (
    <div className="bg-[#0d1117] border border-border rounded-lg flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim">
            Flux GitOps
          </span>
          {!loading && (
            <span
              className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                failedCount > 0
                  ? 'bg-red/15 text-red'
                  : allSynced
                  ? 'bg-green/10 text-green'
                  : 'bg-yellow/10 text-yellow'
              }`}
            >
              {failedCount > 0 ? `${failedCount} FAILED` : allSynced ? 'ALL SYNCED' : `${syncedCount}/${totalCount}`}
            </span>
          )}
        </div>
        <button
          className={`text-text-dim hover:text-accent transition-colors ${loading ? 'animate-spin' : ''}`}
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
            <RefreshCw className="w-4 h-4 animate-spin text-accent" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Kustomizations section */}
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim hover:text-text-primary transition-colors"
                onClick={() => setKustCollapsed((v) => !v)}
              >
                <span>
                  Kustomizations
                  <span className="ml-1.5 text-text-muted font-normal normal-case tracking-normal">
                    ({data?.kustomizations.length ?? 0})
                  </span>
                </span>
                {kustCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>
              {!kustCollapsed && (
                <div className="pb-1">
                  {(data?.kustomizations ?? []).map((k) => (
                    <div key={k.name + k.namespace} className="group">
                      <KustomizationRow k={k} onReconcile={(n, ns) => handleReconcile(n, ns, 'kustomization')} />
                    </div>
                  ))}
                  {(data?.kustomizations.length ?? 0) === 0 && (
                    <div className="px-4 py-3 text-[11px] text-text-muted font-mono">No kustomizations found</div>
                  )}
                </div>
              )}
            </div>

            {/* HelmReleases section */}
            <div>
              <button
                className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-mono font-semibold uppercase tracking-widest text-text-dim hover:text-text-primary transition-colors"
                onClick={() => setHelmCollapsed((v) => !v)}
              >
                <span>
                  HelmReleases
                  <span className="ml-1.5 text-text-muted font-normal normal-case tracking-normal">
                    ({data?.helmReleases.length ?? 0})
                  </span>
                </span>
                {helmCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>
              {!helmCollapsed && (
                <div className="pb-1">
                  {(data?.helmReleases ?? []).map((h) => (
                    <div key={h.name + h.namespace} className="group">
                      <HelmReleaseRow h={h} onReconcile={(n, ns) => handleReconcile(n, ns, 'helmrelease')} />
                    </div>
                  ))}
                  {(data?.helmReleases.length ?? 0) === 0 && (
                    <div className="px-4 py-3 text-[11px] text-text-muted font-mono">No helm releases found</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
