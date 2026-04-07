import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, ShieldAlert, ChevronDown, ChevronRight, Loader2, FileWarning } from 'lucide-react';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { HelpTooltip } from '../HelpTooltip';
import { fetchTeams } from '../../api';
import type { AppInfo, AccessLevel, Classification, SecurityException, SecurityExceptionType, SecurityCategorization, DataType, FipsLevel } from '../../types';
import type { User } from '../../types';

interface Step2Props {
  appInfo: AppInfo;
  user: User | null;
  onUpdate: (info: Partial<AppInfo>) => void;
  onBack: () => void;
  onNext: () => void;
  isAnalyzing: boolean;
  securityExceptions: SecurityException[];
  onUpdateSecurityExceptions: (exceptions: SecurityException[]) => void;
  securityCategorization: SecurityCategorization;
  onUpdateSecurityCategorization: (categorization: Partial<SecurityCategorization>) => void;
}

const dataTypeDefinitions: { value: DataType; label: string; description: string; impactLevel: FipsLevel }[] = [
  { value: 'public', label: 'Public Data', description: 'Publicly available information', impactLevel: 'low' },
  { value: 'cui', label: 'CUI', description: 'Controlled Unclassified Information (NIST 800-171)', impactLevel: 'moderate' },
  { value: 'pii', label: 'PII', description: 'Personally Identifiable Information', impactLevel: 'moderate' },
  { value: 'phi', label: 'PHI', description: 'Protected Health Information (HIPAA)', impactLevel: 'high' },
  { value: 'financial', label: 'Financial', description: 'Financial records or payment data', impactLevel: 'high' },
];

const fipsLevels: { value: FipsLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
];

const exceptionDefinitions: { type: SecurityExceptionType; label: string; description: string }[] = [
  { type: 'run_as_root', label: 'Run as Root', description: 'Application requires root (UID 0) to function (e.g., VNC servers, system tools)' },
  { type: 'writable_filesystem', label: 'Writable Filesystem', description: 'Application needs to write to its own filesystem (e.g., temp files, caches)' },
  { type: 'host_networking', label: 'Host Networking', description: 'Application requires host network access' },
  { type: 'privileged_container', label: 'Privileged Container', description: 'Application requires full Linux capabilities' },
];

const classificationOptions: { value: Classification; label: string }[] = [
  { value: 'UNCLASSIFIED', label: 'UNCLASSIFIED' },
  { value: 'CUI', label: 'CUI' },
  { value: 'CONFIDENTIAL', label: 'CONFIDENTIAL' },
  { value: 'SECRET', label: 'SECRET' },
  { value: 'TOP SECRET', label: 'TOP SECRET' },
  { value: 'TS//SCI', label: 'TS//SCI' },
];

const defaultTeamOptions = [
  { value: 'team-alpha', label: 'team-alpha' },
  { value: 'team-bravo', label: 'team-bravo' },
  { value: 'team-charlie', label: 'team-charlie' },
  { value: 'default', label: 'default' },
];

const accessOptions: { value: AccessLevel; label: string; desc: string }[] = [
  { value: 'everyone', label: 'Everyone', desc: 'All authenticated users' },
  { value: 'restricted', label: 'Restricted', desc: 'Specific groups only' },
  { value: 'private', label: 'Private', desc: 'Admins only' },
];

