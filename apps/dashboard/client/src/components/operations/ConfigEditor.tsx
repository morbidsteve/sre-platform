import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, ShieldAlert, Container, Cpu,
  Heart, Globe, Plus, X, AlertTriangle, Check,
} from 'lucide-react';
import type { OpsConfig, OpsProbeConfig, OpsPolicyException } from '../../api/ops';

// ── All Linux capabilities (full set) ────────────────────────────────────────
const ALL_CAPABILITIES = [
  'AUDIT_CONTROL', 'AUDIT_READ', 'AUDIT_WRITE',
  'BLOCK_SUSPEND', 'BPF', 'CHECKPOINT_RESTORE', 'CHOWN',
  'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER', 'FSETID',
  'IPC_LOCK', 'IPC_OWNER', 'KILL', 'LEASE', 'LINUX_IMMUTABLE',
  'MAC_ADMIN', 'MAC_OVERRIDE', 'MKNOD', 'NET_ADMIN', 'NET_BIND_SERVICE',
  'NET_BROADCAST', 'NET_RAW', 'PERFMON', 'SETFCAP', 'SETGID',
  'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_BOOT', 'SYS_CHROOT',
  'SYS_MODULE', 'SYS_NICE', 'SYS_PACCT', 'SYS_PTRACE', 'SYS_RAWIO',
  'SYS_RESOURCE', 'SYS_TIME', 'SYS_TTY_CONFIG', 'SYSLOG', 'WAKE_ALARM',
];

// ── Helper: collapsible section ────────────────────────────────────────────

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  modified?: boolean;
  children: React.ReactNode;
}

function Section({ title, icon, defaultOpen = true, modified = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-[var(--radius)] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-hover transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-text-dim">{icon}</span>
          <span className="text-[12px] font-semibold text-text-primary">{title}</span>
          {modified && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow/15 text-yellow uppercase tracking-wide">
              modified
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-dim" />
        )}
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-border space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Toggle row ─────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}

