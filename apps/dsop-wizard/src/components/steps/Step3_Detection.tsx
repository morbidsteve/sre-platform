import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Server,
  Database,
  Zap,
  Globe,
  CheckCircle2,
  Shield,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { DetectionResult, AppSource } from '../../types';

interface Step3Props {
  detection: DetectionResult;
  source: AppSource;
  appName: string;
  onBack: () => void;
  onRunPipeline: () => void;
}

const typeLabels: Record<string, string> = {
  'docker-compose': 'Docker Compose',
  dockerfile: 'Dockerfile',
  helm: 'Helm Chart',
  kustomize: 'Kustomize',
  container: 'Container Image',
};

const typeIcons: Record<string, React.ReactNode> = {
  application: <Server className="w-4 h-4 text-cyan-400" />,
  database: <Database className="w-4 h-4 text-amber-400" />,
  cache: <Zap className="w-4 h-4 text-purple-400" />,
  queue: <Zap className="w-4 h-4 text-green-400" />,
  proxy: <Globe className="w-4 h-4 text-blue-400" />,
};

export function Step3_Detection({
  detection,
  source,
  appName,
  onBack,
  onRunPipeline,
}: Step3Props) {
  const sourceDisplay =
    source.type === 'git'
      ? source.gitUrl?.replace('https://', '').replace('.git', '')
      : source.type === 'container'
      ? source.imageUrl
      : `${source.chartRepo}/${source.chartName}`;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">
          Analysis Complete
        </h2>
        <p className="text-gray-400 mt-2">
          Repository analyzed successfully. Review the detected configuration.
        </p>
      </div>

      {/* Source Info */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center">
            <Globe className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <p className="text-sm font-mono text-gray-300">{sourceDisplay}</p>
            <p className="text-xs text-gray-500">
              Type: <strong>{typeLabels[detection.repoType]}</strong>
              {detection.services.length > 0 &&
                ` (${detection.services.length} service${detection.services.length > 1 ? 's' : ''})`}
            </p>
          </div>
        </div>

        {/* Detected Services */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Detected Services
          </h3>
          <div className="bg-navy-900 rounded-lg border border-navy-600 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600">
                  <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">
                    SERVICE
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">
                    IMAGE
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">
                    PORT
                  </th>
                </tr>
              </thead>
              <tbody>
                {detection.services.map((svc) => (
                  <tr
                    key={svc.name}
                    className="border-b border-navy-700 last:border-b-0"
                  >
                    <td className="px-4 py-3 font-mono text-gray-200 flex items-center gap-2">
                      {typeIcons[svc.type] || typeIcons.application}
                      {svc.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400">
                      {svc.image}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400">
                      {svc.port ? `port ${svc.port}` : 'no port'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Platform Services */}
      {detection.platformServices.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Platform Services Detected
          </h3>
          <div className="space-y-2">
            {detection.platformServices.map((ps) => (
              <div
                key={ps.detected}
                className="flex items-center gap-3 p-3 bg-navy-900/50 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="text-sm text-gray-300">
                  {ps.detected}
                </span>
                <span className="text-gray-600 mx-1">&rarr;</span>
                <Badge variant="info">{ps.mappedTo}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* External Access */}
      {detection.externalAccess.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            External Access
          </h3>
          <div className="space-y-2">
            {detection.externalAccess.map((ea) => (
              <div
                key={ea.service}
                className="flex items-center gap-3 p-3 bg-navy-900/50 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="text-sm text-gray-300">{ea.service}</span>
                <span className="text-gray-600 mx-1">&rarr;</span>
                <span className="text-sm text-cyan-400 font-mono">
                  {appName
                    ? `${appName}.apps.sre.example.com`
                    : ea.hostname}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
          onClick={onRunPipeline}
          icon={<Shield className="w-4 h-4" />}
          size="lg"
        >
          Run Security Pipeline
        </Button>
      </div>
    </div>
  );
}
