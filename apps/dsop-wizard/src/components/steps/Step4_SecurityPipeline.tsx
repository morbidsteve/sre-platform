import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { PipelineProgress } from '../pipeline/PipelineProgress';
import { GateCard } from '../pipeline/GateCard';
import type { SecurityGate } from '../../types';

interface Step4Props {
  gates: SecurityGate[];
  isPipelineRunning: boolean;
  onUpdateGate: (gateId: number, updates: Partial<SecurityGate>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function Step4_SecurityPipeline({
  gates,
  isPipelineRunning,
  onUpdateGate,
  onBack,
  onNext,
}: Step4Props) {
  const allDone = gates.every(
    (g) => g.status !== 'pending' && g.status !== 'running'
  );
  const hasCriticalFailure = gates.some((g) => g.status === 'failed');

  // Check if unimplemented skipped gates have been acknowledged
  const skippedGates = gates.filter(
    (g) => !g.implemented && g.status === 'skipped'
  );
  const allAcknowledged =
    skippedGates.length === 0 ||
    skippedGates.every((g) => g.manualAck);

  const canProceed = allDone && !hasCriticalFailure;

  const handleAcknowledge = (gateId: number) => {
    const gate = gates.find((g) => g.id === gateId);
    if (gate) {
      onUpdateGate(gateId, { manualAck: !gate.manualAck });
    }
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Progress Header */}
      <PipelineProgress gates={gates} />

      {/* Gate Cards */}
      <div className="space-y-3">
        {gates.map((gate) => (
          <GateCard
            key={gate.id}
            gate={gate}
            onAcknowledge={handleAcknowledge}
          />
        ))}
      </div>

      {/* Status Message */}
      {allDone && !hasCriticalFailure && !allAcknowledged && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-amber-400">
            Please acknowledge all manual verification gates before proceeding.
          </p>
        </div>
      )}

      {hasCriticalFailure && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">
            One or more security gates failed. Please resolve the issues before
            deploying.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={isPipelineRunning}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed || isPipelineRunning || !allAcknowledged}
          icon={<ArrowRight className="w-4 h-4" />}
          size="lg"
        >
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
