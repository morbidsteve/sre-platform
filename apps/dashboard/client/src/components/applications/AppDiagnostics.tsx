import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, AlertTriangle, CheckCircle2, XCircle, Zap,
  Activity, Clock, Terminal, BarChart3, ExternalLink, Shield,
} from 'lucide-react';
import { useConfig, serviceUrl } from '../../context/ConfigContext';

interface DiagContainer {
  name: string;
  ready: boolean;
  state: string;
  reason: string;
  message: string;
  restartCount: number;
}

interface DiagPod {
  name: string;
  phase: string;
  ready: boolean;
  restartCount: number;
  containers: DiagContainer[];
  cpuUsed: string | null;
  memUsed: string | null;
}

interface DiagEvent {
  type: string;
  reason: string;
  message: string;
  age: string;
  source: string;
}

interface DiagPolicyViolation {
  policy: string;
  message: string;
  fix: string;
  time: string;
}

interface DiagResources {
  cpu: { requested: string; limit: string; used: string | null };
  memory: { requested: string; limit: string; used: string | null };
}

interface DiagProbe {
  configured: boolean;
  path: string | null;
  passing: boolean | null;
  lastFailure: string | null;
}

interface DiagSuggestedAction {
  priority: number;
  action: string;
  reason: string;
}

interface DiagnosticsData {
  app: { name: string; namespace: string; image: string; tag: string };
  helmRelease: {
    ready: boolean;
    reason: string;
    message: string;
    lastTransition: string;
    installFailures: number;
    upgradeFailures: number;
  } | null;
  pods: DiagPod[];
  recentEvents: DiagEvent[];
  recentLogs: string[];
  policyViolations: DiagPolicyViolation[];
  resources: DiagResources | null;
  probes: { liveness: DiagProbe; readiness: DiagProbe } | null;
  suggestedActions: DiagSuggestedAction[];
}

interface AppDiagnosticsProps {
  namespace: string;
  name: string;
  onClose: () => void;
}

function ResourceBar({ label, used, limit }: { label: string; used: string | null; limit: string }) {
  // Very rough usage estimation for bar display (numeric parse not available in TS)
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-text-dim">{label}</span>
        <span className="font-mono text-text-primary">
          {used ? `${used} / ${limit}` : `req — / limit ${limit}`}
        </span>
      </div>
      <div className="h-1.5 bg-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: used ? '40%' : '10%' }}
        />
      </div>
    </div>
  );
}

