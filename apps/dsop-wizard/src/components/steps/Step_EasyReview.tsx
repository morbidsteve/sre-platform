import { useState } from 'react';
import {
  ArrowLeft,
  Rocket,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  XCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import type { EasyConfig } from '../../types';

interface EasyReviewProps {
  config: EasyConfig;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  result: { success: boolean; prUrl?: string; error?: string } | null;
  onReset: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  'web-app': 'Web App',
  'api-service': 'API Service',
  worker: 'Worker',
  cronjob: 'Cron Job',
};

const RESOURCE_LABELS: Record<string, { cpu: string; memory: string }> = {
  small: { cpu: '250m / 500m', memory: '256Mi / 512Mi' },
  medium: { cpu: '500m / 1', memory: '512Mi / 1Gi' },
  large: { cpu: '1 / 2', memory: '1Gi / 2Gi' },
};

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-navy-700 last:border-0">
      <span className="text-sm text-gray-500 shrink-0 mr-4">{label}</span>
      <span className={`text-sm text-gray-200 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function generateManifest(config: EasyConfig): string {
  const lines: string[] = [];
  lines.push('apiVersion: sre.io/v1alpha1');
  lines.push('kind: AppContract');
  lines.push('metadata:');
  lines.push(`  name: ${config.appName || 'my-app'}`);
  lines.push(`  team: ${config.team || 'default'}`);
  lines.push('spec:');
  lines.push(`  type: ${config.appType}`);
  lines.push(`  image: ${config.image || 'harbor.apps.sre.example.com/team/app:v1.0.0'}`);

  if (config.appType === 'web-app' || config.appType === 'api-service') {
    lines.push(`  port: ${config.port}`);
  }

  lines.push(`  resources: ${config.resources}`);

  if (config.ingress && config.appType === 'web-app') {
    lines.push(`  ingress: ${config.ingress}`);
  }

  const hasServices = config.database.enabled || config.redis.enabled || config.sso || config.storage;
  if (hasServices) {
    lines.push('  services:');
    if (config.database.enabled) {
      lines.push('    database:');
      lines.push('      enabled: true');
      lines.push(`      size: ${config.database.size}`);
    }
    if (config.redis.enabled) {
      lines.push('    redis:');
      lines.push('      enabled: true');
      lines.push(`      size: ${config.redis.size}`);
    }
    if (config.sso) {
      lines.push('    sso:');
      lines.push('      enabled: true');
    }
    if (config.storage) {
      lines.push('    storage:');
      lines.push('      enabled: true');
      lines.push('      size: 1Gi');
    }
  }

  if (config.env.length > 0) {
    lines.push('  env:');
    for (const e of config.env) {
      if (!e.name) continue;
      if (e.secret !== undefined) {
        lines.push(`    - name: ${e.name}`);
        lines.push(`      secretRef: ${e.secret || 'REPLACE_ME'}`);
      } else {
        lines.push(`    - name: ${e.name}`);
        lines.push(`      value: "${e.value || ''}"`);
      }
    }
  }

  return lines.join('\n');
}

export function Step_EasyReview({ config, onBack, onSubmit, submitting, result, onReset }: EasyReviewProps) {
  const [manifestExpanded, setManifestExpanded] = useState(false);

  const showPort = config.appType === 'web-app' || config.appType === 'api-service';
  const enabledServices: string[] = [];
  if (config.database.enabled) enabledServices.push(`PostgreSQL (${config.database.size})`);
  if (config.redis.enabled) enabledServices.push(`Redis (${config.redis.size})`);
  if (config.sso) enabledServices.push('SSO / Keycloak OIDC');
  if (config.storage) enabledServices.push('Persistent Volume (1Gi)');
  const envVars = config.env.filter((e) => e.name.trim().length > 0);
  const resourceInfo = RESOURCE_LABELS[config.resources] || RESOURCE_LABELS.small;

  // ── Success state ──
  if (result?.success) {
    return (
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-100">Deployment Created</h2>
          <p className="text-sm text-gray-400">
            A pull request has been created with your deployment configuration. Flux will reconcile
            once the PR is merged.
          </p>
        </div>

        {result.prUrl && (
          <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-400 mb-3">Pull Request</p>
            <a
              href={result.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-mono text-sm transition-colors"
            >
              {result.prUrl}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={onReset} icon={<RotateCcw className="w-4 h-4" />}>
            Deploy Another
          </Button>
          <Button
            onClick={() => {
              window.location.href = '/';
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Review your deployment</h2>
        <p className="mt-2 text-sm text-gray-400">
          Verify the configuration below before creating the deployment PR.
        </p>
      </div>

      {/* ── Summary ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Application</h3>
        <div className="divide-y divide-navy-700">
          <SummaryRow label="App Name" value={config.appName} mono />
          <SummaryRow label="Team" value={config.team} />
          <SummaryRow label="Image" value={config.image} mono />
          <SummaryRow label="Type" value={TYPE_LABELS[config.appType] || config.appType} />
          {showPort && <SummaryRow label="Port" value={String(config.port)} />}
          <SummaryRow label="Resources" value={`${config.resources} (CPU: ${resourceInfo.cpu}, Mem: ${resourceInfo.memory})`} />
          {config.ingress && config.appType === 'web-app' && (
            <SummaryRow label="Ingress" value={config.ingress} mono />
          )}
        </div>
      </div>

      {/* ── Services ── */}
      {enabledServices.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Platform Services</h3>
          <ul className="space-y-2">
            {enabledServices.map((svc) => (
              <li key={svc} className="flex items-center gap-2 text-sm text-gray-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                {svc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Env vars ── */}
      {envVars.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Environment Variables</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-navy-700">
                  <th className="text-left px-2 py-1 font-medium">Name</th>
                  <th className="text-left px-2 py-1 font-medium">Value</th>
                  <th className="text-left px-2 py-1 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {envVars.map((e, i) => (
                  <tr key={i} className="border-b border-navy-700 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-gray-300">{e.name}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-400">
                      {e.secret !== undefined ? '\u2022\u2022\u2022\u2022\u2022\u2022' : e.value || '""'}
                    </td>
                    <td className="px-2 py-1.5">
                      {e.secret !== undefined ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          secret
                        </span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-navy-700 text-gray-500">
                          plain
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Generated manifest ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setManifestExpanded(!manifestExpanded)}
          className="w-full flex items-center gap-3 p-4 hover:bg-navy-700 transition-colors text-left"
        >
          {manifestExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <h3 className="text-sm font-semibold text-gray-400">Generated Manifest</h3>
        </button>

        {manifestExpanded && (
          <div className="border-t border-navy-700 p-4">
            <pre className="text-xs font-mono text-gray-300 bg-navy-900 rounded-lg p-4 overflow-x-auto whitespace-pre leading-relaxed">
              {generateManifest(config)}
            </pre>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {result?.error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Deployment failed</p>
            <p className="text-sm text-red-400/80 mt-1">{result.error}</p>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack} disabled={submitting} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
        <Button
          onClick={onSubmit}
          loading={submitting}
          icon={!submitting ? <Rocket className="w-4 h-4" /> : undefined}
          size="lg"
        >
          {submitting ? 'Creating PR...' : 'Create Deployment PR'}
        </Button>
      </div>
    </div>
  );
}
