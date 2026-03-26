import React, { useState, useCallback } from 'react';
import { Shield, Rocket, Box, Database, ChevronLeft } from 'lucide-react';
import { useConfig, serviceUrl } from '../../context/ConfigContext';
import { useToast } from '../../context/ToastContext';
import { QuickStartPanel } from '../applications/QuickStartPanel';
import { HelmDeployForm } from '../applications/HelmDeployForm';
import { DatabaseForm } from '../applications/DatabaseForm';
import { DeployProgress } from '../applications/DeployProgress';
import { SecurityContextSection } from './SecurityContextSection';
import { ComplianceGateResult } from './ComplianceGateResult';
import type { SecurityContextOptions } from '../../types/api';

interface ComplianceBlocker {
  check: string;
  severity: string;
  message: string;
}

interface ComplianceCheck {
  check: string;
  status: string;
  message: string;
}

interface ComplianceGateResponse {
  blockers: ComplianceBlocker[];
  warnings: ComplianceCheck[];
  checks: ComplianceCheck[];
  error: string;
}

type DeployMethod = 'none' | 'dsop' | 'quick' | 'helm' | 'database';

interface DeployItem {
  name: string;
  team: string;
  image: string;
  tag: string;
  port: number;
  replicas: number;
  ingress: string;
}

interface DeployTabProps {
  user: { user: string; email: string; role: string; isAdmin: boolean };
  onOpenApp: (url: string, title: string) => void;
}

const DEPLOY_METHODS = [
  {
    id: 'dsop' as const,
    label: 'DSOP Security Pipeline',
    description: 'Full guided deployment with security gates, scanning, SBOM, and ISSM review',
    icon: Shield,
    recommended: true,
  },
  {
    id: 'quick' as const,
    label: 'Quick Deploy',
    description: 'Deploy a pre-built sample image with one click',
    icon: Rocket,
    recommended: false,
  },
  {
    id: 'helm' as const,
    label: 'Helm Chart',
    description: 'Deploy any Helm chart from a public or private chart repository',
    icon: Box,
    recommended: false,
  },
  {
    id: 'database' as const,
    label: 'Database',
    description: 'Provision a managed PostgreSQL database via CloudNativePG',
    icon: Database,
    recommended: false,
  },
];

export function DeployTab({ user, onOpenApp }: DeployTabProps) {
  const config = useConfig();
  const { showToast } = useToast();
  const [method, setMethod] = useState<DeployMethod>('none');
  const [deployItems, setDeployItems] = useState<DeployItem[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  const [securityContext, setSecurityContext] = useState<SecurityContextOptions>({});
  const [complianceResult, setComplianceResult] = useState<ComplianceGateResponse | null>(null);

  const handleOpenDsopWizard = useCallback(() => {
    // Append timestamp to force a fresh wizard session (no cached state from previous run)
    onOpenApp(`${serviceUrl(config, 'dsop')}?new=${Date.now()}`, 'DSOP Security Pipeline');
  }, [onOpenApp, config]);

  const handleQuickDeploy = useCallback(async (item: DeployItem) => {
    setComplianceResult(null);
    const hasSecCtx = securityContext.runAsRoot || securityContext.writableFilesystem ||
      securityContext.allowPrivilegeEscalation || (securityContext.capabilities && securityContext.capabilities.length > 0);
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
          ...(hasSecCtx ? { securityContext } : {}),
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        if (data.blockers && data.blockers.length > 0) {
          setComplianceResult(data as ComplianceGateResponse);
        } else {
          showToast(`Deploy failed: ${data.error || 'Unknown error'}`, 'error');
        }
        return;
      }
      setDeployItems([item]);
      setShowProgress(true);
      showToast(`Deploying ${item.name} to ${item.team}...`, 'info');
    } catch (err) {
      showToast(`Deploy error: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
    }
  }, [securityContext, showToast]);

  const handleHelmDeploy = useCallback(async (payload: {
    repoUrl: string;
    chartName: string;
    version: string;
    releaseName: string;
    team: string;
    values: string;
  }) => {
    const hasSecCtx = securityContext.runAsRoot || securityContext.writableFilesystem ||
      securityContext.allowPrivilegeEscalation || (securityContext.capabilities && securityContext.capabilities.length > 0);
    try {
      const resp = await fetch('/api/deploy/helm-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(hasSecCtx ? { securityContext } : {}),
        }),
      });
      if (resp.status === 400) {
        showToast('Invalid YAML in values field. Check syntax.', 'error');
        return;
      }
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
        showToast('Helm release created. Flux will reconcile shortly.', 'success');
      } else {
        showToast(`Helm deploy failed: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Helm deploy failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
    }
  }, [securityContext, showToast]);

  const handleCreateDatabase = useCallback(async (payload: {
    name: string;
    team: string;
    storage: string;
    instances: number;
  }) => {
    try {
      const resp = await fetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (resp.ok && data.success !== false) {
        showToast('Database provisioning started.', 'success');
      } else {
        showToast(`Database creation failed: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Database creation failed: ${err instanceof Error ? err.message : 'Network error'}`, 'error');
    }
  }, [showToast]);

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-bright mb-1">Deploy to SRE Platform</h2>
        <p className="text-text-dim text-[13px]">
          Choose a deployment method to get your application running on the platform.
        </p>
      </div>

      {/* Deploy Progress */}
      <DeployProgress
        items={deployItems}
        visible={showProgress}
        onDismiss={() => {
          setShowProgress(false);
          setDeployItems([]);
        }}
      />

      {/* Compliance Gate Result */}
      {complianceResult && (
        <ComplianceGateResult
          result={complianceResult}
          onDismiss={() => setComplianceResult(null)}
        />
      )}

      {/* Method Selector */}
      {method === 'none' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DEPLOY_METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className={`bg-card border rounded-xl p-5 cursor-pointer transition-all hover:border-border-hover hover:bg-surface-hover ${
                  m.recommended
                    ? 'border-2 border-accent'
                    : 'border border-border'
                }`}
                onClick={() => {
                  if (m.id === 'dsop') {
                    handleOpenDsopWizard();
                  } else {
                    setMethod(m.id);
                  }
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-surface rounded-lg">
                    <Icon className={`w-5 h-5 ${m.recommended ? 'text-accent' : 'text-text-dim'}`} />
                  </div>
                  {m.recommended && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded">
                      Recommended
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-text-bright mb-1">{m.label}</h3>
                <p className="text-xs text-text-dim">{m.description}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Method Panel */}
      {method !== 'none' && (
        <div>
          <button
            className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1 mb-4"
            onClick={() => setMethod('none')}
          >
            <ChevronLeft className="w-3 h-3" />
            Back to methods
          </button>

          {method === 'quick' && (
            <>
              <QuickStartPanel onDeploy={handleQuickDeploy} />
              <div className="mt-4">
                <SecurityContextSection value={securityContext} onChange={setSecurityContext} />
              </div>
            </>
          )}
          {method === 'helm' && (
            <>
              <HelmDeployForm onDeploy={handleHelmDeploy} />
              <div className="mt-4">
                <SecurityContextSection value={securityContext} onChange={setSecurityContext} />
              </div>
            </>
          )}
          {method === 'database' && <DatabaseForm onCreateDatabase={handleCreateDatabase} />}
        </div>
      )}
    </div>
  );
}
