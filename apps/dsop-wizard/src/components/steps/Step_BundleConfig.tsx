import { useState, useCallback, useRef } from 'react';
import { Upload, Plus, Trash2, Lock, Package, Code, X, ArrowLeft, ArrowRight, Database, Server, ShieldCheck, HardDrive } from 'lucide-react';
import { Button } from '../ui/Button';
import type { BundleBuilderConfig } from '../../types';

// ── Props ──

interface BundleConfigProps {
  config: BundleBuilderConfig;
  onUpdate: (updates: Partial<BundleBuilderConfig>) => void;
  onFilesChange: (files: { primaryImage: File | null; components: Map<number, File>; source: File | null }) => void;
  onNext: () => void;
  onBack: () => void;
}

// ── Constants ──

const APP_TYPES: { value: BundleBuilderConfig['appType']; label: string }[] = [
  { value: 'web-app', label: 'Web App' },
  { value: 'api-service', label: 'API Service' },
  { value: 'worker', label: 'Worker' },
  { value: 'cronjob', label: 'Cron Job' },
];

const COMPONENT_TYPES = [
  { value: 'sidecar', label: 'Sidecar' },
  { value: 'init-container', label: 'Init Container' },
  { value: 'worker', label: 'Worker' },
  { value: 'proxy', label: 'Proxy' },
  { value: 'other', label: 'Other' },
];

