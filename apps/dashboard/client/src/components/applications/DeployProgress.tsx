import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { DeployStatus } from '../../types/api';

// Policy name → fix guidance
const POLICY_FIXES: Record<string, string> = {
  'require-run-as-nonroot': 'Add `USER 1000` to your Dockerfile, or set `securityContext.runAsNonRoot: true`.',
  'require-security-context': 'Set `allowPrivilegeEscalation: false` and `capabilities.drop: ["ALL"]`.',
  'restrict-image-registries': 'Push your image to `harbor.apps.sre.example.com` first.',
  'disallow-latest-tag': 'Pin your image to a specific version tag (e.g., `:v1.2.3`).',
  'require-resource-limits': 'Set `resources.requests` and `resources.limits` in your values.',
  'require-probes': 'Add `livenessProbe` and `readinessProbe` to your container spec.',
  'require-labels': 'Add required labels: `app.kubernetes.io/name`, `sre.io/team`.',
  'verify-image-signatures': 'Sign your image with Cosign before pushing to Harbor.',
  'disallow-privileged-containers': 'Remove `privileged: true` from your securityContext.',
  'disallow-privilege-escalation': 'Set `allowPrivilegeEscalation: false`.',
  'require-drop-all-capabilities': 'Add `capabilities.drop: [ALL]` to your securityContext.',
};

function getPolicyFix(message: string): string | null {
  const lower = message.toLowerCase();
  for (const [key, fix] of Object.entries(POLICY_FIXES)) {
    if (lower.includes(key.toLowerCase())) return fix;
  }
  return null;
}

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
  errorDetail?: string;
  policyFix?: string;
}

interface DeployProgressProps {
  items: DeployItem[];
  visible: boolean;
  onDismiss: () => void;
}

export function DeployProgress({ items, visible, onDismiss }: DeployProgressProps) {
  const [steps, setSteps] = useState<DeployStep[]>([]);
  const pollTimers = useRef<number[]>([]);

  const diagnoseFailure = useCallback(async (namespace: string, name: string, idx: number) => {
    try {
      const resp = await fetch(`/api/deploy/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/status`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const status: DeployStatus = await resp.json();

      let errorMsg = '';
      let policyFix: string | undefined;

      // Check for policy violations first
      if (status.policyViolations && status.policyViolations.length > 0) {
        const pv = status.policyViolations[0];
        errorMsg = `Blocked by policy: ${pv.message}`;
        const fix = getPolicyFix(pv.message);
        if (fix) policyFix = fix;
      } else if (status.helmRelease?.reason && ['InstallFailed', 'UpgradeFailed', 'ReconciliationFailed'].includes(status.helmRelease.reason)) {
        const detail = status.helmRelease.errorDetail || status.helmRelease.message || '';
        errorMsg = `Helm install failed: ${detail.substring(0, 200)}`;
      } else if (status.pods && status.pods.some((p) => p.phase === 'Failed' || p.containers?.some((c) => c.reason))) {
        const failedPod = status.pods.find((p) => p.phase === 'Failed' || p.containers?.some((c) => c.reason));
        if (failedPod) {
          const failingContainer = failedPod.containers?.find((c) => c.reason);
          const reason = failingContainer?.reason || failedPod.phase;
          const msg = failingContainer ? ` — check pod logs for details` : '';
          errorMsg = `Pod failed: ${reason}${msg}`;
        }
      } else if (status.events && status.events.some((e) => e.type === 'Warning')) {
        const warningEvent = status.events.find((e) => e.type === 'Warning');
        if (warningEvent) {
          errorMsg = `Warning: ${warningEvent.message.substring(0, 150)}`;
        }
      } else {
        errorMsg = 'Deploy is taking longer than expected. Check the Applications tab for live status.';
      }

      setSteps((prev) =>
        prev.map((s, i) =>
          i === idx && !s.isDone
            ? { ...s, progress: 90, status: errorMsg, isError: true, errorDetail: errorMsg, policyFix }
            : s
        )
      );
    } catch {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === idx && !s.isDone
            ? { ...s, progress: 90, status: 'Deploy is taking longer than expected. Check the Applications tab.', isError: true }
            : s
        )
      );
    }
  }, []);

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
          // Instead of "check status manually", diagnose the actual failure
          setSteps((prev) =>
            prev.map((s, i) =>
              i === idx && !s.isDone
                ? { ...s, progress: 85, status: 'Diagnosing...' }
                : s
            )
          );
          await diagnoseFailure(ns, item.name, idx);
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
  }, [visible, items, diagnoseFailure]);

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
                className={`text-xs font-mono max-w-[200px] truncate text-right ${
                  step.isDone && !step.isError
                    ? 'text-green'
                    : step.isError
                    ? 'text-red'
                    : 'text-text-dim'
                }`}
                title={step.status}
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
            {/* Error detail panel */}
            {step.isError && step.errorDetail && (
              <div className="mt-2 px-3 py-2 rounded bg-red/5 border border-red/20 text-xs text-red">
                <div className="font-mono leading-relaxed">{step.errorDetail}</div>
                {step.policyFix && (
                  <div className="mt-1.5 text-text-primary font-mono bg-bg rounded px-2 py-1 leading-relaxed">
                    Fix: {step.policyFix}
                  </div>
                )}
              </div>
            )}
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
