import { useState, useCallback } from 'react';
import {
  Package,
  Download,
  CheckCircle2,
  FileArchive,
  Code,
  Database,
  Shield,
  HardDrive,
  Loader2,
  ArrowLeft,
  RotateCcw,
  XCircle,
  Server,
} from 'lucide-react';
import { Button } from '../ui/Button';
import type { BundleBuilderConfig } from '../../types';

// ── Props ──

interface BundleReviewProps {
  config: BundleBuilderConfig;
  files: { primaryImage: File | null; components: Map<number, File>; source: File | null };
  onBack: () => void;
  onReset: () => void;
}

// ── Constants ──

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

// ── Helpers ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-navy-700 last:border-0">
      <span className="text-sm text-gray-500 shrink-0 mr-4">{label}</span>
      <span className={`text-sm text-gray-200 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ── Component ──

export function Step_BundleReview({ config, files, onBack, onReset }: BundleReviewProps) {
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPort = config.appType === 'web-app' || config.appType === 'api-service';
  const resourceInfo = RESOURCE_LABELS[config.resources] || RESOURCE_LABELS.small;

  // Collect enabled services
  const enabledServices: string[] = [];
  if (config.database.enabled) enabledServices.push(`PostgreSQL (${config.database.size})`);
  if (config.redis.enabled) enabledServices.push(`Redis (${config.redis.size})`);
  if (config.sso) enabledServices.push('SSO / Keycloak OIDC');
  if (config.storage) enabledServices.push('Persistent Volume (1Gi)');

  const envVars = config.env.filter((e) => e.name.trim().length > 0);

  // Calculate total file size
  const totalSize = [
    config.primaryImageFile?.size ?? 0,
    ...config.components.map((c) => c.imageFile?.size ?? 0),
    config.sourceFile?.size ?? 0,
  ].reduce((sum, s) => sum + s, 0);

  // ── Generate bundle ──

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const formData = new FormData();

      // Build manifest JSON
      const manifest = {
        apiVersion: 'sre.io/v1alpha1',
        kind: 'DeploymentBundle',
        metadata: {
          name: config.name,
          version: config.version,
          team: 'pending-assignment',
          created: new Date().toISOString(),
          author:
            config.author && config.email
              ? `${config.author} <${config.email}>`
              : config.author || undefined,
          description: config.description || undefined,
        },
        spec: {
          app: {
            type: config.appType,
            image: `images/${files.primaryImage?.name || 'app.tar'}`,
            port: config.port,
            resources: config.resources,
            ingress: config.ingress || undefined,
            probes: config.probes,
          },
          components: config.components
            .filter((c) => c.imageFile)
            .map((c, i) => ({
              name: c.name || `component-${i}`,
              type: c.type,
              image: `images/${files.components.get(i)?.name || `component-${i}.tar`}`,
              resources: config.resources,
            })),
          services: {
            database: config.database.enabled
              ? { enabled: true as const, size: config.database.size }
              : undefined,
            redis: config.redis.enabled
              ? { enabled: true as const, size: config.redis.size }
              : undefined,
            sso: config.sso ? { enabled: true as const } : undefined,
            storage: config.storage ? { enabled: true as const } : undefined,
          },
          env:
            config.env.filter((e) => e.name.trim()).length > 0
              ? config.env.filter((e) => e.name.trim())
              : undefined,
          source: { included: config.sourceIncluded },
          classification: 'UNCLASSIFIED',
        },
      };

      formData.append('manifest', JSON.stringify(manifest));
      if (files.primaryImage) formData.append('images', files.primaryImage);
      for (const [, file] of files.components) {
        if (file) formData.append('images', file);
      }
      if (files.source) formData.append('source', files.source);

      const response = await fetch('/api/bundle/create', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || `Generation failed (HTTP ${response.status})`,
        );
      }

      // Trigger browser download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${config.name}-v${config.version}.bundle.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bundle generation failed');
    } finally {
      setGenerating(false);
    }
  }, [config, files]);

  // ── Success state ──

  if (success) {
    return (
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-100">Bundle Created!</h2>
          <p className="text-sm text-gray-400">
            Your deployment bundle has been downloaded. Upload it to the DSOP wizard using the
            &quot;Upload Bundle&quot; option to begin the security pipeline.
          </p>
        </div>

        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Next Steps</h3>
          <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
            <li>Transfer the bundle to a machine with access to the SRE platform</li>
            <li>Open the DSOP Wizard and select &quot;Upload Bundle&quot;</li>
            <li>Drop the <code className="text-cyan-400 font-mono">.bundle.tar.gz</code> file into the uploader</li>
            <li>The wizard will parse the manifest and begin the security pipeline</li>
          </ol>
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={onReset} icon={<RotateCcw className="w-4 h-4" />}>
            Create Another
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

  // ── Review state ──

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Review your bundle</h2>
        <p className="mt-2 text-sm text-gray-400">
          Verify the configuration below, then generate and download your deployment bundle.
        </p>
      </div>

      {/* ── Summary ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Application</h3>
        <div className="divide-y divide-navy-700">
          <SummaryRow label="App Name" value={config.name} mono />
          <SummaryRow label="Version" value={config.version} mono />
          {config.author && <SummaryRow label="Author" value={config.email ? `${config.author} <${config.email}>` : config.author} />}
          {config.description && <SummaryRow label="Description" value={config.description} />}
          <SummaryRow label="Type" value={TYPE_LABELS[config.appType] || config.appType} />
          {showPort && <SummaryRow label="Port" value={String(config.port)} />}
          <SummaryRow
            label="Resources"
            value={`${config.resources} (CPU: ${resourceInfo.cpu}, Mem: ${resourceInfo.memory})`}
          />
          {config.ingress && config.appType === 'web-app' && (
            <SummaryRow label="Ingress" value={config.ingress} mono />
          )}
        </div>
      </div>

      {/* ── Images ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <FileArchive className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-gray-300">Container Images</h3>
        </div>
        <div className="space-y-2">
          {/* Primary */}
          {config.primaryImageFile && (
            <div className="flex items-center justify-between rounded-lg border border-navy-700 bg-navy-900/50 px-4 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <Package className="w-4 h-4 text-cyan-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 font-mono truncate">{config.primaryImageFile.name}</p>
                  <p className="text-xs text-gray-500">Primary image</p>
                </div>
              </div>
              <span className="text-xs text-gray-500 shrink-0 ml-4">
                {formatFileSize(config.primaryImageFile.size)}
              </span>
            </div>
          )}

          {/* Components */}
          {config.components
            .filter((c) => c.imageFile)
            .map((comp, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-navy-700 bg-navy-900/50 px-4 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Package className="w-4 h-4 text-gray-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200 font-mono truncate">
                      {comp.imageFile?.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {comp.name || `Component ${idx + 1}`} ({comp.type})
                    </p>
                  </div>
                </div>
                <span className="text-xs text-gray-500 shrink-0 ml-4">
                  {comp.imageFile ? formatFileSize(comp.imageFile.size) : ''}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Services ── */}
      {enabledServices.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Platform Services</h3>
          <ul className="space-y-2">
            {config.database.enabled && (
              <li className="flex items-center gap-2 text-sm text-gray-300">
                <Database className="w-4 h-4 text-cyan-400 shrink-0" />
                PostgreSQL ({config.database.size})
              </li>
            )}
            {config.redis.enabled && (
              <li className="flex items-center gap-2 text-sm text-gray-300">
                <Server className="w-4 h-4 text-cyan-400 shrink-0" />
                Redis ({config.redis.size})
              </li>
            )}
            {config.sso && (
              <li className="flex items-center gap-2 text-sm text-gray-300">
                <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
                SSO / Keycloak OIDC
              </li>
            )}
            {config.storage && (
              <li className="flex items-center gap-2 text-sm text-gray-300">
                <HardDrive className="w-4 h-4 text-cyan-400 shrink-0" />
                Persistent Volume (1Gi)
              </li>
            )}
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

      {/* ── Source code ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <Code className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-gray-300">Source Code</h3>
        </div>
        {config.sourceIncluded && config.sourceFile ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Included: <span className="font-mono text-gray-300">{config.sourceFile.name}</span>
              <span className="text-gray-500 ml-2">({formatFileSize(config.sourceFile.size)})</span>
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Not included — SAST scanning will be skipped</p>
        )}
      </div>

      {/* ── Total size ── */}
      {totalSize > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-navy-700 bg-navy-900/50 px-5 py-3">
          <span className="text-sm text-gray-400">Estimated bundle size</span>
          <span className="text-sm font-semibold text-gray-200">{formatFileSize(totalSize)}</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Bundle generation failed</p>
            <p className="text-sm text-red-400/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={generating}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={handleGenerate}
          loading={generating}
          icon={!generating ? <Download className="w-4 h-4" /> : undefined}
          size="lg"
        >
          {generating ? 'Packaging bundle...' : 'Generate & Download Bundle'}
        </Button>
      </div>
    </div>
  );
}