function ToggleRow({ label, description, value, onChange, danger = false }: ToggleRowProps) {
  return (
    <label className="flex items-center justify-between cursor-pointer gap-4">
      <div>
        <div className={`text-[12px] font-medium ${danger && value ? 'text-red' : 'text-text-primary'}`}>
          {label}
        </div>
        <div className="text-[11px] text-text-dim leading-relaxed">{description}</div>
      </div>
      {/* Toggle switch */}
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative flex-shrink-0 w-9 h-5 rounded-full border transition-colors ${
          value
            ? danger
              ? 'bg-red/80 border-red/60'
              : 'bg-accent border-accent'
            : 'bg-surface border-border'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

// ── Probe editor ───────────────────────────────────────────────────────────

interface ProbeEditorProps {
  label: string;
  value: OpsProbeConfig;
  onChange: (v: OpsProbeConfig) => void;
}

function ProbeEditor({ label, value, onChange }: ProbeEditorProps) {
  const set = (k: keyof OpsProbeConfig, v: string | number) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold text-text-primary">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        {/* Type */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">Type</label>
          <select
            value={value.type}
            onChange={(e) => set('type', e.target.value)}
            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="http">HTTP GET</option>
            <option value="tcp">TCP Socket</option>
            <option value="exec">Exec</option>
          </select>
        </div>

        {/* Port */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">Port</label>
          <input
            type="number"
            value={value.port}
            onChange={(e) => set('port', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* Path (only for http) */}
        {value.type === 'http' && (
          <div className="col-span-2">
            <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">Path</label>
            <input
              type="text"
              value={value.path}
              onChange={(e) => set('path', e.target.value)}
              className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
              placeholder="/healthz"
            />
          </div>
        )}

        {/* Initial delay */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">
            Initial Delay (s)
          </label>
          <input
            type="number"
            value={value.initialDelaySeconds}
            onChange={(e) => set('initialDelaySeconds', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* Period */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">
            Period (s)
          </label>
          <input
            type="number"
            value={value.periodSeconds}
            onChange={(e) => set('periodSeconds', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* Failure threshold */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 uppercase tracking-wide">
            Failure Threshold
          </label>
          <input
            type="number"
            value={value.failureThreshold}
            onChange={(e) => set('failureThreshold', Number(e.target.value))}
            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>
    </div>
  );
}

// ── Slider with labels ─────────────────────────────────────────────────────

interface SliderFieldProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

function SliderField({ label, value, options, onChange }: SliderFieldProps) {
  const idx = options.indexOf(value);
  const safeIdx = idx === -1 ? 0 : idx;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-text-muted uppercase tracking-wide">{label}</label>
        <span className="text-[11px] font-mono text-accent">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={options.length - 1}
        value={safeIdx}
        onChange={(e) => onChange(options[Number(e.target.value)])}
        className="w-full accent-accent h-1.5 rounded-full"
      />
      <div className="flex justify-between text-[9px] font-mono text-text-muted mt-0.5">
        <span>{options[0]}</span>
        <span>{options[options.length - 1]}</span>
      </div>
    </div>
  );
}

// ── Env var editor ─────────────────────────────────────────────────────────

interface EnvEditorProps {
  env: { name: string; value: string }[];
  onChange: (env: { name: string; value: string }[]) => void;
}

function EnvEditor({ env, onChange }: EnvEditorProps) {
  const set = (i: number, field: 'name' | 'value', v: string) => {
    const next = [...env];
    next[i] = { ...next[i], [field]: v };
    onChange(next);
  };
  const add = () => onChange([...env, { name: '', value: '' }]);
  const remove = (i: number) => onChange(env.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {env.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={e.name}
            onChange={(ev) => set(i, 'name', ev.target.value)}
            placeholder="NAME"
            className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
          />
          <span className="text-text-dim text-[11px]">=</span>
          <input
            type="text"
            value={e.value}
            onChange={(ev) => set(i, 'value', ev.target.value)}
            placeholder="value"
            className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-text-dim hover:text-red transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-hover font-mono transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add variable
      </button>
    </div>
  );
}

// ── CPU / Memory slider options ────────────────────────────────────────────

const CPU_OPTIONS = [
  '50m', '100m', '200m', '500m',
  '1', '2', '4',
];

const MEM_OPTIONS = [
  '64Mi', '128Mi', '256Mi', '512Mi',
  '1Gi', '2Gi', '4Gi', '8Gi',
];

// ── Diff display ───────────────────────────────────────────────────────────

function diffConfigs(original: OpsConfig, next: OpsConfig): string[] {
  const diffs: string[] = [];
  const check = (key: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push(`${key}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  };
  check('runAsRoot', original.runAsRoot, next.runAsRoot);
  check('writableFilesystem', original.writableFilesystem, next.writableFilesystem);
  check('allowPrivilegeEscalation', original.allowPrivilegeEscalation, next.allowPrivilegeEscalation);
  check('privileged', original.privileged, next.privileged);
  check('capabilities', original.capabilities, next.capabilities);
  check('port', original.port, next.port);
  check('imageTag', original.imageTag, next.imageTag);
  check('replicas', original.replicas, next.replicas);
  check('env', original.env, next.env);
  check('cpuRequest', original.cpuRequest, next.cpuRequest);
  check('cpuLimit', original.cpuLimit, next.cpuLimit);
  check('memoryRequest', original.memoryRequest, next.memoryRequest);
  check('memoryLimit', original.memoryLimit, next.memoryLimit);
  check('livenessProbe', original.livenessProbe, next.livenessProbe);
  check('readinessProbe', original.readinessProbe, next.readinessProbe);
  check('ingressHost', original.ingressHost, next.ingressHost);
  check('backendProtocol', original.backendProtocol, next.backendProtocol);
  return diffs;
}

// ── Main ConfigEditor ──────────────────────────────────────────────────────

interface ConfigEditorProps {
  config: OpsConfig;
  policyExceptions: OpsPolicyException[];
  availableTags?: string[];
  onApply: (config: OpsConfig) => Promise<void>;
  applying: boolean;
}

export function ConfigEditor({
  config: originalConfig,
  policyExceptions,
  availableTags = [],
  onApply,
  applying,
}: ConfigEditorProps) {
  const [cfg, setCfg] = useState<OpsConfig>(originalConfig);
  const [showDiff, setShowDiff] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset when original config changes (e.g., after a refresh)
  useEffect(() => {
    setCfg(originalConfig);
    setShowDiff(false);
    setConfirmOpen(false);
  }, [originalConfig]);

  const update = useCallback(<K extends keyof OpsConfig>(key: K, value: OpsConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleCapability = useCallback((cap: string) => {
    setCfg((prev) => {
      const caps = prev.capabilities || [];
      const next = caps.includes(cap) ? caps.filter((c) => c !== cap) : [...caps, cap];
      return { ...prev, capabilities: next };
    });
  }, []);

  const diffs = diffConfigs(originalConfig, cfg);
  const hasChanges = diffs.length > 0;

  const handleApplyClick = () => {
    if (hasChanges) setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setConfirmOpen(false);
    await onApply(cfg);
  };

  // Security section: is anything dangerous enabled?
  const securityModified =
    cfg.runAsRoot || cfg.writableFilesystem || cfg.allowPrivilegeEscalation ||
    cfg.privileged || (cfg.capabilities?.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      {/* ── Security Context ── */}
      <Section
        title="Security Context"
        icon={<ShieldAlert className="w-3.5 h-3.5" />}
        modified={securityModified}
        defaultOpen
      >
        <div className="space-y-4">
          <ToggleRow
            label="Run as Root"
            description="Sets runAsNonRoot: false, runAsUser: 0"
            value={cfg.runAsRoot}
            onChange={(v) => update('runAsRoot', v)}
            danger
          />
          <ToggleRow
            label="Writable Filesystem"
            description="Sets readOnlyRootFilesystem: false"
            value={cfg.writableFilesystem}
            onChange={(v) => update('writableFilesystem', v)}
            danger
          />
          <ToggleRow
            label="Allow Privilege Escalation"
            description="Sets allowPrivilegeEscalation: true"
            value={cfg.allowPrivilegeEscalation}
            onChange={(v) => update('allowPrivilegeEscalation', v)}
            danger
          />
          <ToggleRow
            label="Privileged Container"
            description="Sets privileged: true — full host access"
            value={cfg.privileged}
            onChange={(v) => update('privileged', v)}
            danger
          />

          {/* Linux Capabilities */}
          <div>
            <div className="text-[11px] font-medium text-text-primary mb-2">
              Linux Capabilities
              {(cfg.capabilities?.length ?? 0) > 0 && (
                <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded bg-yellow/15 text-yellow">
                  {cfg.capabilities.length} added
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CAPABILITIES.map((cap) => {
                const active = (cfg.capabilities || []).includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCapability(cap)}
                    className={`px-2 py-0.5 text-[10px] font-mono border rounded-[var(--radius)] transition-colors ${
                      active
                        ? 'border-yellow/60 bg-yellow/10 text-yellow'
                        : 'border-border bg-bg text-text-dim hover:border-border-hover hover:text-text-primary'
                    }`}
                  >
                    {cap}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current policy exceptions */}
          {policyExceptions.length > 0 && (
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">
                Active Policy Exceptions
              </div>
              <div className="space-y-1">
                {policyExceptions.map((pe, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-[10px] font-mono px-2.5 py-1.5 rounded border border-yellow/20 bg-yellow/5"
                  >
                    <AlertTriangle className="w-2.5 h-2.5 text-yellow flex-shrink-0" />
                    <span className="text-yellow font-semibold">{pe.policy}</span>
                    <span className="text-text-dim">— {pe.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Container Settings ── */}
      <Section
        title="Container Settings"
        icon={<Container className="w-3.5 h-3.5" />}
        modified={
          cfg.port !== originalConfig.port ||
          cfg.imageTag !== originalConfig.imageTag ||
          cfg.replicas !== originalConfig.replicas ||
          JSON.stringify(cfg.env) !== JSON.stringify(originalConfig.env)
        }
      >
        <div className="space-y-4">
          {/* Port */}
          <div>
            <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-1">
              Container Port
            </label>
            <input
              type="number"
              value={cfg.port}
              onChange={(e) => update('port', Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
              placeholder="8080"
            />
          </div>

          {/* Image tag */}
          <div>
            <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-1">
              Image Tag
            </label>
            {availableTags.length > 0 ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cfg.imageTag}
                  onChange={(e) => update('imageTag', e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                />
                <select
                  value={cfg.imageTag}
                  onChange={(e) => update('imageTag', e.target.value)}
                  className="px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">— available —</option>
                  {availableTags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="text"
                value={cfg.imageTag}
                onChange={(e) => update('imageTag', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                placeholder="v1.2.3"
              />
            )}
          </div>

          {/* Replicas slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-muted uppercase tracking-wide">Replicas</label>
              <span className="text-[11px] font-mono text-accent">{cfg.replicas}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={cfg.replicas}
              onChange={(e) => update('replicas', Number(e.target.value))}
              className="w-full accent-accent h-1.5 rounded-full"
            />
            <div className="flex justify-between text-[9px] font-mono text-text-muted mt-0.5">
              <span>1</span>
              <span>10</span>
            </div>
          </div>

          {/* Environment variables */}
          <div>
            <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-2">
              Environment Variables
            </label>
            <EnvEditor
              env={cfg.env}
              onChange={(env) => update('env', env)}
            />
          </div>
        </div>
      </Section>

      {/* ── Resources ── */}
      <Section
        title="Resources"
        icon={<Cpu className="w-3.5 h-3.5" />}
        modified={
          cfg.cpuRequest !== originalConfig.cpuRequest ||
          cfg.cpuLimit !== originalConfig.cpuLimit ||
          cfg.memoryRequest !== originalConfig.memoryRequest ||
          cfg.memoryLimit !== originalConfig.memoryLimit
        }
      >
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="text-[11px] font-semibold text-text-primary">CPU</div>
            <SliderField
              label="Request"
              value={cfg.cpuRequest}
              options={CPU_OPTIONS}
              onChange={(v) => update('cpuRequest', v)}
            />
            <SliderField
              label="Limit"
              value={cfg.cpuLimit}
              options={CPU_OPTIONS}
              onChange={(v) => update('cpuLimit', v)}
            />
          </div>
          <div className="space-y-4">
            <div className="text-[11px] font-semibold text-text-primary">Memory</div>
            <SliderField
              label="Request"
              value={cfg.memoryRequest}
              options={MEM_OPTIONS}
              onChange={(v) => update('memoryRequest', v)}
            />
            <SliderField
              label="Limit"
              value={cfg.memoryLimit}
              options={MEM_OPTIONS}
              onChange={(v) => update('memoryLimit', v)}
            />
          </div>
        </div>
      </Section>

      {/* ── Health Probes ── */}
      <Section
        title="Health Probes"
        icon={<Heart className="w-3.5 h-3.5" />}
        defaultOpen={false}
        modified={
          JSON.stringify(cfg.livenessProbe) !== JSON.stringify(originalConfig.livenessProbe) ||
          JSON.stringify(cfg.readinessProbe) !== JSON.stringify(originalConfig.readinessProbe)
        }
      >
        <div className="space-y-6">
          <ProbeEditor
            label="Liveness Probe"
            value={cfg.livenessProbe}
            onChange={(v) => update('livenessProbe', v)}
          />
          <div className="border-t border-border" />
          <ProbeEditor
            label="Readiness Probe"
            value={cfg.readinessProbe}
            onChange={(v) => update('readinessProbe', v)}
          />
        </div>
      </Section>

      {/* ── Networking ── */}
      <Section
        title="Networking"
        icon={<Globe className="w-3.5 h-3.5" />}
        defaultOpen={false}
        modified={
          cfg.ingressHost !== originalConfig.ingressHost ||
          cfg.backendProtocol !== originalConfig.backendProtocol
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-1">
              Ingress Host
            </label>
            <input
              type="text"
              value={cfg.ingressHost}
              onChange={(e) => update('ingressHost', e.target.value)}
              className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-[var(--radius)] text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
              placeholder="my-app.apps.sre.example.com"
            />
          </div>
          <div>
            <label className="block text-[10px] text-text-muted uppercase tracking-wide mb-1">
              Backend Protocol
            </label>
            <div className="flex gap-2">
              {(['HTTP', 'HTTPS'] as const).map((proto) => (
                <button
                  key={proto}
                  type="button"
                  onClick={() => update('backendProtocol', proto)}
                  className={`px-3 py-1.5 text-[11px] font-mono border rounded-[var(--radius)] transition-colors ${
                    cfg.backendProtocol === proto
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg text-text-dim hover:border-border-hover'
                  }`}
                >
                  {proto}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Diff preview ── */}
      {hasChanges && (
        <div>
          <button
            type="button"
            onClick={() => setShowDiff((s) => !s)}
            className="text-[11px] text-accent hover:text-accent-hover font-mono underline transition-colors"
          >
            {showDiff ? 'Hide' : 'Show'} changes ({diffs.length})
          </button>
          {showDiff && (
            <div className="mt-2 bg-[#060911] border border-border rounded-[var(--radius)] p-3 space-y-1">
              {diffs.map((d, i) => (
                <div key={i} className="text-[10px] font-mono text-yellow">
                  ~ {d}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Apply button ── */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleApplyClick}
          disabled={!hasChanges || applying}
          className={`w-full py-2.5 px-4 rounded-[var(--radius)] text-sm font-semibold transition-all ${
            hasChanges && !applying
              ? 'bg-yellow text-gray-900 hover:bg-yellow/90 cursor-pointer'
              : 'bg-surface border border-border text-text-dim cursor-not-allowed'
          }`}
        >
          {applying ? 'Applying…' : hasChanges ? `Apply ${diffs.length} Change${diffs.length !== 1 ? 's' : ''}` : 'No Changes'}
        </button>
      </div>

      {/* ── Confirm modal ── */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl"
            style={{ animation: 'confirmIn 0.2s ease-out' }}
          >
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-bright flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow" />
                Confirm Configuration Change
              </h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-text-dim mb-3">
                The following changes will be applied to the running deployment immediately.
                Pods will be rolled out with the new configuration.
              </p>
              <div className="bg-[#060911] border border-border rounded-[var(--radius)] p-3 space-y-1 max-h-48 overflow-y-auto">
                {diffs.map((d, i) => (
                  <div key={i} className="text-[10px] font-mono text-yellow">~ {d}</div>
                ))}
              </div>
              {securityModified && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded border border-red/30 bg-red/5 text-[11px] text-red">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  Security overrides detected. This may create Kyverno policy violations.
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center gap-2 justify-end">
              <button
                className="btn text-xs !py-1.5 !px-3 !min-h-0"
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn text-xs !py-1.5 !px-3 !min-h-0 flex items-center gap-1 bg-yellow/20 border-yellow/40 text-yellow hover:bg-yellow/30"
                onClick={handleConfirm}
              >
                <Check className="w-3 h-3" />
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
