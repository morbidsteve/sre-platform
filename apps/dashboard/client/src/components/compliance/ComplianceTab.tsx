import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
  CheckCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { SkeletonCard } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { AuditFilters } from '../audit/AuditFilters';
import { AuditTable } from '../audit/AuditTable';
import { fetchAuditEvents } from '../../api/audit';
import type { AuditEvent } from '../../types/api';

const PAGE_SIZE = 25;

// Static compliance mapping from NIST 800-53 architecture docs
const CONTROL_FAMILIES = [
  {
    id: 'AC',
    name: 'Access Control',
    description: 'Access management, RBAC, and network segmentation',
    components: ['Keycloak', 'RBAC', 'Istio AuthorizationPolicy', 'NetworkPolicy', 'Kyverno'],
    controlCount: 9,
    implementedCount: 9,
    status: 'implemented' as const,
  },
  {
    id: 'AU',
    name: 'Audit & Accountability',
    description: 'Logging, audit trails, and monitoring',
    components: ['Loki', 'Alloy', 'Prometheus', 'Grafana', 'K8s Audit Logs'],
    controlCount: 8,
    implementedCount: 8,
    status: 'implemented' as const,
  },
  {
    id: 'CA',
    name: 'Assessment & Authorization',
    description: 'Continuous monitoring and vulnerability scanning',
    components: ['Kyverno PolicyReports', 'NeuVector CIS Benchmark', 'Trivy Scanning'],
    controlCount: 2,
    implementedCount: 2,
    status: 'implemented' as const,
  },
  {
    id: 'CM',
    name: 'Configuration Management',
    description: 'GitOps baseline, drift detection, policy enforcement',
    components: ['Flux CD', 'Git PR Workflow', 'Kyverno', 'Ansible STIGs'],
    controlCount: 7,
    implementedCount: 7,
    status: 'implemented' as const,
  },
  {
    id: 'IA',
    name: 'Identification & Authentication',
    description: 'SSO, mTLS, certificate management',
    components: ['Keycloak SSO/MFA', 'Istio mTLS', 'cert-manager', 'OpenBao'],
    controlCount: 4,
    implementedCount: 4,
    status: 'implemented' as const,
  },
  {
    id: 'IR',
    name: 'Incident Response',
    description: 'Alerting, monitoring, and incident handling',
    components: ['NeuVector Alerts', 'Prometheus/Grafana', 'AlertManager'],
    controlCount: 3,
    implementedCount: 3,
    status: 'implemented' as const,
  },
  {
    id: 'MP',
    name: 'Media Protection',
    description: 'Secrets encryption and data protection',
    components: ['OpenBao', 'K8s Secrets Encryption'],
    controlCount: 1,
    implementedCount: 1,
    status: 'implemented' as const,
  },
  {
    id: 'RA',
    name: 'Risk Assessment',
    description: 'Vulnerability scanning and CIS benchmarks',
    components: ['Harbor + Trivy', 'NeuVector Runtime', 'CIS Benchmark'],
    controlCount: 1,
    implementedCount: 1,
    status: 'implemented' as const,
  },
  {
    id: 'SA',
    name: 'System & Services Acquisition',
    description: 'Developer configuration management and testing',
    components: ['GitOps Workflow', 'Flux Audit Trail', 'Kyverno Tests', 'Helm Tests'],
    controlCount: 2,
    implementedCount: 2,
    status: 'implemented' as const,
  },
  {
    id: 'SC',
    name: 'System & Communications Protection',
    description: 'mTLS, encryption, FIPS, network segmentation',
    components: ['Istio mTLS STRICT', 'cert-manager', 'RKE2 FIPS', 'NetworkPolicies', 'NeuVector'],
    controlCount: 6,
    implementedCount: 6,
    status: 'implemented' as const,
  },
  {
    id: 'SI',
    name: 'System & Information Integrity',
    description: 'Image signing, runtime protection, vulnerability remediation',
    components: ['Cosign + Kyverno', 'NeuVector Runtime', 'Harbor/Trivy', 'Flux Drift Detection'],
    controlCount: 7,
    implementedCount: 7,
    status: 'implemented' as const,
  },
];

const EVIDENCE_SOURCES = [
  {
    name: 'Grafana Dashboards',
    description: 'Metrics, logs, and trace evidence for AU, IR, and SI controls',
    url: 'https://grafana.apps.sre.example.com',
    controls: ['AU-2', 'AU-3', 'AU-6', 'IR-4', 'SI-4'],
  },
  {
    name: 'Kyverno Policy Reports',
    description: 'Policy compliance status for CM, AC, and SI controls',
    url: '',
    controls: ['CM-6', 'CM-7', 'AC-6', 'SI-7'],
  },
  {
    name: 'NeuVector Console',
    description: 'Runtime security events and CIS benchmark results',
    url: 'https://neuvector.apps.sre.example.com',
    controls: ['SI-3', 'SI-4', 'SC-7', 'RA-5'],
  },
  {
    name: 'Harbor Scan Results',
    description: 'Container image vulnerability scan results and SBOM artifacts',
    url: 'https://harbor.apps.sre.example.com',
    controls: ['RA-5', 'SA-11', 'SI-2', 'SI-7'],
  },
];

interface ComplianceTabProps {
  active: boolean;
}

