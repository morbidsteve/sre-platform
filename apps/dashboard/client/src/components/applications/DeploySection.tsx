import React, { useState } from 'react';
import { QuickStartPanel } from './QuickStartPanel';
import { HelmDeployForm } from './HelmDeployForm';
import { DatabaseForm } from './DatabaseForm';
import { X, Rocket, Shield } from 'lucide-react';

interface DeployItem {
  name: string;
  team: string;
  image: string;
  tag: string;
  port: number;
  replicas: number;
  ingress: string;
}

interface DeploySectionProps {
  visible: boolean;
  onClose: () => void;
  onOpenDsopWizard: () => void;
  onQuickDeploy: (item: DeployItem) => Promise<void>;
  onHelmDeploy: (payload: {
    repoUrl: string;
    chartName: string;
    version: string;
    releaseName: string;
    team: string;
    values: string;
  }) => Promise<void>;
  onCreateDatabase: (payload: {
    name: string;
    team: string;
    storage: string;
    instances: number;
  }) => Promise<void>;
}

export function DeploySection({
  visible,
  onClose,
  onOpenDsopWizard,
  onQuickDeploy,
  onHelmDeploy,
  onCreateDatabase,
}: DeploySectionProps) {
  if (!visible) return null;

  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-bright">Deploy to SRE Platform</h2>
        <button className="btn text-[11px] !py-1 !px-3 !min-h-0" onClick={onClose}>
          <X className="w-3 h-3 inline-block mr-1" />
          Close
        </button>
      </div>
      <p className="text-text-dim text-sm mb-5">
        Launch the DSOP-compliant deployment wizard to securely build and deploy your application, or use Quick Deploy for pre-built images.
      </p>

      {/* DSOP Wizard Card */}
      <div className="bg-card border-2 border-accent rounded-xl p-6 mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-lg font-semibold text-text-bright mb-1 flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent" />
            DSOP Deployment Wizard
          </h3>
          <p className="text-text-dim text-[13px] max-w-[520px]">
            Full guided deployment with security pipeline compliance, image scanning, SBOM generation, and ISSM review gates.
          </p>
        </div>
        <button
          className="btn btn-primary text-[15px] !px-7 !py-3 whitespace-nowrap"
          onClick={onOpenDsopWizard}
        >
          <Rocket className="w-4 h-4 inline-block mr-1.5" />
          Open DSOP Wizard
        </button>
      </div>

      {/* Quick Start */}
      <div className="mb-6">
        <QuickStartPanel onDeploy={onQuickDeploy} />
      </div>

      {/* Helm Chart Deploy */}
      <div className="mb-6">
        <HelmDeployForm onDeploy={onHelmDeploy} />
      </div>

      {/* Database */}
      <div className="mb-6">
        <DatabaseForm onCreateDatabase={onCreateDatabase} />
      </div>
    </div>
  );
}
