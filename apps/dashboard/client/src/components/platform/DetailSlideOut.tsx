import React, { useEffect, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { triggerFluxReconcile } from '../../api/platform';
import { useToast } from '../../context/ToastContext';
import type { PlatformNode, FluxKustomization, FluxHelmRelease, PlatformService } from '../../api/platform';

// ── Shared platform cockpit styles ────────────────────────────────────────────

const HUD_BG = '#111827';
const HUD_BORDER = '#374151';
const HUD_ACCENT = '#38bdf8';
const HUD_AMBER = '#fbbf24';
const HUD_RED = '#f87171';

function HudLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-mono uppercase tracking-[2px] mb-0.5" style={{ color: '#9ca3af' }}>
      {children}
    </div>
  );
}

function HudValue({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[11px] font-mono font-semibold" style={{ color: color ?? '#e5e7eb' }}>
      {children}
    </div>
  );
}

function HudSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[9px] font-mono font-bold uppercase tracking-[3px] pb-1 mb-2"
      style={{ color: HUD_ACCENT, borderBottom: `1px solid ${HUD_BORDER}` }}
    >
      {children}
    </div>
  );
}

function StatusDot({ healthy, pulse }: { healthy: boolean; pulse?: boolean }) {
  const color = healthy ? HUD_ACCENT : HUD_RED;
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

// ── Slide-out wrapper ────────────────────────────────────────────────────────

interface SlideOutProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

function SlideOutWrapper({ title, subtitle, onClose, children }: SlideOutProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[290]"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 w-[480px] z-[300] flex flex-col hud-slide-in"
        style={{ background: HUD_BG, borderLeft: `1px solid ${HUD_BORDER}` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${HUD_BORDER}`, background: '#1f2937' }}
        >
          <div className="min-w-0">
            <div className="font-mono text-sm font-bold truncate" style={{ color: HUD_ACCENT }}>
              {title}
            </div>
            {subtitle && (
              <div className="text-[10px] font-mono mt-0.5" style={{ color: '#9ca3af' }}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            className="flex-shrink-0 ml-3 transition-opacity hover:opacity-60"
            style={{ color: HUD_ACCENT }}
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {children}
        </div>
      </div>
    </>
  );
}

// ── Node Detail ──────────────────────────────────────────────────────────────

interface NodeDetailProps {
  node: PlatformNode;
  onClose: () => void;
}

export function NodeDetailSlideOut({ node, onClose }: NodeDetailProps) {
  const isReady = node.status === 'Ready';
  const cpuPct = node.cpu?.pct ?? 0;
  const memPct = node.memory?.pct ?? 0;

  function barColor(pct: number, highThresh: number, warnThresh: number): string {
    if (pct > highThresh) return HUD_RED;
    if (pct > warnThresh) return HUD_AMBER;
    return HUD_ACCENT;
  }

  return (
    <SlideOutWrapper
      title={node.name}
      subtitle={`Node · ${node.status}`}
      onClose={onClose}
    >
      {/* Status */}
      <div>
        <HudSectionHeader>Status</HudSectionHeader>
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Status', node.status],
            ['IP', node.ip || '—'],
            ['Kubelet', node.kubelet || '—'],
            ['Uptime', node.age ? `up ${node.age}` : '—'],
            ['Pods', `${node.pods?.count ?? 0} / ${node.pods?.allocatable ?? '?'}`],
            ['Schedulable', node.unschedulable ? 'CORDONED' : 'Yes'],
          ].map(([label, val]) => (
            <div key={label}>
              <HudLabel>{label}</HudLabel>
              <HudValue color={label === 'Schedulable' && node.unschedulable ? HUD_RED : undefined}>
                {val}
              </HudValue>
            </div>
          ))}
        </div>
      </div>

      {/* Roles */}
      {node.roles && (
        <div>
          <HudSectionHeader>Roles</HudSectionHeader>
          <div className="flex flex-wrap gap-1.5">
            {(Array.isArray(node.roles) ? node.roles : String(node.roles).split(',').filter(Boolean)).map((r) => (
              <span
                key={r}
                className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                style={{
                  color: r === 'control-plane' || r === 'etcd' ? '#60a5fa' : HUD_ACCENT,
                  background: r === 'control-plane' || r === 'etcd' ? 'rgba(96,165,250,0.1)' : 'rgba(56,189,248,0.08)',
                  border: `1px solid ${r === 'control-plane' || r === 'etcd' ? 'rgba(96,165,250,0.25)' : 'rgba(56,189,248,0.2)'}`,
                }}
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Resources */}
      <div>
        <HudSectionHeader>Resources</HudSectionHeader>
        <div className="space-y-3">
          {/* CPU */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#9ca3af' }}>CPU</span>
              <span className="text-[10px] font-mono" style={{ color: barColor(cpuPct, 85, 65) }}>
                {node.cpu?.usedFmt ?? '—'} / {node.cpu?.allocFmt ?? '?'} ({cpuPct}%)
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#374151' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(Math.max(cpuPct, 2), 100)}%`,
                  background: barColor(cpuPct, 85, 65),
                }}
              />
            </div>
          </div>
          {/* Memory */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#9ca3af' }}>MEM</span>
              <span className="text-[10px] font-mono" style={{ color: barColor(memPct, 85, 70) }}>
                {node.memory?.usedFmt ?? '—'} / {node.memory?.allocFmt ?? '?'} ({memPct}%)
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#374151' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(Math.max(memPct, 2), 100)}%`,
                  background: barColor(memPct, 85, 70),
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Conditions */}
      {node.conditions && node.conditions.length > 0 && (
        <div>
          <HudSectionHeader>Conditions</HudSectionHeader>
          <div className="space-y-1.5">
            {node.conditions.map((c) => (
              <div key={c.type} className="flex items-start gap-2 text-[10px] font-mono">
                <StatusDot healthy={c.status === 'True'} />
                <span className="font-semibold w-32 flex-shrink-0" style={{ color: '#e5e7eb' }}>{c.type}</span>
                <span style={{ color: c.status === 'True' ? HUD_ACCENT : HUD_RED }}>{c.status}</span>
                {c.message && (
                  <span className="truncate" style={{ color: '#9ca3af' }} title={c.message}>{c.message}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ready status badge at bottom */}
      <div
        className="text-[10px] font-mono font-bold uppercase tracking-widest text-center py-2 rounded"
        style={{
          color: isReady ? HUD_ACCENT : HUD_RED,
          background: isReady ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${isReady ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
        }}
      >
        {isReady ? '● NODE READY' : '● NODE NOT READY'}
      </div>
    </SlideOutWrapper>
  );
}

// ── Flux Kustomization Detail ────────────────────────────────────────────────

interface FluxKustDetailProps {
  item: FluxKustomization;
  onClose: () => void;
  onRefresh: () => void;
}

export function FluxKustDetailSlideOut({ item, onClose, onRefresh }: FluxKustDetailProps) {
  const { showToast } = useToast();
  const isFailed = !item.ready && !item.suspended;

  const handleReconcile = useCallback(async () => {
    try {
      await triggerFluxReconcile(item.name, item.namespace, 'kustomization');
      showToast(`Reconcile triggered: ${item.name}`, 'success');
      onRefresh();
    } catch {
      showToast(`Failed to reconcile ${item.name}`, 'error');
    }
  }, [item.name, item.namespace, showToast, onRefresh]);

  return (
    <SlideOutWrapper
      title={item.name}
      subtitle={`Kustomization · ${item.namespace}`}
      onClose={onClose}
    >
      {/* Status */}
      <div>
        <HudSectionHeader>Status</HudSectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <HudLabel>Ready</HudLabel>
            <HudValue color={item.ready ? HUD_ACCENT : item.suspended ? HUD_AMBER : HUD_RED}>
              {item.suspended ? 'SUSPENDED' : item.ready ? 'READY' : 'FAILED'}
            </HudValue>
          </div>
          <div>
            <HudLabel>Namespace</HudLabel>
            <HudValue>{item.namespace}</HudValue>
          </div>
          <div>
            <HudLabel>Age</HudLabel>
            <HudValue>{item.age || '—'}</HudValue>
          </div>
          {item.revision && (
            <div className="col-span-2">
              <HudLabel>Revision</HudLabel>
              <HudValue>{item.revision}</HudValue>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {isFailed && item.lastMessage && (
        <div>
          <HudSectionHeader>Error</HudSectionHeader>
          <div
            className="text-[10px] font-mono p-3 rounded leading-relaxed"
            style={{
              color: HUD_RED,
              background: 'rgba(248,113,113,0.08)',
              border: `1px solid rgba(248,113,113,0.25)`,
              wordBreak: 'break-word',
            }}
          >
            {item.lastMessage}
          </div>
        </div>
      )}

      {/* Actions */}
      <div>
        <HudSectionHeader>Actions</HudSectionHeader>
        <button
          className="flex items-center gap-2 text-[10px] font-mono font-semibold uppercase tracking-wider px-4 py-2 rounded transition-all hover:opacity-80"
          style={{
            color: HUD_ACCENT,
            background: 'rgba(56,189,248,0.08)',
            border: `1px solid rgba(56,189,248,0.25)`,
          }}
          onClick={handleReconcile}
        >
          <RefreshCw className="w-3 h-3" />
          Force Reconcile
        </button>
      </div>
    </SlideOutWrapper>
  );
}

// ── Flux HelmRelease Detail ──────────────────────────────────────────────────

interface FluxHelmDetailProps {
  item: FluxHelmRelease;
  onClose: () => void;
  onRefresh: () => void;
}

export function FluxHelmDetailSlideOut({ item, onClose, onRefresh }: FluxHelmDetailProps) {
  const { showToast } = useToast();
  const isFailed = !item.ready && !item.suspended;

  const handleReconcile = useCallback(async () => {
    try {
      await triggerFluxReconcile(item.name, item.namespace, 'helmrelease');
      showToast(`Reconcile triggered: ${item.name}`, 'success');
      onRefresh();
    } catch {
      showToast(`Failed to reconcile ${item.name}`, 'error');
    }
  }, [item.name, item.namespace, showToast, onRefresh]);

  return (
    <SlideOutWrapper
      title={item.name}
      subtitle={`HelmRelease · ${item.namespace}`}
      onClose={onClose}
    >
      {/* Status */}
      <div>
        <HudSectionHeader>Status</HudSectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <HudLabel>Ready</HudLabel>
            <HudValue color={item.ready ? HUD_ACCENT : item.suspended ? HUD_AMBER : HUD_RED}>
              {item.suspended ? 'SUSPENDED' : item.ready ? 'READY' : 'FAILED'}
            </HudValue>
          </div>
          <div>
            <HudLabel>Namespace</HudLabel>
            <HudValue>{item.namespace}</HudValue>
          </div>
          {item.chart && (
            <div>
              <HudLabel>Chart</HudLabel>
              <HudValue>{item.chart}</HudValue>
            </div>
          )}
          {item.version && (
            <div>
              <HudLabel>Version</HudLabel>
              <HudValue>{item.version}</HudValue>
            </div>
          )}
          <div>
            <HudLabel>Age</HudLabel>
            <HudValue>{item.age || '—'}</HudValue>
          </div>
          {item.revision && (
            <div className="col-span-2">
              <HudLabel>Deployed Revision</HudLabel>
              <HudValue>{item.revision}</HudValue>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {isFailed && item.lastMessage && (
        <div>
          <HudSectionHeader>Error</HudSectionHeader>
          <div
            className="text-[10px] font-mono p-3 rounded leading-relaxed"
            style={{
              color: HUD_RED,
              background: 'rgba(248,113,113,0.08)',
              border: `1px solid rgba(248,113,113,0.25)`,
              wordBreak: 'break-word',
            }}
          >
            {item.lastMessage}
          </div>
        </div>
      )}

      {/* Actions */}
      <div>
        <HudSectionHeader>Actions</HudSectionHeader>
        <button
          className="flex items-center gap-2 text-[10px] font-mono font-semibold uppercase tracking-wider px-4 py-2 rounded transition-all hover:opacity-80"
          style={{
            color: HUD_ACCENT,
            background: 'rgba(56,189,248,0.08)',
            border: `1px solid rgba(56,189,248,0.25)`,
          }}
          onClick={handleReconcile}
        >
          <RefreshCw className="w-3 h-3" />
          Force Reconcile
        </button>
      </div>
    </SlideOutWrapper>
  );
}

// ── Service Detail ───────────────────────────────────────────────────────────

interface ServiceDetailProps {
  service: PlatformService;
  onClose: () => void;
}

export function ServiceDetailSlideOut({ service, onClose }: ServiceDetailProps) {
  return (
    <SlideOutWrapper
      title={service.name}
      subtitle={`Service · ${service.namespace}`}
      onClose={onClose}
    >
      <div>
        <HudSectionHeader>Status</HudSectionHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <HudLabel>Health</HudLabel>
            <HudValue color={service.healthy ? HUD_ACCENT : HUD_RED}>
              {service.healthy ? 'HEALTHY' : 'DEGRADED'}
            </HudValue>
          </div>
          <div>
            <HudLabel>Namespace</HudLabel>
            <HudValue>{service.namespace}</HudValue>
          </div>
          <div>
            <HudLabel>Pods</HudLabel>
            <HudValue>{service.podCount ?? 0} running</HudValue>
          </div>
        </div>
      </div>

      {service.description && (
        <div>
          <HudSectionHeader>Description</HudSectionHeader>
          <div className="text-[10px] font-mono leading-relaxed" style={{ color: '#e5e7eb' }}>
            {service.description}
          </div>
        </div>
      )}

      {service.url && (
        <div>
          <HudSectionHeader>Links</HudSectionHeader>
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono underline transition-opacity hover:opacity-70"
            style={{ color: HUD_ACCENT }}
          >
            {service.url}
          </a>
        </div>
      )}
    </SlideOutWrapper>
  );
}

