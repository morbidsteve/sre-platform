import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp, AlertTriangle, AlertCircle } from 'lucide-react';
import { useData } from '../../context/DataContext';
import type { Alert } from '../../types/api';

export function AlertBanner() {
  const { alerts: alertsData } = useData();
  const { alerts } = alertsData;
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed || !alerts || alerts.length === 0) return null;

  const criticalCount = alerts.filter(
    (a: Alert) => a.severity === 'critical' || a.severity === 'error'
  ).length;
  const warningCount = alerts.filter((a: Alert) => a.severity === 'warning').length;

  const isCritical = criticalCount > 0;
  const bannerColor = isCritical
    ? 'rgba(239,68,68,0.1)'
    : 'rgba(234,179,8,0.1)';
  const bannerBorder = isCritical
    ? 'rgba(239,68,68,0.3)'
    : 'rgba(234,179,8,0.3)';
  const textColor = isCritical ? 'var(--red)' : 'var(--yellow)';

  const Icon = isCritical ? AlertCircle : AlertTriangle;

  return (
    <div>
      {/* Banner bar */}
      <div
        className="flex items-center justify-between px-6 py-2.5 text-[13px] font-medium cursor-pointer border-b"
        style={{
          background: bannerColor,
          borderColor: bannerBorder,
          color: textColor,
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Icon size={16} />
          {criticalCount > 0 && `${criticalCount} critical`}
          {criticalCount > 0 && warningCount > 0 && ', '}
          {warningCount > 0 && `${warningCount} warning`}
          {' '}alert{alerts.length !== 1 ? 's' : ''} active
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
        <button
          className="bg-transparent border-none cursor-pointer text-lg opacity-70 hover:opacity-100 px-1"
          style={{ color: 'inherit' }}
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          title="Dismiss"
        >
          <X size={16} />
        </button>
      </div>

      {/* Detail table */}
      {expanded && (
        <div className="px-6 py-2 pb-3 text-xs">
          <table className="w-full border-collapse">
            <tbody>
              {alerts.map((alert: Alert, idx: number) => (
                <tr key={idx}>
                  <td className="py-1 pr-3 align-top" style={{ color: alert.severity === 'critical' ? 'var(--red)' : 'var(--yellow)' }}>
                    {alert.severity}
                  </td>
                  <td className="py-1 pr-3 align-top font-medium text-text-primary">
                    {alert.name || alert.alertname || 'Alert'}
                  </td>
                  <td className="py-1 align-top text-text-dim">
                    {alert.message || alert.summary || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
