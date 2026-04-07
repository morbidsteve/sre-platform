import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { fetchSecretStatus, rotateSecrets } from '../../api/secrets';
import type { SecretStatus, RotationResult } from '../../api/secrets';

const COMPONENT_LABELS: Record<string, string> = {
  harbor: 'Harbor Robot Secrets',
  keycloak: 'Keycloak Admin',
  cosign: 'Cosign Signing Keys',
};

const THRESHOLD_LABELS: Record<string, string> = {
  harbor: '90 days',
  keycloak: '90 days',
  cosign: '365 days',
};

export function SecretRotationPanel() {
  const [components, setComponents] = useState<SecretStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<RotationResult[]>([]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSecretStatus();
      setComponents(data.components);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRotate = async (component: string) => {
    setRotating(component);
    setResults([]);
    try {
      const data = await rotateSecrets(component, dryRun);
      setResults(data.results);
      if (!dryRun) {
        await loadStatus();
      }
    } catch (err) {
      setResults([{ component, status: 'failed', detail: err instanceof Error ? err.message : 'Unknown error' }]);
    } finally {
      setRotating(null);
    }
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return 'Unknown';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && components.length === 0) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[15px] font-semibold text-text-primary">Secret Rotation</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="rounded border-border"
            />
            Dry Run
          </label>
          <Button onClick={() => handleRotate('all')} disabled={!!rotating}>
            {rotating === 'all' ? 'Rotating...' : 'Rotate All'}
          </Button>
          <Button onClick={loadStatus}>Refresh</Button>
        </div>
      </div>

      {/* Secret Status Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 text-text-dim font-medium">Component</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Last Rotated</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Age</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Threshold</th>
              <th className="py-2 pr-4 text-text-dim font-medium">Status</th>
              <th className="py-2 text-text-dim font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.component} className="border-b border-border/50">
                <td className="py-3 pr-4 text-text-primary font-medium">
                  {COMPONENT_LABELS[c.component] || c.component}
                </td>
                <td className="py-3 pr-4 text-text-secondary">
                  {formatDate(c.lastRotated)}
                </td>
                <td className="py-3 pr-4 text-text-secondary">
                  {c.ageDays > 0 ? `${c.ageDays}d` : c.ageHours > 0 ? `${c.ageHours}h` : 'N/A'}
                </td>
                <td className="py-3 pr-4 text-text-dim">
                  {THRESHOLD_LABELS[c.component] || ''}
                </td>
                <td className="py-3 pr-4">
                  <Badge variant={c.healthy ? 'green' : 'red'}>
                    {c.healthy ? 'Healthy' : 'Stale'}
                  </Badge>
                </td>
                <td className="py-3">
                  <Button
                    size="sm"
                    variant={c.healthy ? 'outline' : 'warn'}
                    onClick={() => handleRotate(c.component)}
                    disabled={!!rotating}
                  >
                    {rotating === c.component ? 'Rotating...' : 'Rotate'}
                  </Button>
                </td>
              </tr>
            ))}
            {components.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-text-dim">
                  No secret components found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Rotation Results */}
      {results.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-text-primary mb-3">
            {dryRun ? 'Dry Run Results' : 'Rotation Results'}
          </h4>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className={`card-base p-3 flex items-center gap-3 ${
                  r.status === 'failed' ? 'border-red-500/30' : r.status === 'dry_run' ? 'border-yellow-500/30' : 'border-green-500/30'
                }`}
              >
                <Badge variant={r.status === 'failed' ? 'red' : r.status === 'dry_run' ? 'yellow' : 'green'}>
                  {r.status === 'dry_run' ? 'DRY RUN' : r.status.toUpperCase()}
                </Badge>
                <span className="text-text-primary font-medium">
                  {COMPONENT_LABELS[r.component] || r.component}
                </span>
                <span className="text-text-secondary text-sm">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
