import React, { useState, useCallback, useRef } from 'react';
import { Shield, Rocket, Box, Database, ChevronLeft, CheckCircle2, XCircle, Loader2, AlertTriangle, Play } from 'lucide-react';
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

interface ImageCheckResult {
  exists: boolean;
  digest?: string | null;
  scanned?: boolean;
  scanStatus?: string;
  vulnerabilities?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  reason?: string;
}

interface PreflightViolation {
  policy: string;
  message: string;
  fix: string;
}

interface PreflightResult {
  passed: boolean;
  violations: PreflightViolation[];
  warnings: Array<{ type: string; message: string }>;
  resourceQuota: {
    cpuAvailable: string;
    cpuRequested: string;
    memoryAvailable: string;
    memoryRequested: string;
    withinQuota: boolean;
  } | null;
}

type DeployMethod = 'none' | 'dsop' | 'quick' | 'helm' | 'database';
type ImageCheckStatus = 'unchecked' | 'checking' | 'found' | 'not_found' | 'error';
type PreflightStatus = 'idle' | 'running' | 'passed' | 'failed';

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
    description: 'Deploy a pre-built sample image or your own Harbor image',
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

// ── Custom Image Deploy Form ─────────────────────────────────────────────────
interface CustomImageFormProps {
  onDeploy: (item: DeployItem) => Promise<void>;
  securityContext: SecurityContextOptions;
}

