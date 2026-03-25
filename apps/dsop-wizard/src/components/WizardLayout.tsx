import React from 'react';
import { Shield, ArrowLeft } from 'lucide-react';
import { ClassificationBanner, ClassificationBannerBottom } from './ClassificationBanner';
import { StepIndicator } from './StepIndicator';
import { svcUrl } from '../config';
import type { Classification } from '../types';

interface WizardLayoutProps {
  currentStep: number;
  classification: Classification;
  onStepClick?: (step: number) => void;
  children: React.ReactNode;
}

const stepLabels = [
  'Source',
  'App Info',
  'Detection',
  'Security',
  'Review',
  'Deploy',
  'Complete',
];

export function WizardLayout({ currentStep, classification, onStepClick, children }: WizardLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-navy-900">
      <ClassificationBanner classification={classification} />

      {/* Header */}
      <header className="border-b border-navy-700 bg-navy-800/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a
              href={svcUrl('dashboard')}
              className="text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </a>
            <div className="w-px h-8 bg-navy-600" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center">
                <Shield className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-100">
                  DSOP Guided Deployment
                </h1>
                <p className="text-xs text-gray-400 font-mono">
                  RAISE-Compliant Software Delivery Pipeline
                </p>
              </div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4 text-xs text-gray-500">
            <span className="font-mono">SRE PLATFORM</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Platform Healthy" />
          </div>
        </div>
      </header>

      {/* Step Indicator */}
      <div className="border-b border-navy-700 bg-navy-800/40">
        <div className="max-w-6xl mx-auto">
          <StepIndicator
            currentStep={currentStep}
            totalSteps={7}
            labels={stepLabels}
            onStepClick={onStepClick}
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 pb-16">
        <div className="max-w-4xl mx-auto px-6 py-8 animate-fade-in">
          {children}
        </div>
      </main>

      <ClassificationBannerBottom classification={classification} />
    </div>
  );
}