export function ComplianceTab({ active }: ComplianceTabProps) {
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

  // Audit trail state (reused from AuditTab)
  const [allEvents, setAllEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [nsFilter, setNsFilter] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    if (!active) return;
    try {
      setError(null);
      const data = await fetchAuditEvents();
      setAllEvents(data);
    } catch {
      setError('Failed to load audit data');
    } finally {
      setAuditLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    loadAudit();
    const id = setInterval(loadAudit, 30000);
    return () => clearInterval(id);
  }, [active, loadAudit]);

  const namespaces = useMemo(() => {
    const nsSet = new Set<string>();
    allEvents.forEach((e) => { if (e.namespace) nsSet.add(e.namespace); });
    return Array.from(nsSet).sort();
  }, [allEvents]);

  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (nsFilter && e.namespace !== nsFilter) return false;
      return true;
    });
  }, [allEvents, typeFilter, nsFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageEvents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Summary metrics
  const totalControls = CONTROL_FAMILIES.reduce((sum, f) => sum + f.controlCount, 0);
  const implementedControls = CONTROL_FAMILIES.reduce((sum, f) => sum + f.implementedCount, 0);
  const coveredFamilies = CONTROL_FAMILIES.filter((f) => f.implementedCount > 0).length;
  const progressPct = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;

  const toggleFamily = (id: string) => {
    setExpandedFamily(expandedFamily === id ? null : id);
  };

  return (
    <div>
      {/* Error Banner */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded border text-sm"
             style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--red)' }}>
          {error} — <button className="underline" onClick={loadAudit}>Retry</button>
        </div>
      )}

      {/* Section 1: Compliance Summary Cards */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Compliance Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-[var(--radius)] p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Controls Implemented
            </h3>
            <div className="text-2xl font-bold font-mono text-green">
              {implementedControls}/{totalControls}
            </div>
            <div className="mt-2 w-full h-2 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-green rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[11px] text-text-dim mt-1">{progressPct}% complete</div>
          </div>

          <div className="bg-card border border-border rounded-[var(--radius)] p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              NIST Families Covered
            </h3>
            <div className="text-2xl font-bold font-mono text-green">
              {coveredFamilies}/11
            </div>
            <div className="text-[11px] text-text-dim mt-1">of 11 applicable families</div>
          </div>

          <div className="bg-card border border-border rounded-[var(--radius)] p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Framework
            </h3>
            <div className="text-lg font-bold font-mono text-accent">NIST 800-53 r5</div>
            <div className="text-[11px] text-text-dim mt-1">+ CMMC 2.0 Level 2</div>
          </div>

          <div className="bg-card border border-border rounded-[var(--radius)] p-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-dim mb-2">
              Platform Status
            </h3>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green" />
              <span className="text-lg font-bold text-green">Operational</span>
            </div>
            <div className="text-[11px] text-text-dim mt-1">All controls active</div>
          </div>
        </div>
      </div>

      {/* Section 2: Control Family Status */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Control Family Status
        </h2>
        <div className="space-y-2">
          {CONTROL_FAMILIES.map((family) => {
            const isExpanded = expandedFamily === family.id;
            const allImplemented = family.implementedCount === family.controlCount;
            return (
              <div
                key={family.id}
                className="bg-card border border-border rounded-[var(--radius)] overflow-hidden"
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface/50 transition-colors"
                  onClick={() => toggleFamily(family.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${allImplemented ? 'bg-green' : 'bg-yellow'}`} />
                    <div>
                      <span className="text-sm font-semibold text-text-bright">
                        {family.id} - {family.name}
                      </span>
                      <span className="text-xs text-text-dim ml-2">{family.description}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                      allImplemented ? 'bg-green/15 text-green' : 'bg-yellow/15 text-yellow'
                    }`}>
                      {family.implementedCount}/{family.controlCount} controls
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-dim" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-dim" />
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-border p-4 bg-surface/30">
                    <div className="text-xs text-text-dim mb-2">Implementing Components:</div>
                    <div className="flex flex-wrap gap-2">
                      {family.components.map((comp) => (
                        <span
                          key={comp}
                          className="text-[11px] font-mono px-2 py-1 rounded bg-surface border border-border text-text-primary"
                        >
                          {comp}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Audit Trail */}
      <div className="mb-6">
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Audit Trail
        </h2>
        {auditLoading && allEvents.length === 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="card-base overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Kubernetes Events</h3>
              <AuditFilters
                typeFilter={typeFilter}
                nsFilter={nsFilter}
                namespaces={namespaces}
                onTypeChange={(t) => { setTypeFilter(t); setPage(0); }}
                onNsChange={(n) => { setNsFilter(n); setPage(0); }}
              />
            </div>
            <AuditTable events={pageEvents} />
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs">
              <span className="text-text-dim">
                {filtered.length} event{filtered.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                  Prev
                </Button>
                <span className="text-text-dim px-2">{page + 1} / {totalPages}</span>
                <Button size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Evidence Collection */}
      <div>
        <h2 className="text-[13px] font-mono uppercase tracking-[1px] text-text-dim mb-3">
          Evidence Sources
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EVIDENCE_SOURCES.map((source) => (
            <div
              key={source.name}
              className="bg-card border border-border rounded-[var(--radius)] p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-bright">{source.name}</h3>
                {source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-dim hover:text-accent transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              <p className="text-xs text-text-dim mb-2">{source.description}</p>
              <div className="flex flex-wrap gap-1">
                {source.controls.map((ctrl) => (
                  <span
                    key={ctrl}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent"
                  >
                    {ctrl}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
