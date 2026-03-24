import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { SecurityContextOptions } from '../../types/api';

const CAPABILITY_OPTIONS = ['NET_ADMIN', 'NET_RAW', 'SYS_NICE', 'SYS_PTRACE'] as const;

interface SecurityContextSectionProps {
  value: SecurityContextOptions;
  onChange: (ctx: SecurityContextOptions) => void;
}

export function SecurityContextSection({ value, onChange }: SecurityContextSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleCapability = (cap: string) => {
    const current = value.capabilities || [];
    const next = current.includes(cap)
      ? current.filter((c) => c !== cap)
      : [...current, cap];
    onChange({ ...value, capabilities: next });
  };

  const hasOverrides =
    value.runAsRoot ||
    value.writableFilesystem ||
    value.allowPrivilegeEscalation ||
    (value.capabilities && value.capabilities.length > 0);

  return (
    <div className="border border-border rounded-[var(--radius)] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface-hover transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-text-dim" />
          <span className="text-sm font-medium text-text-primary">Security Context</span>
          {hasOverrides && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow/15 text-yellow">
              modified
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-dim" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-dim" />
        )}
      </button>

      {expanded && (
        <div className="px-4 py-4 border-t border-border space-y-4">
          <p className="text-[11px] text-text-dim">
            These options override the default restricted security context. Use with caution
            — relaxing these settings may cause Kyverno policy violations on hardened clusters.
          </p>

          {/* Run as Root */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-sm text-text-primary">Run as Root</div>
              <div className="text-[11px] text-text-dim">
                Sets runAsNonRoot: false, runAsUser: 0
              </div>
            </div>
            <input
              type="checkbox"
              checked={!!value.runAsRoot}
              onChange={(e) => onChange({ ...value, runAsRoot: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
          </label>

          {/* Writable Filesystem */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-sm text-text-primary">Writable Filesystem</div>
              <div className="text-[11px] text-text-dim">
                Sets readOnlyRootFilesystem: false
              </div>
            </div>
            <input
              type="checkbox"
              checked={!!value.writableFilesystem}
              onChange={(e) => onChange({ ...value, writableFilesystem: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
          </label>

          {/* Allow Privilege Escalation */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-sm text-text-primary">Allow Privilege Escalation</div>
              <div className="text-[11px] text-text-dim">
                Sets allowPrivilegeEscalation: true
              </div>
            </div>
            <input
              type="checkbox"
              checked={!!value.allowPrivilegeEscalation}
              onChange={(e) =>
                onChange({ ...value, allowPrivilegeEscalation: e.target.checked })
              }
              className="w-4 h-4 accent-accent"
            />
          </label>

          {/* Network Capabilities */}
          <div>
            <div className="text-sm text-text-primary mb-2">Network Capabilities</div>
            <div className="text-[11px] text-text-dim mb-2">
              Add Linux capabilities to the container
            </div>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((cap) => {
                const active = (value.capabilities || []).includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    className={`px-2.5 py-1 text-xs font-mono border rounded-[var(--radius)] transition-colors ${
                      active
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-surface text-text-dim hover:bg-surface-hover hover:border-border-hover'
                    }`}
                    onClick={() => toggleCapability(cap)}
                  >
                    {cap}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
