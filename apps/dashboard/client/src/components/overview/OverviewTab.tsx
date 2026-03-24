import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Server,
  AppWindow,
  Shield,
  Rocket,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { useAlerts } from '../../hooks/useAlerts';
import { fetchPipelineStats } from '../../api/pipeline';
import { fetchAuditEvents } from '../../api/audit';
import type { PipelineStats, AuditEvent } from '../../types/api';

interface HealthSummary {
  helmReleasesReady: number;
  helmReleasesTotal: number;
  nodesReady: number;
  nodesTotal: number;
  problemPodCount: number;
}

interface HealthData {
  helmReleases: unknown[];
  nodes: unknown[];
  problemPods: unknown[];
  summary: HealthSummary;
}

interface OverviewTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onSwitchTab: (tab: string) => void;
  onOpenApp: (url: string, title: string) => void;
}

export function OverviewTab({ user, onSwitchTab, onOpenApp }: OverviewTabProps) {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);
  const [appsCount, setAppsCount] = useState<{ running: number; deploying: number }>({ running: 0, deploying: 0 });
  const [loading, setLoading] = useState(true);
  const { alerts, criticalCount, warningCount } = useAlerts();
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [healthResp, appsResp, statsData, auditData] = await Promise.all([
        fetch('/api/health').then((r) => r.json()),
        fetch('/api/apps', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ apps: [] })),
        fetchPipelineStats().catch(() => null),
        fetchAuditEvents().catch(() => []),
      ]);
      setHealthData(healthResp);
      const apps = appsResp.apps || [];
      setAppsCount({
        running: apps.filter((a: { ready: boolean }) => a.ready).length,
        deploying: apps.filter((a: { ready: boolean }) => !a.ready).length,
      });
      setPipelineStats(statsData);
      setRecentEvents((auditData || []).slice(0, 10));
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  const summary = healthData?.summary;
  const isIssm = user.role === 'issm' || user.isAdmin;

  const userName = user.email
    ? user.email.split('@')[0]
    : user.user !== 'anonymous'
    ? user.user
    : '';

  return (
    <div>
      {/* Welcome Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-bright mb-1">
          Welcome to SRE Platform
        </h1>
        {userName && (
          <p className="text-sm text-text-dim">
            Signed in as {user.email || user.user}
            {user.role !== 'anonymous' && (
              <span className="ml-2 text-xs text-accent">({user.role})</span>
            )}
          </p>
        )}
      </div>

      {/* Admin Banner */}
      {user.isAdmin && (
        <div className="flex items-center justify-between bg-[rgba(99,102,241,0.1)] border border-[rgba(99,102,241,0.3)] rounded-lg px-4 py-3 mb-5">
          <span className="text-[13px] text-accent flex items-center gap-2">
            <Settings className="w-4 h-4" />
            You have administrator access
          </span>
          <button className="btn text-xs" onClick={() => onSwitchTab('admin')}>
            Manage Users &amp; Credentials
          </button>
        </div>
      )}

      {/* Health Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Platform Health */}
        <div
          className="bg-card border border-border rounded-[var(--radius)] p-5 cursor-pointer hover:border-border-hover transition-colors"
          onClick={() => onSwitchTab('operations')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-text-dim" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">
              Platform Health
            </h3>
          </div>
          {loading || !summary ? (
            <div className="text-3xl font-bold font-mono text-text-dim">--</div>
          ) : (
            <div
              className={`text-3xl font-bold font-mono ${
                summary.helmReleasesReady === summary.helmReleasesTotal
                  ? 'text-green'
                  : 'text-red'
              }`}
            >
              {summary.helmReleasesReady}/{summary.helmReleasesTotal}
            </div>
          )}
          <div className="text-[11px] text-text-dim mt-1">services ready</div>
        </div>

        {/* Applications */}
        <div
          className="bg-card border border-border rounded-[var(--radius)] p-5 cursor-pointer hover:border-border-hover transition-colors"
          onClick={() => onSwitchTab('applications')}
        >
          <div className="flex items-center gap-2 mb-2">
            <AppWindow className="w-4 h-4 text-text-dim" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">
              Applications
            </h3>
          </div>
          {loading ? (
            <div className="text-3xl font-bold font-mono text-text-dim">--</div>
          ) : (
            <div className="text-3xl font-bold font-mono text-text-primary">
              {appsCount.running}
            </div>
          )}
          <div className="text-[11px] text-text-dim mt-1">
            running{appsCount.deploying > 0 ? `, ${appsCount.deploying} deploying` : ''}
          </div>
        </div>

        {/* Security */}
        <div
          className="bg-card border border-border rounded-[var(--radius)] p-5 cursor-pointer hover:border-border-hover transition-colors"
          onClick={() => onSwitchTab('security')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-text-dim" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">
              Security
            </h3>
          </div>
          {loading || !pipelineStats ? (
            <div className="text-3xl font-bold font-mono text-text-dim">--</div>
          ) : (
            <div
              className={`text-3xl font-bold font-mono ${
                pipelineStats.review_pending > 0 ? 'text-yellow' : 'text-green'
              }`}
            >
              {pipelineStats.review_pending}
            </div>
          )}
          <div className="text-[11px] text-text-dim mt-1">pending reviews</div>
        </div>

        {/* Cluster */}
        <div
          className="bg-card border border-border rounded-[var(--radius)] p-5 cursor-pointer hover:border-border-hover transition-colors"
          onClick={() => onSwitchTab('operations')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Server className="w-4 h-4 text-text-dim" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim">
              Cluster
            </h3>
          </div>
          {loading || !summary ? (
            <div className="text-3xl font-bold font-mono text-text-dim">--</div>
          ) : (
            <div
              className={`text-3xl font-bold font-mono ${
                summary.nodesReady === summary.nodesTotal ? 'text-green' : 'text-red'
              }`}
            >
              {summary.nodesReady}/{summary.nodesTotal}
            </div>
          )}
          <div className="text-[11px] text-text-dim mt-1">nodes ready</div>
        </div>
      </div>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6">
          <div
            className={`flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer ${
              criticalCount > 0
                ? 'bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.3)]'
                : 'bg-[rgba(234,179,8,0.1)] border-[rgba(234,179,8,0.3)]'
            }`}
            onClick={() => setAlertsExpanded(!alertsExpanded)}
          >
            <span
              className="flex items-center gap-2 text-[13px] font-medium"
              style={{ color: criticalCount > 0 ? 'var(--red)' : 'var(--yellow)' }}
            >
              <AlertTriangle className="w-4 h-4" />
              {criticalCount > 0 && `${criticalCount} critical`}
              {criticalCount > 0 && warningCount > 0 && ', '}
              {warningCount > 0 && `${warningCount} warning`}
              {' '}alert{alerts.length !== 1 ? 's' : ''} active
            </span>
            {alertsExpanded ? (
              <ChevronUp className="w-4 h-4 text-text-dim" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-dim" />
            )}
          </div>
          {alertsExpanded && (
            <div className="mt-2 bg-card border border-border rounded-[var(--radius)] p-3">
              <table className="w-full text-xs">
                <tbody>
                  {alerts.map((alert, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td
                        className="py-1.5 pr-3 font-medium"
                        style={{
                          color:
                            alert.severity === 'critical'
                              ? 'var(--red)'
                              : 'var(--yellow)',
                        }}
                      >
                        {alert.severity}
                      </td>
                      <td className="py-1.5 pr-3 text-text-primary font-medium">
                        {alert.name || alert.alertname || 'Alert'}
                      </td>
                      <td className="py-1.5 text-text-dim">
                        {alert.message || alert.summary || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn btn-primary text-[13px] !px-5 flex items-center gap-1.5"
            onClick={() => onSwitchTab('deploy')}
          >
            <Rocket className="w-4 h-4" />
            Deploy App
          </button>
          {isIssm && pipelineStats && pipelineStats.review_pending > 0 && (
            <button
              className="btn text-[13px] !px-5 flex items-center gap-1.5 border-yellow text-yellow hover:bg-yellow/10"
              onClick={() => onSwitchTab('security')}
            >
              <Shield className="w-4 h-4" />
              View Reviews ({pipelineStats.review_pending})
            </button>
          )}
          <button
            className="btn text-[13px] !px-5 flex items-center gap-1.5"
            onClick={() =>
              onOpenApp(
                'https://grafana.apps.sre.example.com',
                'Grafana'
              )
            }
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Grafana
          </button>
          <button
            className="btn text-[13px] !px-5 flex items-center gap-1.5"
            onClick={() =>
              onOpenApp(
                'https://harbor.apps.sre.example.com',
                'Harbor'
              )
            }
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Harbor
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Recent Activity
        </h2>
        <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
          {recentEvents.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-dim text-sm">
              No recent activity
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">
                      Time
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">
                      Namespace
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">
                      Resource
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">
                      Message
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event, idx) => {
                    const ts = event.timestamp
                      ? new Date(event.timestamp).toLocaleString()
                      : 'N/A';
                    const isWarning = event.type === 'Warning';
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-border last:border-0 hover:bg-surface/50 transition-colors ${
                          isWarning ? 'bg-yellow/5' : ''
                        }`}
                      >
                        <td className="px-4 py-2 text-xs text-text-dim whitespace-nowrap">
                          {ts}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-dim">
                          {event.namespace}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-primary truncate max-w-[200px]">
                          {event.kind}/{event.name}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-primary truncate max-w-[300px]">
                          {event.message}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                              isWarning
                                ? 'bg-yellow/15 text-yellow'
                                : 'bg-green/15 text-green'
                            }`}
                          >
                            {event.type}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
