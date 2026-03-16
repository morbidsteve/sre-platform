import React from 'react';
import { Check } from 'lucide-react';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels: string[];
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div className="w-full px-4 py-6">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1;
          const isCompleted = step < currentStep;
          const isActive = step === currentStep;
          const isUpcoming = step > currentStep;

          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center gap-2 min-w-0">
                <div
                  className={`step-dot ${
                    isCompleted ? 'completed' : isActive ? 'active' : 'upcoming'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span>{step}</span>
                  )}
                </div>
                <span
                  className={`text-xs text-center whitespace-nowrap ${
                    isActive
                      ? 'text-cyan-400 font-medium'
                      : isCompleted
                      ? 'text-emerald-400'
                      : 'text-gray-500'
                  }`}
                >
                  {labels[i]}
                </span>
              </div>
              {step < totalSteps && (
                <div className="flex-1 mx-2 mt-[-1.5rem]">
                  <div className="h-0.5 rounded-full bg-navy-600">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: isCompleted ? '100%' : isActive ? '50%' : '0%',
                        background: isCompleted
                          ? '#10b981'
                          : isActive
                          ? 'linear-gradient(90deg, #06b6d4, transparent)'
                          : 'transparent',
                      }}
                    />
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
