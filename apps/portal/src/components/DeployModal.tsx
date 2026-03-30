import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Lock, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';
import { useDeploy } from '../hooks/useDeploy';
import { fetchTeams } from '../api';

interface DeployModalProps {
  onClose: () => void;
}

function ServiceToggle({ label, description, enabled, onToggle, size, onSizeChange, showSize }: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  size?: string;
  onSizeChange?: (v: string) => void;
  showSize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
      <div className="flex items-center gap-3">
        {showSize && enabled && onSizeChange && (
          <select value={size || 'small'} onChange={(e) => onSizeChange(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        )}
        <button type="button" onClick={() => onToggle(!enabled)}
          className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-cyan-500' : 'bg-slate-700'}`}>
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </div>
  );
}

export function DeployModal({ onClose }: DeployModalProps) {
  const { form, setField, addEnv, removeEnv, setEnvField, submit, submitting, result, errors } = useDeploy();
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    fetchTeams().then(setTeams).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    submit();
  }, [submit]);

  const isSuccess = result?.success === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <form
        onSubmit={handleSubmit}
        className="relative mx-4 mt-20 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700 bg-slate-800 px-6 py-4 rounded-t-2xl">
          <h2 className="text-lg font-semibold text-slate-100">Quick Deploy</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Success State */}
        {isSuccess ? (
          <div className="flex flex-col items-center py-12 px-6">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <h3 className="mt-4 text-lg font-medium text-slate-100">Deployment PR Created</h3>
            <p className="mt-2 text-sm text-slate-400">Your pull request is ready for review.</p>
            {result.prUrl && (
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400"
              >
                View Pull Request <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 text-sm text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Form Body */}
            <div className="space-y-6 px-6 py-5">
              {/* Section 1: What are you deploying? */}
              <fieldset>
                <legend className="text-sm font-medium text-slate-300">What are you deploying?</legend>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {/* App Name - full width */}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-400">
                      App Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.appName}
                      onChange={(e) => setField('appName', e.target.value)}
                      placeholder="my-service"
                      className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    {errors.appName && <p className="mt-1 text-xs text-red-400">{errors.appName}</p>}
                  </div>

                  {/* App Type */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400">
                      App Type <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={form.appType}
                      onChange={(e) => setField('appType', e.target.value as typeof form.appType)}
                      className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="web-app">Web App</option>
                      <option value="api-service">API Service</option>
                      <option value="worker">Worker</option>
                      <option value="cronjob">Cron Job</option>
                    </select>
                  </div>

                  {/* Port - only for web-app and api-service */}
                  {(form.appType === 'web-app' || form.appType === 'api-service') && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400">Port</label>
                      <input
                        type="number"
                        value={form.port}
                        onChange={(e) => setField('port', parseInt(e.target.value) || 8080)}
                        className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                  )}

                  {/* Container Image - full width */}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-400">
                      Container Image <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.image}
                      onChange={(e) => setField('image', e.target.value)}
                      placeholder="harbor.sre.internal/your-team/app-name:v1.0.0"
                      className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    {errors.image && <p className="mt-1 text-xs text-red-400">{errors.image}</p>}
                    {!errors.image && (
                      <p className="mt-1 text-xs text-slate-600">
                        e.g., harbor.sre.internal/your-team/app-name:v1.0.0
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>

              {/* Section 2: Where does it run? */}
              <fieldset>
                <legend className="text-sm font-medium text-slate-300">Where does it run?</legend>
                <div className="mt-3 space-y-4">
                  {/* Team */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400">
                      Team <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={form.team}
                      onChange={(e) => setField('team', e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="">Select a team...</option>
                      {teams.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {errors.team && <p className="mt-1 text-xs text-red-400">{errors.team}</p>}
                  </div>

                  {/* Resources - card radio group */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400">
                      Resources <span className="text-red-400">*</span>
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-3">
                      {([
                        { value: 'small', label: 'Small', desc: '0.1 CPU, 128Mi', sub: 'Dev/test workloads' },
                        { value: 'medium', label: 'Medium', desc: '0.25 CPU, 256Mi', sub: 'Standard production' },
                        { value: 'large', label: 'Large', desc: '0.5 CPU, 512Mi', sub: 'High-traffic services' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setField('resources', opt.value)}
                          className={`rounded-lg border p-3 text-left transition-all ${
                            form.resources === opt.value
                              ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500'
                              : 'border-slate-700 bg-slate-900 hover:border-slate-600'
                          }`}
                        >
                          <div className="text-sm font-medium text-slate-200">{opt.label}</div>
                          <div className="mt-0.5 text-xs text-slate-400">{opt.desc}</div>
                          <div className="mt-0.5 text-xs text-slate-600">{opt.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Ingress - only for web-app */}
                  {form.appType === 'web-app' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400">Ingress Hostname</label>
                      <input
                        type="text"
                        value={form.ingress}
                        onChange={(e) => setField('ingress', e.target.value)}
                        placeholder="my-app.apps.sre.example.com"
                        className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                      <p className="mt-1 text-xs text-slate-600">e.g., my-app.apps.sre.example.com</p>
                    </div>
                  )}
                </div>
              </fieldset>

              {/* Section 3: Platform services */}
              <fieldset>
                <legend className="text-sm font-medium text-slate-300">Platform services</legend>
                <div className="mt-3 space-y-3">
                  <ServiceToggle
                    label="Database"
                    description="PostgreSQL via CNPG"
                    enabled={form.database}
                    onToggle={(v) => setField('database', v)}
                    size={form.databaseSize}
                    onSizeChange={(v) => setField('databaseSize', v as typeof form.databaseSize)}
                    showSize
                  />
                  <ServiceToggle
                    label="Redis"
                    description="In-memory cache"
                    enabled={form.redis}
                    onToggle={(v) => setField('redis', v)}
                    size={form.redisSize}
                    onSizeChange={(v) => setField('redisSize', v as typeof form.redisSize)}
                    showSize
                  />
                  <ServiceToggle
                    label="SSO"
                    description="Keycloak OIDC integration"
                    enabled={form.sso}
                    onToggle={(v) => setField('sso', v)}
                  />
                  <ServiceToggle
                    label="Object Storage"
                    description="S3-compatible via MinIO"
                    enabled={form.storage}
                    onToggle={(v) => setField('storage', v)}
                  />
                </div>
              </fieldset>

              {/* Section 4: Environment variables */}
              <fieldset>
                <legend className="text-sm font-medium text-slate-300">
                  Environment variables
                  <span className="ml-2 text-xs text-slate-600">(optional)</span>
                </legend>
                <div className="mt-3 space-y-2">
                  {form.env.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={entry.name}
                        onChange={(e) => setEnvField(i, 'name', e.target.value)}
                        placeholder="KEY_NAME"
                        className="w-1/3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                      {entry.isSecret ? (
                        <div className="relative flex-1">
                          <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                          <input
                            type="text"
                            value={entry.secret || ''}
                            onChange={(e) => setEnvField(i, 'secret', e.target.value)}
                            placeholder="OpenBao secret name"
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={entry.value || ''}
                          onChange={(e) => setEnvField(i, 'value', e.target.value)}
                          placeholder="value"
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setEnvField(i, 'isSecret', !entry.isSecret)}
                        className={`rounded-lg border p-2 transition-colors ${
                          entry.isSecret
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                            : 'border-slate-700 text-slate-500 hover:text-slate-300'
                        }`}
                        title={entry.isSecret ? 'Switch to plain value' : 'Switch to secret reference'}
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEnv(i)}
                        className="rounded-lg border border-slate-700 p-2 text-slate-500 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEnv}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-500 hover:border-slate-600 hover:text-slate-400"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add variable
                  </button>
                </div>
              </fieldset>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex items-center justify-between border-t border-slate-700 bg-slate-800 px-6 py-4 rounded-b-2xl">
              {result?.error ? (
                <p className="text-sm text-red-400">{result.error}</p>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? 'Creating PR...' : 'Create Deployment PR'}
                </button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
