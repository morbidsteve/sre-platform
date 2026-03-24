import React, { useEffect, useState, useCallback } from 'react';
import { PortalAppsGrid } from './PortalAppsGrid';
import { SummaryCards } from './SummaryCards';
import { HelmReleaseTable } from './HelmReleaseTable';
import { ProblemPodsPanel } from './ProblemPodsPanel';
import { Settings } from 'lucide-react';

interface HealthSummary {
  helmReleasesReady: number;
  helmReleasesTotal: number;
  nodesReady: number;
  nodesTotal: number;
  problemPodCount: number;
}

interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  version: string;
  ready: boolean;
}

interface NodeInfo {
  name: string;
  roles: string;
  ip: string;
  version: string;
  ready: boolean;
}

interface ProblemPod {
  name: string;
  namespace: string;
  phase: string;
  reason: string;
  message: string;
  restarts: number;
  age: string;
  ownerKind?: string;
  ownerName?: string;
}

interface HealthData {
  helmReleases: HelmRelease[];
  nodes: NodeInfo[];
  problemPods: ProblemPod[];
  summary: HealthSummary;
}

interface DashboardTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onSwitchTab: (tab: string) => void;
  onOpenApp: (url: string, title: string) => void;
}

export function DashboardTab({ user, onSwitchTab, onOpenApp }: DashboardTabProps) {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProblemPods, setShowProblemPods] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      const resp = await fetch('/api/health');
      const data: HealthData = await resp.json();
      setHealthData(data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const timer = setInterval(loadHealth, 30000);
    return () => clearInterval(timer);
  }, [loadHealth]);

  const handleViewLogs = (namespace: string, podName: string) => {
    // Navigate to cluster tab logs panel
    onSwitchTab('cluster');
  };

  const handleDeletePod = async (namespace: string, podName: string) => {
    if (!confirm(`Delete pod ${podName} in ${namespace}? If owned by a controller, it will be recreated.`)) {
      return;
    }
    try {
      const resp = await fetch(
        `/api/cluster/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}`,
        { method: 'DELETE' }
      );
      if (resp.ok) {
        loadHealth();
      }
    } catch {
      // handle silently
    }
  };

  const userName = user.email
    ? user.email.split('@')[0]
    : user.user !== 'anonymous'
    ? user.user
    : '';

  return (
    <div>
      {/* Welcome Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-bright mb-1">Welcome to SRE Platform</h1>
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
          <button
            className="btn text-xs"
            onClick={() => onSwitchTab('admin')}
          >
            Manage Users &amp; Credentials
          </button>
        </div>
      )}

      {/* Your Applications */}
      <h2 className="text-[16px] font-semibold mb-4 uppercase tracking-[1px] text-text-dim">
        Your Applications
      </h2>
      <PortalAppsGrid onOpenApp={onOpenApp} />

      {/* Platform Overview */}
      <div className="mt-8 border-t border-border pt-6">
        <h2 className="text-[16px] font-semibold mb-4 uppercase tracking-[1px] text-text-dim">
          Platform Overview
        </h2>

        <SummaryCards
          summary={healthData?.summary ?? null}
          loading={loading}
          onProblemPodsClick={() => setShowProblemPods(!showProblemPods)}
        />

        <div className="mt-4">
          <ProblemPodsPanel
            pods={healthData?.problemPods ?? []}
            visible={showProblemPods}
            isAdmin={user.isAdmin}
            onViewLogs={handleViewLogs}
            onDeletePod={handleDeletePod}
          />
        </div>

        <div className="mt-4">
          <HelmReleaseTable
            helmReleases={healthData?.helmReleases ?? []}
            loading={loading}
          />
        </div>

        <div className="mt-4">
          <NodesTable nodes={healthData?.nodes ?? []} loading={loading} />
        </div>
      </div>
    </div>
  );
}

/* Inline NodesTable component - keeps DashboardTab self-contained */
function NodesTable({ nodes, loading }: { nodes: NodeInfo[]; loading: boolean }) {
  return (
    <div className="bg-card border border-border rounded-[var(--radius)] overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-bright">Nodes</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Status</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Name</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Role</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">IP</th>
              <th className="px-4 py-2 text-left text-xs font-mono uppercase tracking-wider text-text-dim">Version</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <span className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </td>
              </tr>
            ) : nodes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-dim">
                  No nodes found
                </td>
              </tr>
            ) : (
              nodes.map((n) => (
                <tr key={n.name} className="border-b border-border last:border-b-0 hover:bg-surface-hover transition-colors">
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                      n.ready
                        ? 'bg-[rgba(64,192,87,0.15)] text-green'
                        : 'bg-[rgba(250,82,82,0.15)] text-red'
                    }`}>
                      {n.ready ? 'Ready' : 'NotReady'}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-semibold text-text-bright">{n.name}</td>
                  <td className="px-4 py-2 text-text-dim">{n.roles}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs bg-bg px-1.5 py-0.5 rounded font-mono">{n.ip}</code>
                  </td>
                  <td className="px-4 py-2 text-text-dim">{n.version}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
