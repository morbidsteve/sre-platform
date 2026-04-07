import React, { useState, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Activity } from 'lucide-react';
import { fetchHealthChecks, type HealthCheck, type HealthChecksResponse } from '../../api/health';

const STATUS_ICON = {
  PASS: CheckCircle2,
  WARN: AlertTriangle,
  FAIL: XCircle,
};
const STATUS_COLOR = {
  PASS: 'text-green-400',
  WARN: 'text-yellow-400',
  FAIL: 'text-red-400',
};
const STATUS_BG = {
  PASS: 'bg-green-500/10 border-green-500/20',
  WARN: 'bg-yellow-500/10 border-yellow-500/20',
  FAIL: 'bg-red-500/10 border-red-500/20',
};

export function HealthCheckPanel() {
  const [data, setData] = useState<HealthChecksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runChecks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHealthChecks();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run health checks');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Platform Health Checks
        </h3>
        <button
          className="btn btn-primary text-sm inline-flex items-center gap-2"
          onClick={runChecks}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Running...' : data ? 'Re-run Checks' : 'Run Health Checks'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 bg-surface border border-border rounded-lg p-4">
            <span className="text-sm text-text-dim">
              {new Date(data.timestamp).toLocaleString()}
            </span>
            <span className="text-sm font-medium text-green-400">{data.summary.pass} Pass</span>
            {data.summary.warn > 0 && <span className="text-sm font-medium text-yellow-400">{data.summary.warn} Warn</span>}
            {data.summary.fail > 0 && <span className="text-sm font-medium text-red-400">{data.summary.fail} Fail</span>}
            <span className="text-sm text-text-dim ml-auto">{data.summary.total} checks</span>
          </div>

          {/* Check cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.checks.map((check) => {
              const Icon = STATUS_ICON[check.status];
              return (
                <div key={check.check} className={`border rounded-lg p-3 ${STATUS_BG[check.status]}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${STATUS_COLOR[check.status]}`} />
                    <span className="text-sm font-medium text-text-primary">{check.check}</span>
                  </div>
                  <p className="text-xs text-text-dim ml-6">{check.detail}</p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-12 text-text-dim text-sm">
          Click &quot;Run Health Checks&quot; to scan all 12 platform health indicators.
        </div>
      )}
    </div>
  );
}
