import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Lock, CheckCircle2, Loader2, ExternalLink, ChevronDown, Search, AlertTriangle } from 'lucide-react';
import { useDeploy } from '../hooks/useDeploy';
import { fetchTeams, fetchHarborRepos, fetchHarborTags, checkIngressHostname } from '../api';

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

  // Harbor image browsing state
  const [repos, setRepos] = useState<Array<{ name: string; fullName: string; artifactCount: number }>>([]);
  const [tags, setTags] = useState<Array<{ name: string; digest: string | null; size: number | null; pushed: string | null }>>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [repoSearch, setRepoSearch] = useState('');
  const [showRepoDropdown, setShowRepoDropdown] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);

  // Ingress state
  const [ingressManual, setIngressManual] = useState(false);
  const [ingressStatus, setIngressStatus] = useState<{ checking: boolean; available?: boolean; usedBy?: string } | null>(null);

  // Refs
  const repoDropdownRef = useRef<HTMLDivElement>(null);
  const ingressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Close repo dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setShowRepoDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch Harbor repos when team changes
  useEffect(() => {
    if (!form.team) {
      setRepos([]);
      setSelectedRepo('');
      setSelectedTag('');
      setTags([]);
      setRepoSearch('');
      return;
    }
    setLoadingRepos(true);
    setSelectedRepo('');
    setSelectedTag('');
    setTags([]);
    setRepoSearch('');
    fetchHarborRepos(form.team)
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, [form.team]);

  // Fetch tags when repo changes
  useEffect(() => {
    if (!form.team || !selectedRepo) {
      setTags([]);
      setSelectedTag('');
      return;
    }
    setLoadingTags(true);
    setSelectedTag('');
    fetchHarborTags(form.team, selectedRepo)
      .then(setTags)
      .catch(() => setTags([]))
      .finally(() => setLoadingTags(false));
  }, [form.team, selectedRepo]);

  // Compose full image reference when repo+tag selected
  useEffect(() => {
    if (selectedRepo && selectedTag && form.team) {
      const fullImage = `harbor.apps.sre.example.com/${form.team}/${selectedRepo}:${selectedTag}`;
      setField('image', fullImage);
    }
  }, [selectedRepo, selectedTag, form.team, setField]);

  // Auto-generate ingress hostname from app name (web-app only)
  useEffect(() => {
    if (form.appType === 'web-app' && form.appName && !ingressManual) {
      setField('ingress', `${form.appName}.apps.sre.example.com`);
    }
  }, [form.appName, form.appType, ingressManual, setField]);

  // Debounced ingress hostname check
  useEffect(() => {
    if (ingressDebounceRef.current) {
      clearTimeout(ingressDebounceRef.current);
    }
    if (!form.ingress || form.appType !== 'web-app') {
      setIngressStatus(null);
      return;
    }
    setIngressStatus({ checking: true });
    ingressDebounceRef.current = setTimeout(() => {
      checkIngressHostname(form.ingress)
        .then((res) => setIngressStatus({ checking: false, available: res.available, usedBy: res.usedBy }))
        .catch(() => setIngressStatus(null));
    }, 500);
    return () => {
      if (ingressDebounceRef.current) {
        clearTimeout(ingressDebounceRef.current);
      }
    };
  }, [form.ingress, form.appType]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    // Block submit if ingress hostname is taken
    if (ingressStatus && !ingressStatus.checking && ingressStatus.available === false) {
      return;
    }
    submit();
  }, [submit, ingressStatus]);

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const filteredTags = tags.filter((t) => t.name !== 'latest');

  const harborAvailable = form.team && repos.length > 0;

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

                    {harborAvailable ? (
                      /* Harbor browsing mode */
                      <div className="mt-1 space-y-3">
                        {/* Repository search/dropdown */}
                        <div ref={repoDropdownRef} className="relative">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                            <input
                              type="text"
                              value={repoSearch}
                              onChange={(e) => {
                                setRepoSearch(e.target.value);
                                setShowRepoDropdown(true);
                              }}
                              onFocus={() => setShowRepoDropdown(true)}
                              placeholder={loadingRepos ? 'Loading repositories...' : 'Search repositories...'}
                              disabled={loadingRepos}
                              className="block w-full rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-8 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                            />
                            {loadingRepos ? (
                              <Loader2 className="absolute right-3 top-2.5 h-3.5 w-3.5 animate-spin text-slate-500" />
                            ) : (
                              <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                            )}
                          </div>
                          {showRepoDropdown && !loadingRepos && (
                            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-600 bg-slate-800 shadow-xl">
                              {filteredRepos.length > 0 ? (
                                filteredRepos.map((repo) => (
                                  <button
                                    key={repo.fullName}
                                    type="button"
                                    onClick={() => {
                                      setSelectedRepo(repo.name);
                                      setRepoSearch(repo.name);
                                      setShowRepoDropdown(false);
                                    }}
                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-700 ${
                                      selectedRepo === repo.name ? 'bg-slate-700 text-cyan-400' : 'text-slate-200'
                                    }`}
                                  >
                                    <span>{repo.name}</span>
                                    <span className="text-xs text-slate-500">{repo.artifactCount} tag{repo.artifactCount !== 1 ? 's' : ''}</span>
                                  </button>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-sm text-slate-500">No repositories found</div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Tag dropdown */}
                        {selectedRepo && (
                          <div className="relative">
                            <select
                              value={selectedTag}
                              onChange={(e) => setSelectedTag(e.target.value)}
                              disabled={loadingTags}
                              className="block w-full appearance-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-8 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
                            >
                              <option value="">{loadingTags ? 'Loading tags...' : 'Select a tag...'}</option>
                              {filteredTags.map((tag) => (
                                <option key={tag.name} value={tag.name}>
                                  {tag.name}{tag.pushed ? ` (${new Date(tag.pushed).toLocaleDateString()})` : ''}
                                </option>
                              ))}
                            </select>
                            {loadingTags ? (
                              <Loader2 className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 animate-spin text-slate-500" />
                            ) : (
                              <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                            )}
                          </div>
                        )}

                        {/* Composed image reference */}
                        {selectedRepo && selectedTag && (
                          <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2">
                            <span className="text-xs text-slate-500">Image: </span>
                            <span className="text-xs font-mono text-cyan-400">
                              harbor.apps.sre.example.com/{form.team}/{selectedRepo}:{selectedTag}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Fallback: plain text input */
                      <>
                        <input
                          type="text"
                          value={form.image}
                          onChange={(e) => setField('image', e.target.value)}
                          placeholder="harbor.apps.sre.example.com/your-team/app-name:v1.0.0"
                          className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                        {!errors.image && !form.team && (
                          <p className="mt-1 text-xs text-slate-600">
                            Select a team below to browse Harbor repositories
                          </p>
                        )}
                        {!errors.image && form.team && repos.length === 0 && !loadingRepos && (
                          <p className="mt-1 text-xs text-slate-600">
                            No repositories found in Harbor for {form.team} — enter image manually
                          </p>
                        )}
                      </>
                    )}

                    {errors.image && <p className="mt-1 text-xs text-red-400">{errors.image}</p>}
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
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-medium text-slate-400">Ingress Hostname</label>
                        <button
                          type="button"
                          onClick={() => {
                            setIngressManual(!ingressManual);
                            if (ingressManual && form.appName) {
                              // Switching back to auto: regenerate
                              setField('ingress', `${form.appName}.apps.sre.example.com`);
                            }
                          }}
                          className="text-xs text-slate-500 hover:text-slate-300"
                        >
                          {ingressManual ? 'Auto-generate' : 'Edit manually'}
                        </button>
                      </div>
                      <div className="relative mt-1">
                        <input
                          type="text"
                          value={form.ingress}
                          onChange={(e) => {
                            if (!ingressManual) setIngressManual(true);
                            setField('ingress', e.target.value);
                          }}
                          placeholder="my-app.apps.sre.example.com"
                          readOnly={!ingressManual && !!form.appName}
                          className={`block w-full rounded-lg border bg-slate-900 px-3 py-2 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 ${
                            ingressStatus && !ingressStatus.checking && ingressStatus.available === false
                              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                              : ingressStatus && !ingressStatus.checking && ingressStatus.available === true
                                ? 'border-emerald-500/50 focus:border-cyan-500 focus:ring-cyan-500'
                                : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500'
                          } ${!ingressManual && form.appName ? 'text-slate-400' : ''}`}
                        />
                        {/* Status indicator */}
                        <div className="absolute right-3 top-2.5">
                          {ingressStatus?.checking && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                          )}
                          {ingressStatus && !ingressStatus.checking && ingressStatus.available === true && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          )}
                          {ingressStatus && !ingressStatus.checking && ingressStatus.available === false && (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                          )}
                        </div>
                      </div>
                      {ingressStatus && !ingressStatus.checking && ingressStatus.available === false && (
                        <p className="mt-1 text-xs text-red-400">
                          Hostname in use{ingressStatus.usedBy ? ` by ${ingressStatus.usedBy}` : ''} — choose a different name
                        </p>
                      )}
                      {ingressStatus && !ingressStatus.checking && ingressStatus.available === true && form.ingress && (
                        <p className="mt-1 text-xs text-emerald-400/70">Hostname available</p>
                      )}
                      {!ingressManual && !form.appName && (
                        <p className="mt-1 text-xs text-slate-600">Enter an app name above to auto-generate</p>
                      )}
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
              ) : ingressStatus && !ingressStatus.checking && ingressStatus.available === false ? (
                <p className="text-sm text-red-400">Ingress hostname is already in use</p>
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
                  disabled={submitting || (ingressStatus !== null && !ingressStatus.checking && ingressStatus.available === false)}
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