export function AppDiagnostics({ namespace, name, onClose }: AppDiagnosticsProps) {
  const config = useConfig();
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/apps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/diagnostics`
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const d: DiagnosticsData = await resp.json();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, [namespace, name]);

  useEffect(() => {
    load();
  }, [load]);

  const grafanaUrl = `${serviceUrl(config, 'grafana')}/explore?orgId=1&left=%7B%22datasource%22:%22loki%22,%22queries%22:%5B%7B%22expr%22:%22%7Bnamespace%3D%5C%22${encodeURIComponent(namespace)}%5C%22%7D%22%7D%5D%7D`;

  return (
    <div
      className="fixed inset-0 z-[300] flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
    >
      {/* Slide-out panel from right */}
      <div
        className="ml-auto w-full max-w-xl h-full bg-card border-l border-border flex flex-col overflow-hidden"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text-bright">
              Diagnostics: <span className="font-mono">{name}</span>
            </h3>
            <span className="text-[11px] text-text-dim font-mono">({namespace})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn text-[11px] !px-2 !py-1 !min-h-0 flex items-center gap-1"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <Loader2 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button onClick={onClose} className="text-text-dim hover:text-text-primary">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && !data && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded bg-red/10 border border-red/20 text-red text-sm">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* App info */}
              <div className="text-[11px] font-mono text-text-dim truncate">
                {data.app.image && `${data.app.image}:${data.app.tag}`}
              </div>

              {/* ── Suggested Actions ─────────────────────────────── */}
              {data.suggestedActions.length > 0 && (
                <section>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-bright mb-2">
                    <Zap className="w-3.5 h-3.5 text-yellow" />
                    Suggested Actions
                  </h4>
                  <div className="space-y-2">
                    {data.suggestedActions.map((a, i) => (
                      <div
                        key={i}
                        className={`rounded border px-3 py-2 ${
                          a.priority === 1
                            ? 'border-red/30 bg-red/5'
                            : a.priority === 2
                            ? 'border-yellow/30 bg-yellow/5'
                            : 'border-border bg-surface'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            a.priority === 1 ? 'bg-red/20 text-red' :
                            a.priority === 2 ? 'bg-yellow/20 text-yellow' :
                            'bg-accent/20 text-accent'
                          }`}>
                            #{i + 1}
                          </span>
                          <div>
                            <div className="text-xs text-text-primary font-semibold">{a.action}</div>
                            <div className="text-[11px] text-text-dim mt-0.5 leading-relaxed">{a.reason}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── HelmRelease Status ─────────────────────────────── */}
              {data.helmRelease && (
                <section>
                  <h4 className="text-xs font-semibold text-text-bright mb-2 flex items-center gap-1.5">
                    {data.helmRelease.ready ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red" />
                    )}
                    HelmRelease
                  </h4>
                  <div className="text-[11px] font-mono text-text-dim bg-surface rounded border border-border px-3 py-2">
                    <div className="flex gap-4 mb-1">
                      <span>
                        Status:{' '}
                        <span className={data.helmRelease.ready ? 'text-green' : 'text-red'}>
                          {data.helmRelease.ready ? 'Ready' : data.helmRelease.reason || 'Not Ready'}
                        </span>
                      </span>
                      {data.helmRelease.installFailures > 0 && (
                        <span className="text-yellow">Failures: {data.helmRelease.installFailures}</span>
                      )}
                    </div>
                    {data.helmRelease.message && (
                      <div className="text-text-dim leading-relaxed break-all">
                        {data.helmRelease.message.substring(0, 300)}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── Pod Status ─────────────────────────────────────── */}
              {data.pods.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-text-bright mb-2">
                    Pod Status ({data.pods.length})
                  </h4>
                  <div className="space-y-1.5">
                    {data.pods.map((pod) => {
                      const failing = pod.containers.find((c) =>
                        c.reason === 'CrashLoopBackOff' || c.reason === 'OOMKilled' ||
                        c.reason === 'ImagePullBackOff' || c.reason === 'ErrImagePull'
                      );
                      return (
                        <div
                          key={pod.name}
                          className={`rounded border px-3 py-2 text-[11px] font-mono ${
                            pod.ready
                              ? 'border-green/20 bg-green/5'
                              : failing
                              ? 'border-red/20 bg-red/5'
                              : 'border-border bg-surface'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-text-primary truncate max-w-[240px]">{pod.name}</span>
                            <div className="flex items-center gap-2 text-text-dim flex-shrink-0">
                              {pod.restartCount > 0 && (
                                <span className="text-yellow">{pod.restartCount} restarts</span>
                              )}
                              <span className={
                                pod.phase === 'Running' ? 'text-green' :
                                pod.phase === 'Failed' ? 'text-red' :
                                'text-yellow'
                              }>{pod.phase}</span>
                            </div>
                          </div>
                          {failing && (
                            <div className="mt-1 text-red">
                              {failing.reason}{failing.message && `: ${failing.message.substring(0, 100)}`}
                            </div>
                          )}
                          {(pod.cpuUsed || pod.memUsed) && (
                            <div className="mt-1 text-text-dim">
                              {pod.cpuUsed && `CPU ${pod.cpuUsed}`}{pod.memUsed && ` · Mem ${pod.memUsed}`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Policy Violations ─────────────────────────────── */}
              {data.policyViolations.length > 0 && (
                <section>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-bright mb-2">
                    <Shield className="w-3.5 h-3.5 text-red" />
                    Policy Violations ({data.policyViolations.length})
                  </h4>
                  <div className="space-y-2">
                    {data.policyViolations.map((pv, i) => (
                      <div key={i} className="rounded border border-red/20 bg-red/5 px-3 py-2">
                        <div className="text-[11px] font-mono text-red font-semibold">{pv.policy}</div>
                        <div className="text-[11px] text-text-dim mt-0.5 leading-relaxed">
                          {pv.message.substring(0, 200)}
                        </div>
                        {pv.fix && (
                          <div className="mt-1.5 text-[11px] font-mono bg-bg rounded px-2 py-1.5 text-text-primary leading-relaxed">
                            Fix: {pv.fix}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Recent Events ─────────────────────────────────── */}
              {data.recentEvents.length > 0 && (
                <section>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-bright mb-2">
                    <Clock className="w-3.5 h-3.5" />
                    Recent Events
                  </h4>
                  <div className="space-y-1">
                    {data.recentEvents.map((ev, i) => (
                      <div
                        key={i}
                        className={`text-[11px] font-mono flex gap-2 px-2 py-1 rounded ${
                          ev.type === 'Warning' ? 'bg-yellow/5 text-yellow' : 'bg-surface text-text-dim'
                        }`}
                      >
                        <span className="flex-shrink-0">{ev.age}</span>
                        <span className="flex-shrink-0 font-semibold">{ev.reason}</span>
                        <span className="leading-relaxed break-words min-w-0">{ev.message.substring(0, 150)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Recent Logs ───────────────────────────────────── */}
              {data.recentLogs.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-bright">
                      <Terminal className="w-3.5 h-3.5" />
                      Recent Logs (last {data.recentLogs.length} lines)
                    </h4>
                    <button
                      className="text-[11px] text-accent hover:underline"
                      onClick={() => setLogsExpanded((e) => !e)}
                    >
                      {logsExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                  <pre
                    className={`text-[10px] font-mono bg-bg border border-border rounded px-3 py-2 overflow-x-auto text-text-dim leading-relaxed ${
                      logsExpanded ? '' : 'max-h-32 overflow-y-hidden'
                    }`}
                  >
                    {data.recentLogs.join('\n')}
                  </pre>
                </section>
              )}

              {/* ── Resources ─────────────────────────────────────── */}
              {data.resources && (
                <section>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-text-bright mb-2">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Resources
                  </h4>
                  <div className="bg-surface border border-border rounded px-3 py-2">
                    <ResourceBar
                      label="CPU"
                      used={data.resources.cpu.used}
                      limit={data.resources.cpu.limit}
                    />
                    <ResourceBar
                      label="Memory"
                      used={data.resources.memory.used}
                      limit={data.resources.memory.limit}
                    />
                  </div>
                </section>
              )}

              {/* ── Probes ────────────────────────────────────────── */}
              {data.probes && (
                <section>
                  <h4 className="text-xs font-semibold text-text-bright mb-2">Probes</h4>
                  <div className="space-y-1.5 text-[11px]">
                    {[
                      { label: 'Liveness', probe: data.probes.liveness },
                      { label: 'Readiness', probe: data.probes.readiness },
                    ].map(({ label, probe }) => (
                      <div key={label} className="flex items-start gap-2 font-mono">
                        {probe.configured ? (
                          probe.passing === false ? (
                            <XCircle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green flex-shrink-0 mt-0.5" />
                          )
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-text-dim flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="text-text-primary">{label}:</span>{' '}
                          {probe.configured ? (
                            <>
                              <span className="text-text-dim">{probe.path}</span>
                              {probe.passing === false && probe.lastFailure && (
                                <div className="text-red mt-0.5">{probe.lastFailure.substring(0, 100)}</div>
                              )}
                              {probe.passing === null && (
                                <span className="text-text-dim ml-1">(status unknown)</span>
                              )}
                            </>
                          ) : (
                            <span className="text-text-dim">not configured</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border flex-shrink-0">
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn text-xs !px-2.5 !py-1.5 !min-h-0 flex items-center gap-1.5 no-underline"
          >
            <BarChart3 className="w-3 h-3" />
            Full Logs in Grafana
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {data?.policyViolations && data.policyViolations.length > 0 && (
            <a
              href="https://github.com/morbidsteve/sre-platform/tree/main/policies/custom/policy-exceptions"
              target="_blank"
              rel="noopener noreferrer"
              className="btn text-xs !px-2.5 !py-1.5 !min-h-0 flex items-center gap-1.5 no-underline"
            >
              <Shield className="w-3 h-3" />
              Request Exception
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
