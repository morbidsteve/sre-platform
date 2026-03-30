import { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2, Database, Server, ShieldCheck, HardDrive } from 'lucide-react';
import { Button } from '../ui/Button';
import { fetchTeams, fetchHarborRepos, fetchHarborTags, checkIngressHostname } from '../../api';

// ── Easy-mode types ──

export interface EasyConfig {
  appName: string;
  team: string;
  image: string;
  appType: 'web-app' | 'api-service' | 'worker' | 'cronjob';
  port: number;
  resources: 'small' | 'medium' | 'large';
  ingress: string;
  database: { enabled: boolean; size: string };
  redis: { enabled: boolean; size: string };
  sso: boolean;
  storage: boolean;
  env: Array<{ name: string; value?: string; secret?: string }>;
}

interface EasyConfigProps {
  config: EasyConfig;
  onUpdate: (updates: Partial<EasyConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

const APP_TYPES: { value: EasyConfig['appType']; label: string }[] = [
  { value: 'web-app', label: 'Web App' },
  { value: 'api-service', label: 'API Service' },
  { value: 'worker', label: 'Worker' },
  { value: 'cronjob', label: 'Cron Job' },
];

const RESOURCE_TIERS: { value: EasyConfig['resources']; label: string; cpu: string; memory: string }[] = [
  { value: 'small', label: 'Small', cpu: '250m / 500m', memory: '256Mi / 512Mi' },
  { value: 'medium', label: 'Medium', cpu: '500m / 1', memory: '512Mi / 1Gi' },
  { value: 'large', label: 'Large', cpu: '1 / 2', memory: '1Gi / 2Gi' },
];

const DB_SIZES = [
  { value: '1Gi', label: '1 Gi' },
  { value: '5Gi', label: '5 Gi' },
  { value: '10Gi', label: '10 Gi' },
  { value: '20Gi', label: '20 Gi' },
];

const inputClasses =
  'w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500';

const selectClasses =
  'w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500';

// ── Helpers ──

function ServiceToggle({
  enabled,
  onToggle,
  icon,
  label,
  children,
}: {
  enabled: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        enabled
          ? 'border-cyan-500/40 bg-cyan-500/5'
          : 'border-navy-700 bg-navy-800/50 hover:border-navy-600'
      }`}
    >
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="w-4 h-4 text-cyan-500 bg-navy-800 border-navy-500 rounded focus:ring-cyan-500"
        />
        <span className="text-gray-400">{icon}</span>
        <span className="text-sm font-medium text-gray-200">{label}</span>
      </label>
      {enabled && children && <div className="mt-3 ml-7">{children}</div>}
    </div>
  );
}

// ── Component ──

export function Step_EasyConfig({ config, onUpdate, onNext, onBack }: EasyConfigProps) {
  const [teams, setTeams] = useState<string[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Harbor browsing state
  const [repos, setRepos] = useState<Array<{ name: string; fullName: string; artifactCount: number }>>([]);
  const [tags, setTags] = useState<Array<{ name: string; digest: string | null; size: number | null; pushed: string | null }>>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [ingressStatus, setIngressStatus] = useState<{ checking: boolean; available?: boolean; usedBy?: string } | null>(null);
  const [ingressManual, setIngressManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTeams()
      .then((t) => {
        if (!cancelled) {
          setTeams(t);
          if (!config.team && t.length > 0) {
            onUpdate({ team: t[0] });
          }
          setTeamsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTeams(['team-alpha', 'team-bravo', 'team-charlie', 'default']);
          setTeamsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch Harbor repos when team changes
  useEffect(() => {
    if (!config.team) return;
    setLoadingRepos(true);
    setRepos([]);
    setTags([]);
    setSelectedRepo('');
    setSelectedTag('');
    setRepoSearch('');
    fetchHarborRepos(config.team).then(r => {
      setRepos(r);
      setLoadingRepos(false);
    });
  }, [config.team]);

  // Fetch tags when repo is selected
  useEffect(() => {
    if (!config.team || !selectedRepo) {
      setTags([]);
      return;
    }
    setLoadingTags(true);
    fetchHarborTags(config.team, selectedRepo).then(t => {
      setTags(t);
      setLoadingTags(false);
    });
  }, [config.team, selectedRepo]);

  // Compose full image reference from repo + tag
  useEffect(() => {
    if (selectedRepo && selectedTag && config.team) {
      const domain = 'harbor.apps.sre.example.com';
      const fullImage = `${domain}/${config.team}/${selectedRepo}:${selectedTag}`;
      onUpdate({ image: fullImage });
    }
  }, [selectedRepo, selectedTag, config.team]);

  // Auto-generate ingress hostname from app name
  useEffect(() => {
    if (config.appType === 'web-app' && config.appName && !ingressManual) {
      onUpdate({ ingress: `${config.appName}.apps.sre.example.com` });
    }
  }, [config.appName, config.appType, ingressManual]);

  // Debounced ingress hostname availability check
  useEffect(() => {
    if (!config.ingress || config.appType !== 'web-app') {
      setIngressStatus(null);
      return;
    }
    const timeout = setTimeout(() => {
      setIngressStatus({ checking: true });
      checkIngressHostname(config.ingress).then(result => {
        setIngressStatus({ checking: false, available: result.available, usedBy: result.usedBy });
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [config.ingress, config.appType]);

  // Close repo dropdown on outside click
  useEffect(() => {
    const handleClickOutside = () => setShowRepoDropdown(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const showPort = config.appType === 'web-app' || config.appType === 'api-service';
  const showIngress = config.appType === 'web-app';

  // ── Validation ──

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!config.appName.trim()) {
      errs.appName = 'App name is required';
    } else if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(config.appName) && config.appName.length > 1) {
      errs.appName = 'Must be kebab-case (lowercase letters, numbers, hyphens)';
    } else if (config.appName.length === 1 && !/^[a-z]$/.test(config.appName)) {
      errs.appName = 'Must start with a lowercase letter';
    }
    if (!config.team) {
      errs.team = 'Team is required';
    }
    if (!config.image.trim()) {
      errs.image = 'Container image is required';
    } else if (!config.image.startsWith('harbor.')) {
      errs.image = 'Image must be from Harbor (starts with harbor.)';
    }
    return errs;
  }

  function handleBlur(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validate());
  }

  function handleNext() {
    const errs = validate();
    setErrors(errs);
    setTouched({ appName: true, team: true, image: true });
    if (Object.keys(errs).length === 0) {
      onNext();
    }
  }

  // ── Env var helpers ──

  function addEnvVar() {
    onUpdate({ env: [...config.env, { name: '', value: '' }] });
  }

  function updateEnvVar(index: number, field: 'name' | 'value' | 'secret', val: string) {
    const updated = config.env.map((e, i) => {
      if (i !== index) return e;
      if (field === 'secret') {
        const { value: _v, ...rest } = e;
        return { ...rest, [field]: val };
      }
      if (field === 'value') {
        const { secret: _s, ...rest } = e;
        return { ...rest, [field]: val };
      }
      return { ...e, [field]: val };
    });
    onUpdate({ env: updated });
  }

  function removeEnvVar(index: number) {
    onUpdate({ env: config.env.filter((_, i) => i !== index) });
  }

  function toggleEnvSecret(index: number) {
    const item = config.env[index];
    if (item.secret !== undefined) {
      // Switch to plain value
      const { secret: _s, ...rest } = item;
      const updated = config.env.map((e, i) => (i === index ? { ...rest, value: '' } : e));
      onUpdate({ env: updated });
    } else {
      // Switch to secret ref
      const { value: _v, ...rest } = item;
      const updated = config.env.map((e, i) => (i === index ? { ...rest, secret: '' } : e));
      onUpdate({ env: updated });
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Configure your deployment</h2>
        <p className="mt-2 text-sm text-gray-400">
          Fill in the details for your application. All fields marked with * are required.
        </p>
      </div>

      {/* ── Basic info ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Application</h3>

        {/* App Name */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">
            App Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={config.appName}
            onChange={(e) =>
              onUpdate({
                appName: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '-')
                  .replace(/--+/g, '-'),
              })
            }
            onBlur={() => handleBlur('appName')}
            placeholder="my-app"
            className={`${inputClasses} ${touched.appName && errors.appName ? 'border-red-500 focus:ring-red-500' : ''}`}
          />
          {touched.appName && errors.appName && (
            <p className="text-xs text-red-400">{errors.appName}</p>
          )}
        </div>

        {/* Team */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">
            Team / Namespace <span className="text-red-400">*</span>
            {teamsLoading && <span className="text-gray-600 font-normal ml-1">(loading...)</span>}
          </label>
          <select
            value={config.team}
            onChange={(e) => onUpdate({ team: e.target.value })}
            onBlur={() => handleBlur('team')}
            className={`${selectClasses} ${touched.team && errors.team ? 'border-red-500 focus:ring-red-500' : ''}`}
          >
            <option value="">Select a team</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {touched.team && errors.team && (
            <p className="text-xs text-red-400">{errors.team}</p>
          )}
        </div>

        {/* Container Image */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">
            Container Image <span className="text-red-400">*</span>
          </label>
          <div className="mt-1 grid grid-cols-5 gap-2">
            {/* Repository — takes 3 cols */}
            <div className="col-span-3 relative" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={repoSearch || selectedRepo}
                onChange={(e) => {
                  setRepoSearch(e.target.value);
                  setShowRepoDropdown(true);
                }}
                onFocus={() => repos.length > 0 && setShowRepoDropdown(true)}
                onBlur={() => handleBlur('image')}
                placeholder={loadingRepos ? 'Loading repositories...' : 'Search or select image...'}
                className={`${inputClasses} font-mono ${touched.image && errors.image ? 'border-red-500 focus:ring-red-500' : ''}`}
              />
              {showRepoDropdown && repos.length > 0 && (
                <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-navy-600 bg-navy-800 shadow-xl">
                  {repos
                    .filter(r => !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase()))
                    .map(r => (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => {
                          setSelectedRepo(r.name);
                          setRepoSearch('');
                          setShowRepoDropdown(false);
                          setSelectedTag('');
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-navy-700 flex justify-between"
                      >
                        <span>{r.name}</span>
                        <span className="text-xs text-gray-500">{r.artifactCount} tags</span>
                      </button>
                    ))
                  }
                  {repos.filter(r => !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500">No matching repositories</div>
                  )}
                </div>
              )}
            </div>

            {/* Tag — takes 2 cols */}
            <div className="col-span-2">
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                disabled={!selectedRepo || loadingTags}
                className={selectClasses}
              >
                <option value="">{loadingTags ? 'Loading...' : 'Select tag'}</option>
                {tags
                  .filter(t => t.name !== 'latest')
                  .map(t => (
                    <option key={t.name} value={t.name}>
                      {t.name}{t.size ? ` (${Math.round(t.size / 1024 / 1024)}MB)` : ''}
                    </option>
                  ))
                }
              </select>
            </div>
          </div>

          {/* Show composed image reference */}
          {config.image && (
            <p className="mt-1 text-xs text-gray-500 font-mono truncate">{config.image}</p>
          )}

          {/* Fallback: manual input when Harbor is not accessible */}
          {repos.length === 0 && !loadingRepos && config.team && (
            <div className="mt-2">
              <input
                type="text"
                value={config.image}
                onChange={(e) => onUpdate({ image: e.target.value })}
                onBlur={() => handleBlur('image')}
                placeholder="harbor.apps.sre.example.com/team/app:v1.0.0"
                className={`${inputClasses} font-mono ${touched.image && errors.image ? 'border-red-500 focus:ring-red-500' : ''}`}
              />
              <p className="mt-1 text-xs text-gray-500">Harbor not accessible — enter image reference manually</p>
            </div>
          )}

          {touched.image && errors.image && (
            <p className="mt-1 text-xs text-red-400">{errors.image}</p>
          )}
        </div>

        {/* App Type */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">App Type</label>
          <select
            value={config.appType}
            onChange={(e) => onUpdate({ appType: e.target.value as EasyConfig['appType'] })}
            className={selectClasses}
          >
            {APP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Port */}
        {showPort && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => onUpdate({ port: parseInt(e.target.value, 10) || 8080 })}
              min={1}
              max={65535}
              className={`${inputClasses} w-32`}
            />
          </div>
        )}

        {/* Ingress */}
        {showIngress && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Ingress Hostname</label>
            <input
              type="text"
              value={config.ingress}
              onChange={(e) => {
                setIngressManual(true);
                onUpdate({ ingress: e.target.value });
              }}
              placeholder={`${config.appName || 'my-app'}.apps.sre.example.com`}
              className={`${inputClasses} font-mono`}
            />
            {!ingressManual && config.ingress && (
              <p className="text-xs text-gray-500">Auto-generated from app name</p>
            )}
            {ingressStatus?.checking && (
              <p className="mt-1 text-xs text-gray-500">Checking availability...</p>
            )}
            {ingressStatus && !ingressStatus.checking && ingressStatus.available === true && config.ingress && (
              <p className="mt-1 text-xs text-emerald-400">Hostname available</p>
            )}
            {ingressStatus && !ingressStatus.checking && ingressStatus.available === false && (
              <p className="mt-1 text-xs text-red-400">
                Hostname already in use by {ingressStatus.usedBy}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Resources ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Resources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {RESOURCE_TIERS.map((tier) => (
            <button
              key={tier.value}
              type="button"
              onClick={() => onUpdate({ resources: tier.value })}
              className={`rounded-lg border p-4 text-left transition-all ${
                config.resources === tier.value
                  ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500'
                  : 'border-navy-700 bg-navy-900/50 hover:border-navy-600'
              }`}
            >
              <span className="block text-sm font-semibold text-gray-200">{tier.label}</span>
              <span className="block text-xs text-gray-500 mt-1">CPU: {tier.cpu}</span>
              <span className="block text-xs text-gray-500">Mem: {tier.memory}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Platform services ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Platform Services</h3>
        <div className="space-y-3">
          <ServiceToggle
            enabled={config.database.enabled}
            onToggle={() => onUpdate({ database: { ...config.database, enabled: !config.database.enabled } })}
            icon={<Database className="w-4 h-4" />}
            label="PostgreSQL Database"
          >
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Storage Size</label>
              <select
                value={config.database.size}
                onChange={(e) => onUpdate({ database: { ...config.database, size: e.target.value } })}
                className={`${selectClasses} w-36`}
              >
                {DB_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </ServiceToggle>

          <ServiceToggle
            enabled={config.redis.enabled}
            onToggle={() => onUpdate({ redis: { ...config.redis, enabled: !config.redis.enabled } })}
            icon={<Server className="w-4 h-4" />}
            label="Redis Cache"
          >
            <div className="space-y-1.5">
              <label className="text-xs text-gray-500">Storage Size</label>
              <select
                value={config.redis.size}
                onChange={(e) => onUpdate({ redis: { ...config.redis, size: e.target.value } })}
                className={`${selectClasses} w-36`}
              >
                {DB_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </ServiceToggle>

          <ServiceToggle
            enabled={config.sso}
            onToggle={() => onUpdate({ sso: !config.sso })}
            icon={<ShieldCheck className="w-4 h-4" />}
            label="SSO / Keycloak OIDC"
          />

          <ServiceToggle
            enabled={config.storage}
            onToggle={() => onUpdate({ storage: !config.storage })}
            icon={<HardDrive className="w-4 h-4" />}
            label="Persistent Volume (1Gi)"
          />
        </div>
      </div>

      {/* ── Environment variables ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300">Environment Variables</h3>
          <button
            type="button"
            onClick={addEnvVar}
            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Variable
          </button>
        </div>

        {config.env.length === 0 ? (
          <p className="text-xs text-gray-600">No environment variables configured.</p>
        ) : (
          <div className="space-y-2">
            {config.env.map((envVar, idx) => {
              const isSecret = envVar.secret !== undefined;
              return (
                <div key={idx} className="flex items-start gap-2">
                  <input
                    type="text"
                    value={envVar.name}
                    onChange={(e) => updateEnvVar(idx, 'name', e.target.value)}
                    placeholder="VAR_NAME"
                    className={`${inputClasses} font-mono flex-1`}
                  />
                  <input
                    type="text"
                    value={isSecret ? envVar.secret || '' : envVar.value || ''}
                    onChange={(e) => updateEnvVar(idx, isSecret ? 'secret' : 'value', e.target.value)}
                    placeholder={isSecret ? 'openbao-secret-key' : 'value'}
                    className={`${inputClasses} font-mono flex-1 ${isSecret ? 'border-amber-500/30' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleEnvSecret(idx)}
                    title={isSecret ? 'Switch to plain value' : 'Switch to OpenBao secret'}
                    className={`mt-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                      isSecret
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'
                        : 'bg-navy-700 text-gray-500 border border-navy-600 hover:text-gray-300'
                    }`}
                  >
                    {isSecret ? 'secret' : 'value'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEnvVar(idx)}
                    className="mt-1.5 text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack} icon={<ArrowLeft className="w-4 h-4" />}>
          Back
        </Button>
        <Button onClick={handleNext} icon={<ArrowRight className="w-4 h-4" />} size="lg">
          Review
        </Button>
      </div>
    </div>
  );
}
