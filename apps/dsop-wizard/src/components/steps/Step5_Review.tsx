import React from 'react';
import {
  ArrowLeft,
  Rocket,
  Download,
  FileCheck,
  Shield,
  Globe,
  Server,
  Tag,
  Lock,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { AppInfo, DetectionResult, SecurityGate } from '../../types';

interface Step5Props {
  appInfo: AppInfo;
  detection: DetectionResult;
  gates: SecurityGate[];
  onBack: () => void;
  onDeploy: () => void;
}

const typeLabels: Record<string, string> = {
  'docker-compose': 'Docker Compose',
  dockerfile: 'Dockerfile',
  helm: 'Helm Chart',
  kustomize: 'Kustomize',
  container: 'Container Image',
};

export function Step5_Review({
  appInfo,
  detection,
  gates,
  onBack,
  onDeploy,
}: Step5Props) {
  const passed = gates.filter((g) => g.status === 'passed').length;
  const warnings = gates.filter((g) => g.status === 'warning').length;
  const total = gates.length;

  const cveGate = gates.find((g) => g.id === 4);
  const totalFindings = gates.reduce((acc, g) => acc + g.findings.length, 0);
  const criticalFindings = gates
    .flatMap((g) => g.findings)
    .filter((f) => f.severity === 'critical').length;
  const highFindings = gates
    .flatMap((g) => g.findings)
    .filter((f) => f.severity === 'high').length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">
          Deployment Review
        </h2>
        <p className="text-gray-400 mt-2">
          Review the configuration before deploying to the SRE Platform
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Server className="w-4 h-4" />
          Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">App:</span>
            <span className="text-gray-200 font-mono font-medium">
              {appInfo.name || 'my-app'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Type:</span>
            <span className="text-gray-200">
              {typeLabels[detection.repoType]} ({detection.services.length} svc
              {detection.services.length !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Namespace:</span>
            <span className="text-gray-200 font-mono">{appInfo.team}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-28">Classification:</span>
            <Badge
              variant={
                appInfo.classification === 'UNCLASSIFIED'
                  ? 'success'
                  : appInfo.classification === 'SECRET' ||
                    appInfo.classification === 'TOP SECRET' ||
                    appInfo.classification === 'TS//SCI'
                  ? 'danger'
                  : 'warning'
              }
            >
              {appInfo.classification}
            </Badge>
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <span className="text-gray-500 w-28">URL:</span>
            <span className="text-cyan-400 font-mono">
              {appInfo.name || 'my-app'}.apps.sre.example.com
            </span>
          </div>
        </div>
      </div>

      {/* Security Summary */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Security Assessment
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400 font-mono">
              {passed + warnings}/{total}
            </p>
            <p className="text-xs text-gray-500 mt-1">Gates Cleared</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-400 font-mono">
              MODERATE
            </p>
            <p className="text-xs text-gray-500 mt-1">Impact Level</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-cyan-400 font-mono">
              {criticalFindings}C / {highFindings}H
            </p>
            <p className="text-xs text-gray-500 mt-1">CVEs (Crit/High)</p>
          </div>
          <div className="bg-navy-900/50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-purple-400 font-mono">
              SPDX
            </p>
            <p className="text-xs text-gray-500 mt-1">SBOM Format</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button className="flex items-center justify-center gap-3 p-4 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group">
          <Download className="w-5 h-5 text-gray-400 group-hover:text-cyan-400" />
          <div className="text-left">
            <p className="text-sm font-medium text-gray-200">
              Download Package
            </p>
            <p className="text-xs text-gray-500">
              SBOM + Scan Reports + STIG Checklist
            </p>
          </div>
        </button>
        <button className="flex items-center justify-center gap-3 p-4 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group">
          <FileCheck className="w-5 h-5 text-gray-400 group-hover:text-cyan-400" />
          <div className="text-left">
            <p className="text-sm font-medium text-gray-200">
              Submit for ISSM Review
            </p>
            <p className="text-xs text-gray-500">
              Route to security officer
            </p>
          </div>
        </button>
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <Button
          variant="secondary"
          onClick={onBack}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={onDeploy}
          icon={<Rocket className="w-4 h-4" />}
          size="lg"
          className="px-8"
        >
          Deploy to Staging
        </Button>
      </div>
    </div>
  );
}
