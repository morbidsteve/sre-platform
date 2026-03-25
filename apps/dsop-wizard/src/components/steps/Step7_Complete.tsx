import React from 'react';
import { svcUrl } from '../../config';
import {
  CheckCircle2,
  ExternalLink,
  ScrollText,
  BarChart3,
  Download,
  RefreshCw,
  ArrowLeft,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from '../ui/Button';
import type { SecurityGate } from '../../types';

interface Step7Props {
  appName: string;
  deployedUrl: string;
  classification?: string;
  gates?: SecurityGate[];
  onReset: () => void;
  pipelineRunId?: string | null;
  onDownloadPackage?: () => Promise<Record<string, unknown> | null>;
}

function downloadCompliancePackage(
  appName: string,
  classification: string,
  gates: SecurityGate[]
) {
  const now = new Date().toISOString();
  const gateResults = gates.map((g) => ({
    id: g.id,
    name: g.name,
    shortName: g.shortName,
    status: g.status,
    implemented: g.implemented,
    summary: g.summary || null,
    findingsCount: g.findings.length,
    findings: g.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      description: f.description,
      location: f.location || null,
      disposition: f.disposition || null,
      mitigation: f.mitigation || null,
      mitigatedBy: f.mitigatedBy || null,
      mitigatedAt: f.mitigatedAt || null,
    })),
  }));

  const passed = gates.filter((g) => g.status === 'passed').length;
  const warned = gates.filter((g) => g.status === 'warning').length;
  const failed = gates.filter((g) => g.status === 'failed').length;
  const skipped = gates.filter((g) => g.status === 'skipped').length;

  const cveGate = gates.find((g) => g.shortName === 'CVE SCAN');
  const sbomGate = gates.find((g) => g.shortName === 'SBOM');

  const compliancePackage = {
    metadata: {
      appName,
      deployTime: now,
      classificationLevel: classification,
      generatedBy: 'DSOP Deployment Wizard',
      version: '1.1.0',
    },
    securityGates: {
      summary: {
        total: gates.length,
        passed,
        warning: warned,
        failed,
        skipped,
      },
      gates: gateResults,
    },
    sbomStatus: {
      generated: sbomGate?.status === 'passed',
      format: sbomGate?.status === 'passed' ? 'SPDX + CycloneDX' : 'N/A',
      summary: sbomGate?.summary || 'Not generated',
    },
    vulnerabilitySummary: {
      scanCompleted: cveGate?.status === 'passed' || cveGate?.status === 'warning',
      summary: cveGate?.summary || 'Not scanned',
      findings: cveGate?.findings || [],
    },
    mitigationSummary: {
      totalFindings: gates.reduce((acc, g) => acc + g.findings.length, 0),
      reviewedFindings: gates.reduce(
        (acc, g) => acc + g.findings.filter((f) => f.disposition).length,
        0
      ),
      findings: gates.flatMap((g) =>
        g.findings
          .filter((f) => f.disposition)
          .map((f) => ({
            gate: g.name,
            severity: f.severity,
            title: f.title,
            disposition: f.disposition,
            mitigation: f.mitigation || null,
            mitigatedBy: f.mitigatedBy || null,
            mitigatedAt: f.mitigatedAt || null,
          }))
      ),
    },
  };

  const blob = new Blob([JSON.stringify(compliancePackage, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${appName}-compliance-package-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function Step7_Complete({
  appName,
  deployedUrl,
  classification = 'UNCLASSIFIED',
  gates = [],
  onReset,
  pipelineRunId,
  onDownloadPackage,
}: Step7Props) {
  const handleDownload = () => {
    // If we have a pipeline API download function, try it first
    if (pipelineRunId && onDownloadPackage) {
      onDownloadPackage().then((result) => {
        // If API download failed (returned null), fall back to local
        if (!result) {
          downloadCompliancePackage(appName, classification, gates);
        }
      });
    } else {
      // Fallback to local compliance package generation
      downloadCompliancePackage(appName, classification, gates);
    }
  };
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
        <button
          onClick={() => window.open(deployedUrl, '_blank')}
          className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group cursor-pointer"
        >
          <ExternalLink className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">Open App</span>
        </button>
        <button
          onClick={() =>
            window.open(
              `${svcUrl('dashboard')}/#services`,
              '_blank'
            )
          }
          className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group cursor-pointer"
        >
          <ScrollText className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">View Logs</span>
        </button>
        <button
          onClick={() =>
            window.open(svcUrl('grafana'), '_blank')
          }
          className="flex flex-col items-center gap-3 p-6 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group cursor-pointer"
        >
          <BarChart3 className="w-8 h-8 text-gray-400 group-hover:text-cyan-400 transition-colors" />
          <span className="text-sm font-medium text-gray-200">Metrics</span>
        </button>
      </div>

      {/* Pipeline Run ID */}
      {pipelineRunId && (
        <div className="max-w-2xl mx-auto bg-navy-800 border border-navy-600 rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Pipeline Run ID:</span>
            <span className="text-gray-300 font-mono text-xs select-all">
              {pipelineRunId}
            </span>
          </div>
        </div>
      )}

      {/* Compliance Package */}
      <div className="max-w-2xl mx-auto">
        <button
          onClick={handleDownload}
          className="w-full flex items-center justify-center gap-3 p-5 bg-navy-800 border border-navy-600 rounded-xl hover:border-cyan-500/30 hover:bg-navy-700 transition-all group cursor-pointer"
        >
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
          onClick={() => window.location.href = svcUrl('dashboard')}
          icon={<LayoutDashboard className="w-4 h-4" />}
          size="lg"
        >
          Back to Dashboard
        </Button>
        <Button
          variant="secondary"
          onClick={() => window.open(`${svcUrl('dashboard')}/#services`, '_blank')}
          icon={<ArrowLeft className="w-4 h-4" />}
          size="lg"
        >
          Back to Portal
        </Button>
      </div>
    </div>
  );
}