const RESOURCE_TIERS: { value: BundleBuilderConfig['resources']; label: string; cpu: string; memory: string }[] = [
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

const MAX_COMPONENTS = 5;

const inputClasses =
  'w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500';

const selectClasses =
  'w-full bg-navy-900 border border-navy-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500';

// ── Helpers ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

function FileDropZone({
  accept,
  file,
  onSelect,
  onRemove,
  label,
  helper,
}: {
  accept: string;
  file: { name: string; size: number } | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  label: string;
  helper?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) onSelect(dropped);
    },
    [onSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) onSelect(selected);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [onSelect],
  );

  if (file) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-navy-600 bg-navy-800/50 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Package className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-gray-200 font-mono truncate">{file.name}</p>
            <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-gray-500 hover:text-red-400 transition-colors shrink-0 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        dragOver
          ? 'border-cyan-500 bg-cyan-500/5'
          : 'border-navy-600 bg-navy-800/50 hover:border-navy-500'
      }`}
    >
      <Upload className={`w-6 h-6 mx-auto ${dragOver ? 'text-cyan-400' : 'text-gray-500'}`} />
      <p className="mt-2 text-sm text-gray-300">{label}</p>
      {helper && <p className="mt-1 text-xs text-gray-500">{helper}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}

// ── Component ──

export function Step_BundleConfig({ config, onUpdate, onFilesChange, onNext, onBack }: BundleConfigProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Local file state — File objects can't be serialized into config
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [componentFiles, setComponentFiles] = useState<Map<number, File>>(new Map());
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  const showPort = config.appType === 'web-app' || config.appType === 'api-service';
  const showIngress = config.appType === 'web-app';

  // ── File handlers ──

  const notifyFilesChange = useCallback(
    (primary: File | null, components: Map<number, File>, source: File | null) => {
      onFilesChange({ primaryImage: primary, components, source });
    },
    [onFilesChange],
  );

  const handlePrimaryFileSelect = useCallback(
    (file: File) => {
      setPrimaryFile(file);
      onUpdate({ primaryImageFile: { name: file.name, size: file.size } });
      notifyFilesChange(file, componentFiles, sourceFile);
    },
    [onUpdate, notifyFilesChange, componentFiles, sourceFile],
  );

  const handlePrimaryFileRemove = useCallback(() => {
    setPrimaryFile(null);
    onUpdate({ primaryImageFile: null });
    notifyFilesChange(null, componentFiles, sourceFile);
  }, [onUpdate, notifyFilesChange, componentFiles, sourceFile]);

  const handleComponentFileSelect = useCallback(
    (index: number, file: File) => {
      const next = new Map(componentFiles);
      next.set(index, file);
      setComponentFiles(next);

      const updated = config.components.map((c, i) =>
        i === index ? { ...c, imageFile: { name: file.name, size: file.size } } : c,
      );
      onUpdate({ components: updated });
      notifyFilesChange(primaryFile, next, sourceFile);
    },
    [onUpdate, notifyFilesChange, primaryFile, componentFiles, sourceFile, config.components],
  );

  const handleComponentFileRemove = useCallback(
    (index: number) => {
      const next = new Map(componentFiles);
      next.delete(index);
      setComponentFiles(next);

      const updated = config.components.map((c, i) =>
        i === index ? { ...c, imageFile: null } : c,
      );
      onUpdate({ components: updated });
      notifyFilesChange(primaryFile, next, sourceFile);
    },
    [onUpdate, notifyFilesChange, primaryFile, componentFiles, sourceFile, config.components],
  );

  const handleSourceFileSelect = useCallback(
    (file: File) => {
      setSourceFile(file);
      onUpdate({ sourceFile: { name: file.name, size: file.size } });
      notifyFilesChange(primaryFile, componentFiles, file);
    },
    [onUpdate, notifyFilesChange, primaryFile, componentFiles],
  );

  const handleSourceFileRemove = useCallback(() => {
    setSourceFile(null);
    onUpdate({ sourceFile: null });
    notifyFilesChange(primaryFile, componentFiles, null);
  }, [onUpdate, notifyFilesChange, primaryFile, componentFiles]);

  // ── Component management ──

  function addComponent() {
    if (config.components.length >= MAX_COMPONENTS) return;
    onUpdate({
      components: [...config.components, { name: '', type: 'sidecar', imageFile: null }],
    });
  }

  function updateComponent(index: number, field: 'name' | 'type', value: string) {
    const updated = config.components.map((c, i) =>
      i === index ? { ...c, [field]: value } : c,
    );
    onUpdate({ components: updated });
  }

  function removeComponent(index: number) {
    // Clean up the file reference
    const next = new Map<number, File>();
    componentFiles.forEach((file, key) => {
      if (key < index) next.set(key, file);
      else if (key > index) next.set(key - 1, file);
      // skip the removed index
    });
    setComponentFiles(next);

    const updated = config.components.filter((_, i) => i !== index);
    onUpdate({ components: updated });
    notifyFilesChange(primaryFile, next, sourceFile);
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
      const { secret: _s, ...rest } = item;
      const updated = config.env.map((e, i) => (i === index ? { ...rest, value: '' } : e));
      onUpdate({ env: updated });
    } else {
      const { value: _v, ...rest } = item;
      const updated = config.env.map((e, i) => (i === index ? { ...rest, secret: '' } : e));
      onUpdate({ env: updated });
    }
  }

  // ── Validation ──

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!config.name.trim()) {
      errs.name = 'App name is required';
    } else if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(config.name) && config.name.length > 1) {
      errs.name = 'Must be kebab-case (lowercase letters, numbers, hyphens)';
    } else if (config.name.length === 1 && !/^[a-z]$/.test(config.name)) {
      errs.name = 'Must start with a lowercase letter';
    }
    if (!config.version.trim()) {
      errs.version = 'Version is required';
    }
    if (!config.primaryImageFile) {
      errs.primaryImage = 'Primary container image is required';
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
    setTouched({ name: true, version: true, primaryImage: true });
    if (Object.keys(errs).length === 0) {
      onNext();
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">Configure your bundle</h2>
        <p className="mt-2 text-sm text-gray-400">
          Build a deployment bundle with your container images, configuration, and optional source code.
        </p>
      </div>

      {/* ── Section 1: App Info ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Application Info</h3>

        {/* App Name */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">
            App Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={config.name}
            onChange={(e) =>
              onUpdate({
                name: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '-')
                  .replace(/--+/g, '-'),
              })
            }
            onBlur={() => handleBlur('name')}
            placeholder="my-app"
            className={`${inputClasses} ${touched.name && errors.name ? 'border-red-500 focus:ring-red-500' : ''}`}
          />
          {touched.name && errors.name && (
            <p className="text-xs text-red-400">{errors.name}</p>
          )}
        </div>

        {/* Version */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">
            Version <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={config.version}
            onChange={(e) => onUpdate({ version: e.target.value })}
            onBlur={() => handleBlur('version')}
            placeholder="1.0.0"
            className={`${inputClasses} font-mono w-48 ${touched.version && errors.version ? 'border-red-500 focus:ring-red-500' : ''}`}
          />
          {touched.version && errors.version && (
            <p className="text-xs text-red-400">{errors.version}</p>
          )}
        </div>

        {/* Author Name */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Author Name</label>
            <input
              type="text"
              value={config.author}
              onChange={(e) => onUpdate({ author: e.target.value })}
              placeholder="Jane Doe"
              className={inputClasses}
            />
          </div>

          {/* Author Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Author Email</label>
            <input
              type="text"
              value={config.email}
              onChange={(e) => onUpdate({ email: e.target.value })}
              placeholder="jane@example.com"
              className={inputClasses}
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">Description</label>
          <textarea
            value={config.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Brief description of your application..."
            rows={3}
            className={`${inputClasses} resize-none`}
          />
        </div>
      </div>

      {/* ── Section 2: App Type & Settings ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Type &amp; Settings</h3>

        {/* App Type */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-300">App Type</label>
          <select
            value={config.appType}
            onChange={(e) => onUpdate({ appType: e.target.value as BundleBuilderConfig['appType'] })}
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

        {/* Resources */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">Resources</label>
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

        {/* Ingress */}
        {showIngress && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Ingress Hostname</label>
            <input
              type="text"
              value={config.ingress}
              onChange={(e) => onUpdate({ ingress: e.target.value })}
              placeholder={`${config.name || 'my-app'}.apps.sre.example.com`}
              className={`${inputClasses} font-mono`}
            />
            <p className="text-xs text-gray-600">Leave blank to auto-generate from app name.</p>
          </div>
        )}
      </div>

      {/* ── Section 3: Container Images ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Container Images</h3>

        {/* Primary Image */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Primary Image <span className="text-red-400">*</span>
          </label>
          <FileDropZone
            accept=".tar"
            file={config.primaryImageFile}
            onSelect={handlePrimaryFileSelect}
            onRemove={handlePrimaryFileRemove}
            label="Drop a .tar image file here, or click to browse"
            helper="Export with: docker save my-app:v1.0.0 > my-app.tar"
          />
          {touched.primaryImage && errors.primaryImage && (
            <p className="text-xs text-red-400">{errors.primaryImage}</p>
          )}
        </div>

        {/* Additional Components */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-300">Additional Components</label>
            {config.components.length < MAX_COMPONENTS && (
              <button
                type="button"
                onClick={addComponent}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Component
              </button>
            )}
          </div>

          {config.components.length === 0 ? (
            <p className="text-xs text-gray-600">No additional components. Click above to add sidecars, init containers, etc.</p>
          ) : (
            <div className="space-y-4">
              {config.components.map((comp, idx) => (
                <div key={idx} className="rounded-lg border border-navy-700 bg-navy-900/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">Component {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeComponent(idx)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500">Name</label>
                      <input
                        type="text"
                        value={comp.name}
                        onChange={(e) => updateComponent(idx, 'name', e.target.value)}
                        placeholder="component-name"
                        className={inputClasses}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-gray-500">Type</label>
                      <select
                        value={comp.type}
                        onChange={(e) => updateComponent(idx, 'type', e.target.value)}
                        className={selectClasses}
                      >
                        {COMPONENT_TYPES.map((ct) => (
                          <option key={ct.value} value={ct.value}>
                            {ct.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <FileDropZone
                    accept=".tar"
                    file={comp.imageFile}
                    onSelect={(file) => handleComponentFileSelect(idx, file)}
                    onRemove={() => handleComponentFileRemove(idx)}
                    label="Drop component .tar image here"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 4: Platform Services ── */}
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

      {/* ── Section 5: Environment Variables ── */}
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

      {/* ── Section 6: Source Code ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Source Code</h3>
        <ServiceToggle
          enabled={config.sourceIncluded}
          onToggle={() => {
            const next = !config.sourceIncluded;
            onUpdate({ sourceIncluded: next });
            if (!next) {
              // Clear source file when disabling
              setSourceFile(null);
              onUpdate({ sourceIncluded: false, sourceFile: null });
              notifyFilesChange(primaryFile, componentFiles, null);
            }
          }}
          icon={<Code className="w-4 h-4" />}
          label="Include source code for SAST scanning"
        >
          <div className="space-y-2">
            <FileDropZone
              accept=".zip,.tar.gz,.tgz"
              file={config.sourceFile}
              onSelect={handleSourceFileSelect}
              onRemove={handleSourceFileRemove}
              label="Drop a .zip or .tar.gz source archive"
              helper="Including source enables static analysis in the security pipeline"
            />
          </div>
        </ServiceToggle>
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
