import React from 'react';
import {
  CheckCircle2,
  ExternalLink,
  ScrollText,
  BarChart3,
  Download,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '../ui/Button';

interface Step7Props {
  appName: string;
  deployedUrl: string;
  onReset: () => void;
}

export function Step7_Complete({ appName, deployedUrl, onReset }: Step7Props) {
  return (
    <div className="space-y-8">
      {/* Success Header */}
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
        </div>
        <h2 className="text-3xl font-bold text-gray-100 glow-text">
          Deployment Successful
        </h2>
        <p className="text-gray-400">
          Your application is live and accessible at:
        </p>
        <a
          href={deployedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-mono text-lg transition-colors"
        >
          {deployedUrl}
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
        <a
          href={deployedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group cursor-pointer"
        >
          <ExternalLink className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">Open App</span>
        </a>
        <button className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group">
          <ScrollText className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">View Logs</span>
        </button>
        <button className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group">
          <BarChart3 className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">Metrics</span>
        </button>
      </div>

      {/* Compliance Package */}
      <div className="max-w-2xl mx-auto">
        <button className="w-full flex items-center justify-center gap-3 p-5 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group">
          <Download className="w-6 h-6 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-200 group-hover:text-gray-100">
              Download Compliance Package
            </p>
            <p className="text-xs text-gray-500">
              SBOM + Scan Reports + STIG Checklist + ATO Evidence
            </p>
          </div>
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="flex justify-center gap-4 pt-4">
        <Button
          variant="primary"
          onClick={onReset}
          icon={<RefreshCw className="w-4 h-4" />}
          size="lg"
        >
          Deploy Another App
        </Button>
        <Button
          variant="secondary"
          onClick={() => window.open('https://dashboard.apps.sre.example.com', '_blank')}
          icon={<ArrowLeft className="w-4 h-4" />}
          size="lg"
        >
          Back to Portal
        </Button>
      </div>
    </div>
  );
}
