import React, { useEffect, useState, useCallback } from 'react';
import { AppGallery } from './AppGallery';
import { DeploySection } from './DeploySection';
import { DeployProgress } from './DeployProgress';
import { Rocket } from 'lucide-react';

interface AppInfo {
  name: string;
  namespace: string;
  team?: string;
  image: string;
  tag: string;
  port?: number;
  host?: string;
  url?: string;
  ready: boolean;
  status?: string;
  _isPipelineRun?: boolean;
  _runId?: string;
  gates?: { short_name: string; gate_name: string; status: string }[];
  classification?: string;
  created_at?: string;
}

interface DeployItem {
  name: string;
  team: string;
  image: string;
  tag: string;
  port: number;
  replicas: number;
  ingress: string;
}

interface ApplicationsTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onOpenApp: (url: string, title: string) => void;
}

export function ApplicationsTab({ user, onOpenApp }: ApplicationsTabProps) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployItems, setDeployItems] = useState<DeployItem[]>([]);
  const [showProgress, setShowProgress] = useState(false);

  const canDeploy = user.role === 'admin' || user.role === 'developer' || user.role === 'issm';

  const loadApps = useCallback(async () => {
    try {
      const [appsResp, pipeResp] = await Promise.all([
        fetch('/api/apps', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/pipeline/active', { credentials: 'include' })
          .then((r) => r.json())
          .catch(() => ({ runs: [] })),
      ]);

      const deployedApps: AppInfo[] = appsResp.apps || [];
      const activeRuns = pipeResp.runs || [];

      const deployedNames = new Set(
        deployedApps.map((a: AppInfo) => `${a.team || a.namespace}/${a.name}`)
      );

      const pipelineCards: AppInfo[] = activeRuns
        .filter(
          (r: { team: string; app_name: string }) =>
            !deployedNames.has(`${r.team || ''}/${r.app_name}`)
        )
        .map(
          (r: {
            id: string;
            app_name: string;
            team: string;
            image_url?: string;
            git_url?: string;
            status: string;
            gates?: { short_name: string; gate_name: string; status: string }[];
            classification?: string;
            created_at?: string;
          }) => ({
            _isPipelineRun: true,
            _runId: r.id,
            name: r.app_name,
            namespace: r.team,
            team: r.team,
            ready: false,
            image: r.image_url || r.git_url || '',
            tag: '',
            port: undefined,
            host: '',
            url: '',
            status: r.status,
            gates: r.gates || [],
            classification: r.classification,
            created_at: r.created_at,
          })
        );

      setApps([...pipelineCards, ...deployedApps]);
    } catch {
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
    const timer = setInterval(loadApps, 8000);
    return () => clearInterval(timer);
  }, [loadApps]);

  const handleDelete = async (namespace: string, name: string) => {
    if (!confirm(`Delete ${name} from ${namespace}? This removes all pods, services, and resources.`)) {
      return;
    }
    try {
      const resp = await fetch(`/api/apps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        setApps((prev) => prev.filter((a) => !(a.namespace === namespace && a.name === name)));
        setTimeout(loadApps, 3000);
      }
    } catch {
      // handle silently
    }
  };

  const handleOpenService = (url: string) => {
    if (url.includes('dsop.apps.sre.example.com')) {
      onOpenApp(url, 'DSOP Security Pipeline');
      return;
    }
    if (url.includes('portal.apps.sre.example.com')) {
      onOpenApp(url, 'App Portal');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const handleOpenDsopWizard = () => {
    onOpenApp('https://dsop.apps.sre.example.com', 'DSOP Security Pipeline');
  };

  const handleQuickDeploy = async (item: DeployItem) => {
    setDeployItems([item]);
    setShowProgress(true);
    try {
      const resp = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name,
          team: item.team,
          image: item.image,
          tag: item.tag,
          port: item.port,
          replicas: item.replicas,
          ingress: item.ingress,
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        console.error('Deploy failed:', data.error);
      }
    } catch (err) {
      console.error('Deploy error:', err);
    }
    setTimeout(loadApps, 3000);
  };

  const handleHelmDeploy = async (payload: {
    repoUrl: string;
    chartName: string;
    version: string;
    releaseName: string;
    team: string;
    values: string;
  }) => {
    try {
      const resp = await fetch('/api/deploy/helm-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.success) {
        setDeployItems([
          {
            name: payload.releaseName,
            team: payload.team,
            image: payload.chartName,
            tag: payload.version || 'latest',
            port: 0,
            replicas: 1,
            ingress: '',
          },
        ]);
        setShowProgress(true);
      }
    } catch {
      // handle silently
    }
    setTimeout(loadApps, 3000);
  };

  const handleCreateDatabase = async (payload: {
    name: string;
    team: string;
    storage: string;
    instances: number;
  }) => {
    try {
      await fetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // handle silently
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright mb-1">Applications</h2>
          <p className="text-text-dim text-[13px]">
            Manage and deploy applications on the SRE Platform.
          </p>
        </div>
        {canDeploy && (
          <button
            className="btn btn-primary text-[13px] !px-5"
            onClick={handleOpenDsopWizard}
          >
            <Rocket className="w-4 h-4 inline-block mr-1" />
            Deploy New App
          </button>
        )}
      </div>

      {/* App Gallery */}
      <AppGallery
        apps={apps}
        loading={loading}
        isAdmin={user.isAdmin}
        onRefresh={loadApps}
        onDelete={handleDelete}
        onOpenService={handleOpenService}
        onOpenDsopWizard={handleOpenDsopWizard}
      />

      {/* Deploy Progress */}
      <DeployProgress
        items={deployItems}
        visible={showProgress}
        onDismiss={() => {
          setShowProgress(false);
          setDeployItems([]);
        }}
      />

      {/* Deploy Section */}
      <DeploySection
        visible={showDeploy}
        onClose={() => setShowDeploy(false)}
        onOpenDsopWizard={handleOpenDsopWizard}
        onQuickDeploy={handleQuickDeploy}
        onHelmDeploy={handleHelmDeploy}
        onCreateDatabase={handleCreateDatabase}
      />
    </div>
  );
}
