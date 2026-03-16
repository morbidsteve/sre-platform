import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import type { AppInfo, AccessLevel, Classification } from '../../types';
import type { User } from '../../types';

interface Step2Props {
  appInfo: AppInfo;
  user: User | null;
  onUpdate: (info: Partial<AppInfo>) => void;
  onBack: () => void;
  onNext: () => void;
  isAnalyzing: boolean;
}

const classificationOptions: { value: Classification; label: string }[] = [
  { value: 'UNCLASSIFIED', label: 'UNCLASSIFIED' },
  { value: 'CUI', label: 'CUI' },
  { value: 'CONFIDENTIAL', label: 'CONFIDENTIAL' },
  { value: 'SECRET', label: 'SECRET' },
  { value: 'TOP SECRET', label: 'TOP SECRET' },
  { value: 'TS//SCI', label: 'TS//SCI' },
];

const teamOptions = [
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
}: Step2Props) {
  // Auto-fill contact from SSO
  useEffect(() => {
    if (user?.email && !appInfo.contact) {
      onUpdate({ contact: user.email });
    }
  }, [user, appInfo.contact, onUpdate]);

  const isValid = appInfo.name.trim().length > 0;

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
          <Select
            label="Team / Namespace"
            options={teamOptions}
            value={appInfo.team}
            onChange={(e) => onUpdate({ team: e.target.value })}
          />
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
