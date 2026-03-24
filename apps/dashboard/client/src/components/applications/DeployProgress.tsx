import React, { useEffect, useState, useRef } from 'react';

interface DeployItem {
  name: string;
  team: string;
  image: string;
  tag: string;
  replicas?: number;
}

interface DeployStep {
  name: string;
  image: string;
  tag: string;
  progress: number;
  status: string;
  isDone: boolean;
  isError: boolean;
  podStatuses: ('pending' | 'running' | 'error')[];
}

interface DeployProgressProps {
  items: DeployItem[];
  visible: boolean;
  onDismiss: () => void;
}

export function DeployProgress({ items, visible, onDismiss }: DeployProgressProps) {
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const pollTimers = useRef<number[]>([]);

  useEffect(() => {
    if (!visible || items.length === 0) return;

    // Initialize steps
    const initialSteps: DeployStep[] = items.map((item) => ({
      name: item.name,
      image: item.image,
      tag: item.tag,
      progress: 0,
      status: 'Pending',
      isDone: false,
      isError: false,
      podStatuses: Array(item.replicas || 1).fill('pending') as ('pending' | 'running' | 'error')[],
    }));
    setSteps(initialSteps);

    return () => {
      pollTimers.current.forEach((t) => clearInterval(t));
      pollTimers.current = [];
    };
  }, [visible, items]);

  // Expose a way for parent to update step progress
  useEffect(() => {
    if (!visible) return;

    // Poll health for each step
    items.forEach((item, idx) => {
      const ns = item.team.startsWith('team-') ? item.team : `team-${item.team}`;
      let attempts = 0;

      const timer = window.setInterval(async () => {
        attempts++;
        if (attempts > 60) {
          clearInterval(timer);
          setSteps((prev) =>
            prev.map((s, i) =>
              i === idx && !s.isDone
                ? { ...s, progress: 90, status: 'Timeout - check status manually' }
                : s
            )
          );
          return;
        }

        try {
          const resp = await fetch('/api/health');
          const data = await resp.json();
          const match = data.helmReleases?.find(
            (hr: { namespace: string; name: string; ready: boolean }) =>
              hr.namespace === ns && hr.name === item.name
          );

          if (match) {
            if (match.ready) {
              clearInterval(timer);
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === idx
                    ? {
                        ...s,
                        progress: 100,
                        status: 'Running!',
                        isDone: true,
                        podStatuses: s.podStatuses.map(() => 'running' as const),
                      }
                    : s
                )
              );
            } else {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === idx && !s.isDone
                    ? {
                        ...s,
                        progress: Math.min(60 + attempts, 95),
                        status: 'Waiting for pods...',
                        podStatuses: s.podStatuses.map((_, di) =>
                          di <= Math.floor(attempts / 5)
                            ? ('pending' as const)
                            : ('pending' as const)
                        ),
                      }
                    : s
                )
              );
            }
          } else {
            setSteps((prev) =>
              prev.map((s, i) =>
                i === idx && !s.isDone
                  ? { ...s, progress: Math.min(50 + attempts, 80), status: 'Reconciling...' }
                  : s
              )
            );
          }
        } catch {
          // keep polling
        }
      }, 2000);

      pollTimers.current.push(timer);
    });

    return () => {
      pollTimers.current.forEach((t) => clearInterval(t));
      pollTimers.current = [];
    };
  }, [visible, items]);

  if (!visible || items.length === 0) return null;

  const allDone = steps.every((s) => s.isDone || s.isError);
  const successCount = steps.filter((s) => s.isDone && !s.isError).length;
  const errorCount = steps.filter((s) => s.isError).length;

  return (
    <div className="bg-card border border-accent/30 rounded-[var(--radius)] p-5 mb-4">
      <h3 className="text-sm font-semibold text-text-bright flex items-center gap-2 mb-4">
        {allDone ? (
          errorCount > 0 ? '\u26A0' : '\u2705'
        ) : (
          <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}
        {allDone
          ? 'Deploy Complete'
          : `Deploying ${items.length} service${items.length > 1 ? 's' : ''}...`}
      </h3>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-text-bright">
                {step.name}{' '}
                <code className="text-[11px] text-text-dim bg-bg px-1 py-0.5 rounded">
                  {step.image}:{step.tag}
                </code>
              </span>
              <span
                className={`text-xs font-mono ${
                  step.isDone && !step.isError
                    ? 'text-green'
                    : step.isError
                    ? 'text-red'
                    : 'text-text-dim'
                }`}
              >
                {step.status}
              </span>
            </div>
            <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  step.isError
                    ? 'bg-red'
                    : step.isDone
                    ? 'bg-green'
                    : 'bg-accent animate-pipe-pulse'
                }`}
                style={{ width: `${step.progress}%` }}
              />
            </div>
            <div className="flex gap-1 mt-1.5">
              {step.podStatuses.map((ps, pi) => (
                <span
                  key={pi}
                  className={`w-2.5 h-2.5 rounded-full ${
                    ps === 'running'
                      ? 'bg-green'
                      : ps === 'error'
                      ? 'bg-red'
                      : 'bg-surface-hover'
                  }`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {allDone && (
        <div
          className="mt-4 pt-3 border-t border-border text-center text-sm text-text-dim cursor-pointer hover:text-accent"
          onClick={onDismiss}
        >
          {successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ''} - Click to dismiss
        </div>
      )}
    </div>
  );
}