function CustomImageForm({ onDeploy, securityContext }: CustomImageFormProps) {
  const config = useConfig();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [team, setTeam] = useState('demo');
  const [image, setImage] = useState('');
  const [tag, setTag] = useState('');
  const [port, setPort] = useState(8080);
  const [ingress, setIngress] = useState('');

  const [imageStatus, setImageStatus] = useState<ImageCheckStatus>('unchecked');
  const [imageCheckResult, setImageCheckResult] = useState<ImageCheckResult | null>(null);

  const [preflightStatus, setPreflightStatus] = useState<PreflightStatus>('idle');
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const preflightCacheRef = useRef<{ key: string; result: PreflightResult; ts: number } | null>(null);

  const [deploying, setDeploying] = useState(false);

  // Image existence check on blur
  const checkImage = useCallback(async (imageRef: string, tagRef: string) => {
    const full = tagRef ? `${imageRef}:${tagRef}` : imageRef;
    if (!full || !full.includes('harbor')) {
      setImageStatus('unchecked');
      setImageCheckResult(null);
      return;
    }
    setImageStatus('checking');
    try {
      const resp = await fetch(`/api/registry/check?image=${encodeURIComponent(full)}`);
      const data: ImageCheckResult = await resp.json();
      setImageCheckResult(data);
      setImageStatus(data.exists ? 'found' : 'not_found');
      // Reset preflight if image changed
      setPreflightStatus('idle');
      setPreflightResult(null);
    } catch {
      setImageStatus('error');
      setImageCheckResult(null);
    }
  }, []);

  const runPreflight = useCallback(async () => {
    if (!name || !team || !image || !tag) {
      showToast('Fill in all required fields before running preflight.', 'warning');
      return;
    }
    // 30-second cache
    const cacheKey = `${name}|${team}|${image}|${tag}`;
    if (
      preflightCacheRef.current &&
      preflightCacheRef.current.key === cacheKey &&
      Date.now() - preflightCacheRef.current.ts < 30000
    ) {
      setPreflightResult(preflightCacheRef.current.result);
      setPreflightStatus(preflightCacheRef.current.result.passed ? 'passed' : 'failed');
      return;
    }

    setPreflightStatus('running');
    setPreflightResult(null);
    try {
      const resp = await fetch('/api/deploy/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, team, image, tag, port, securityContext }),
      });
      const data: PreflightResult = await resp.json();
      setPreflightResult(data);
      setPreflightStatus(data.passed ? 'passed' : 'failed');
      preflightCacheRef.current = { key: cacheKey, result: data, ts: Date.now() };
    } catch {
      setPreflightStatus('idle');
      showToast('Preflight check failed — proceeding without policy validation.', 'warning');
    }
  }, [name, team, image, tag, port, securityContext, showToast]);

  const handleDeploy = async () => {
    if (!name || !team || !image || !tag) {
      showToast('Name, team, image, and tag are required.', 'error');
      return;
    }
    if (imageStatus === 'not_found') {
      showToast('Image not found in Harbor — push it first.', 'error');
      return;
    }
    if (preflightStatus === 'failed' && preflightResult && preflightResult.violations.length > 0) {
      showToast('Fix policy violations before deploying.', 'error');
      return;
    }
    setDeploying(true);
    try {
      await onDeploy({
        name,
        team,
        image,
        tag,
        port,
        replicas: 1,
        ingress: ingress || `${name}.${config.domain}`,
      });
    } finally {
      setDeploying(false);
    }
  };

  const canDeploy =
    !!name && !!team && !!image && !!tag &&
    imageStatus !== 'not_found' &&
    !(preflightStatus === 'failed' && preflightResult && preflightResult.violations.length > 0) &&
    !deploying;

  return (
    <div className="bg-card border border-border rounded-[var(--radius)] p-5 mt-4">
      <h3 className="text-sm font-semibold text-text-bright mb-1">Deploy Custom Image</h3>
      <p className="text-text-dim text-[13px] mb-4">
        Deploy your own image from <code className="font-mono text-accent">harbor.{config.domain}</code>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">App Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">Team *</label>
          <input
            type="text"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="team-alpha"
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">Image Repository *</label>
          <input
            type="text"
            value={image}
            onChange={(e) => { setImage(e.target.value); setImageStatus('unchecked'); setImageCheckResult(null); }}
            onBlur={() => checkImage(image, tag)}
            placeholder={`harbor.${config.domain}/team-alpha/my-app`}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">Tag *</label>
          <input
            type="text"
            value={tag}
            onChange={(e) => { setTag(e.target.value); setImageStatus('unchecked'); setImageCheckResult(null); }}
            onBlur={() => checkImage(image, tag)}
            placeholder="v1.2.3"
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Image check indicator */}
      {imageStatus !== 'unchecked' && (
        <div className="mb-3">
          {imageStatus === 'checking' && (
            <div className="flex items-center gap-1.5 text-xs text-text-dim">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking image in Harbor...
            </div>
          )}
          {imageStatus === 'found' && imageCheckResult && (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-green flex-shrink-0" />
              <span className="text-green">Image found</span>
              {imageCheckResult.scanned ? (
                <span className="text-text-dim">
                  · Scanned
                  {(imageCheckResult.vulnerabilities?.critical ?? 0) > 0 && (
                    <span className="text-red ml-1">
                      · {imageCheckResult.vulnerabilities?.critical} critical CVEs
                    </span>
                  )}
                  {(imageCheckResult.vulnerabilities?.critical ?? 0) === 0 && (
                    <span className="text-green ml-1">· 0 critical CVEs</span>
                  )}
                </span>
              ) : (
                <span className="text-yellow">· Not scanned yet</span>
              )}
            </div>
          )}
          {imageStatus === 'not_found' && (
            <div className="flex items-center gap-1.5 text-xs text-red">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              Image not found in Harbor. Push it first:
              <code className="ml-1 font-mono text-[11px] bg-red/10 px-1.5 py-0.5 rounded">
                docker push {image}:{tag}
              </code>
            </div>
          )}
          {imageStatus === 'error' && (
            <div className="flex items-center gap-1.5 text-xs text-yellow">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Could not reach Harbor — image check skipped.
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-text-dim mb-1">Ingress Host</label>
          <input
            type="text"
            value={ingress}
            onChange={(e) => setIngress(e.target.value)}
            placeholder={`${name || 'my-app'}.${config.domain}`}
            className="w-full px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Preflight check button */}
      <div className="mb-3">
        <button
          className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1.5"
          onClick={runPreflight}
          disabled={preflightStatus === 'running' || !name || !team || !image || !tag}
          title="Check Kyverno policies and resource quota before deploying"
        >
          {preflightStatus === 'running' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Shield className="w-3 h-3" />
          )}
          {preflightStatus === 'running' ? 'Checking...' : 'Run Pre-flight Check'}
        </button>
        <span className="text-[11px] text-text-dim ml-2">Check policies and quota before deploying</span>
      </div>

      {/* Preflight results */}
      {preflightResult && (
        <div className={`mb-3 rounded border p-3 text-xs ${
          preflightResult.passed
            ? 'border-green/30 bg-green/5'
            : 'border-red/30 bg-red/5'
        }`}>
          <div className="flex items-center gap-1.5 font-semibold mb-2">
            {preflightResult.passed ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-green" />
                <span className="text-green">Pre-flight passed — safe to deploy</span>
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-red" />
                <span className="text-red">Pre-flight failed — fix violations before deploying</span>
              </>
            )}
          </div>

          {preflightResult.violations.map((v, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="flex items-start gap-1.5">
                <XCircle className="w-3 h-3 text-red flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-mono text-red font-semibold">{v.policy}</span>
                  <div className="text-text-dim mt-0.5">{v.message}</div>
                  {v.fix && (
                    <div className="mt-1 font-mono bg-bg px-1.5 py-1 rounded text-text-primary leading-relaxed">
                      Fix: {v.fix}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {preflightResult.warnings.map((w, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="flex items-center gap-1.5 text-yellow">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                {w.message}
              </div>
            </div>
          ))}

          {preflightResult.resourceQuota && (
            <div className="mt-2 pt-2 border-t border-border text-text-dim">
              <span className="font-semibold">Quota: </span>
              CPU {preflightResult.resourceQuota.cpuAvailable} available ·{' '}
              Memory {preflightResult.resourceQuota.memoryAvailable} available
              {!preflightResult.resourceQuota.withinQuota && (
                <span className="text-red ml-1">— quota may be tight</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="btn btn-success text-xs flex items-center gap-1.5"
          onClick={handleDeploy}
          disabled={!canDeploy}
        >
          {deploying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {deploying ? 'Deploying...' : 'Deploy'}
        </button>
        {imageStatus === 'not_found' && (
          <span className="text-xs text-red">Image not found — push to Harbor first</span>
        )}
        {preflightStatus === 'failed' && preflightResult && preflightResult.violations.length > 0 && (
          <span className="text-xs text-red">Fix policy violations above before deploying</span>
        )}
      </div>
    </div>
  );
}

// ── Main DeployTab ────────────────────────────────────────────────────────────
export function DeployTab({ user, onOpenApp }: DeployTabProps) {
  const config = useConfig();
  const { showToast } = useToast();
  const [method, setMethod] = useState<DeployMethod>('none');
  const [deployItems, setDeployItems] = useState<DeployItem[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  const [securityContext, setSecurityContext] = useState<SecurityContextOptions>({});
  const [complianceResult, setComplianceResult] = useState<ComplianceGateResponse | null>(null);

  const handleOpenDsopWizard = useCallback(() => {
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
              <CustomImageForm onDeploy={handleQuickDeploy} securityContext={securityContext} />
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