export function Step2_AppInfo({
  appInfo,
  user,
  onUpdate,
  onBack,
  onNext,
  isAnalyzing,
  securityExceptions,
  onUpdateSecurityExceptions,
  securityCategorization,
  onUpdateSecurityCategorization,
}: Step2Props) {
  const [teamOptions, setTeamOptions] = useState(defaultTeamOptions);
  const [teamsLoading, setTeamsLoading] = useState(true);

  // Fetch available teams/namespaces dynamically
  useEffect(() => {
    let cancelled = false;
    fetchTeams().then((teams) => {
      if (cancelled) return;
      setTeamOptions(teams.map((t) => ({ value: t, label: t })));
      setTeamsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setTeamsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const [exceptionsExpanded, setExceptionsExpanded] = useState(
    securityExceptions.some((e) => e.enabled)
  );

  // Auto-expand when bundle manifest pre-fills exceptions
  useEffect(() => {
    if (securityExceptions.some((e) => e.enabled)) {
      setExceptionsExpanded(true);
    }
  }, [securityExceptions]);

  const toggleException = (type: SecurityExceptionType) => {
    const existing = securityExceptions.find((e) => e.type === type);
    if (existing) {
      onUpdateSecurityExceptions(
        securityExceptions.map((e) =>
          e.type === type ? { ...e, enabled: !e.enabled } : e
        )
      );
    } else {
      onUpdateSecurityExceptions([
        ...securityExceptions,
        { type, justification: '', enabled: true },
      ]);
    }
  };

  const updateJustification = (type: SecurityExceptionType, justification: string) => {
    onUpdateSecurityExceptions(
      securityExceptions.map((e) =>
        e.type === type ? { ...e, justification } : e
      )
    );
  };

  const getException = (type: SecurityExceptionType): SecurityException | undefined =>
    securityExceptions.find((e) => e.type === type);
  // Auto-fill contact from SSO
  useEffect(() => {
    if (user?.email && !appInfo.contact) {
      onUpdate({ contact: user.email });
    }
  }, [user, appInfo.contact, onUpdate]);

  const enabledExceptions = securityExceptions.filter((e) => e.enabled);
  const exceptionsValid = enabledExceptions.every((e) => e.justification.trim().length >= 5);
  const isValid = appInfo.name.trim().length > 0 && exceptionsValid;

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">
          Application Details
        </h2>
        <p className="text-gray-400 mt-2">
          Configure metadata, classification, and access controls
        </p>
      </div>

      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-5">
        <Input
          label="App Name"
          placeholder="my-app"
          value={appInfo.name}
          onChange={(e) =>
            onUpdate({
              name: e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/--+/g, '-'),
            })
          }
        />

        <Input
          label="Description"
          placeholder="Brief description of this application"
          value={appInfo.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="relative">
            <Select
              label={teamsLoading ? 'Team / Namespace (loading...)' : 'Team / Namespace'}
              options={teamOptions}
              value={appInfo.team}
              onChange={(e) => onUpdate({ team: e.target.value })}
            />
            {teamsLoading && (
              <Loader2 className="w-4 h-4 text-gray-500 animate-spin absolute right-10 top-9" />
            )}
          </div>
          <Select
            label="Classification"
            options={classificationOptions}
            value={appInfo.classification}
            onChange={(e) =>
              onUpdate({ classification: e.target.value as Classification })
            }
          />
        </div>

        <Input
          label="Contact Email"
          placeholder="user@sso.example.com"
          value={appInfo.contact}
          onChange={(e) => onUpdate({ contact: e.target.value })}
        />
      </div>

      {/* Access Control */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">
          Access Control
        </h3>
        <div className="space-y-3">
          {accessOptions.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                appInfo.accessLevel === opt.value
                  ? 'bg-cyan-500/10 border border-cyan-500/30'
                  : 'hover:bg-navy-700 border border-transparent'
              }`}
            >
              <input
                type="radio"
                name="access"
                checked={appInfo.accessLevel === opt.value}
                onChange={() => onUpdate({ accessLevel: opt.value })}
                className="w-4 h-4 text-cyan-500 bg-navy-800 border-navy-500 focus:ring-cyan-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-200">
                  {opt.label}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  ({opt.desc})
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Security Categorization (FIPS 199) */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileWarning className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-1">
            Security Categorization
            <span className="font-normal text-gray-600 ml-1">(FIPS 199)</span>
            <HelpTooltip term="FIPS 199" />
          </h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Select the types of data this application processes. Impact levels auto-adjust based on data sensitivity.
        </p>

        <div className="space-y-2 mb-5">
          {dataTypeDefinitions.map((dt) => {
            const selected = securityCategorization.dataTypes.includes(dt.value);
            return (
              <label
                key={dt.value}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  selected
                    ? 'bg-cyan-500/10 border border-cyan-500/30'
                    : 'hover:bg-navy-700 border border-transparent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const newTypes = selected
                      ? securityCategorization.dataTypes.filter((t) => t !== dt.value)
                      : [...securityCategorization.dataTypes, dt.value];
                    // Auto-set FIPS levels based on highest data sensitivity
                    const highestImpact: FipsLevel = newTypes.length === 0
                      ? 'low'
                      : newTypes.some((t) => dataTypeDefinitions.find((d) => d.value === t)?.impactLevel === 'high')
                        ? 'high'
                        : newTypes.some((t) => dataTypeDefinitions.find((d) => d.value === t)?.impactLevel === 'moderate')
                          ? 'moderate'
                          : 'low';
                    onUpdateSecurityCategorization({
                      dataTypes: newTypes,
                      confidentiality: highestImpact,
                      integrity: highestImpact,
                      availability: highestImpact === 'high' ? 'moderate' : highestImpact,
                    });
                  }}
                  className="w-4 h-4 text-cyan-500 bg-navy-800 border-navy-500 rounded focus:ring-cyan-500"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-200">{dt.label}</span>
                  <span className="text-xs text-gray-500 ml-2">{dt.description}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                  dt.impactLevel === 'high' ? 'bg-red-500/10 text-red-400' :
                  dt.impactLevel === 'moderate' ? 'bg-amber-500/10 text-amber-400' :
                  'bg-green-500/10 text-green-400'
                }`}>
                  {dt.impactLevel}
                </span>
              </label>
            );
          })}
        </div>

        {securityCategorization.dataTypes.length > 0 && (
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-navy-600">
            {(['confidentiality', 'integrity', 'availability'] as const).map((dim) => (
              <div key={dim}>
                <label className="text-xs text-gray-500 block mb-1 capitalize">{dim}</label>
                <select
                  value={securityCategorization[dim]}
                  onChange={(e) => onUpdateSecurityCategorization({ [dim]: e.target.value as FipsLevel })}
                  className="w-full bg-navy-900/60 border border-navy-600 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:border-cyan-500/50 focus:ring-cyan-500/30"
                >
                  {fipsLevels.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Security Exceptions */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setExceptionsExpanded(!exceptionsExpanded)}
          className="w-full flex items-center gap-3 p-4 hover:bg-navy-700 transition-colors text-left"
        >
          <ShieldAlert className="w-4 h-4 text-gray-500" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-400">
              Security Exceptions
              <span className="font-normal text-gray-600 ml-1">(optional)</span>
            </h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Request elevated permissions if your application requires them
            </p>
          </div>
          {enabledExceptions.length > 0 && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {enabledExceptions.length} requested
            </span>
          )}
          {exceptionsExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {exceptionsExpanded && (
          <div className="border-t border-navy-600 p-4 space-y-3">
            <p className="text-xs text-gray-500 mb-3">
              These will be reviewed by the ISSM before deployment.
            </p>
            {exceptionDefinitions.map((def) => {
              const exception = getException(def.type);
              const isEnabled = exception?.enabled ?? false;
              return (
                <div key={def.type} className="space-y-2">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      isEnabled
                        ? 'bg-amber-500/10 border border-amber-500/30'
                        : 'hover:bg-navy-700 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleException(def.type)}
                      className="w-4 h-4 mt-0.5 text-amber-500 bg-navy-800 border-navy-500 rounded focus:ring-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-200">
                        {def.label}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        {def.description}
                      </span>
                    </div>
                  </label>
                  {isEnabled && (
                    <div className="ml-7">
                      <input
                        type="text"
                        value={exception?.justification ?? ''}
                        onChange={(e) => updateJustification(def.type, e.target.value)}
                        placeholder="Justification (required, min 5 characters)"
                        className={`w-full bg-navy-900/60 border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 ${
                          exception?.justification && exception.justification.trim().length >= 5
                            ? 'border-navy-600 focus:border-cyan-500/50 focus:ring-cyan-500/30'
                            : 'border-amber-500/30 focus:border-amber-500/50 focus:ring-amber-500/30'
                        }`}
                      />
                      {exception?.justification !== undefined && exception.justification.trim().length > 0 && exception.justification.trim().length < 5 && (
                        <p className="text-xs text-amber-400 mt-1">
                          Justification must be at least 5 characters
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={onBack}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          loading={isAnalyzing}
          icon={!isAnalyzing ? <ArrowRight className="w-4 h-4" /> : undefined}
          size="lg"
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze & Continue'}
        </Button>
      </div>
    </div>
  );
}
