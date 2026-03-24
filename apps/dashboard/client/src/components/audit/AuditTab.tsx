import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';
import { AuditFilters } from './AuditFilters';
import { AuditTable } from './AuditTable';
import { fetchAuditEvents } from '../../api/audit';
import type { AuditEvent } from '../../types/api';

const PAGE_SIZE = 25;

interface AuditTabProps {
  active: boolean;
}

export function AuditTab({ active }: AuditTabProps) {
  const [allEvents, setAllEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [nsFilter, setNsFilter] = useState('');
  const [page, setPage] = useState(0);
  const [lastChecked, setLastChecked] = useState('');

  const loadAudit = useCallback(async () => {
    if (!active) return;
    try {
      const data = await fetchAuditEvents();
      setAllEvents(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
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

  const handleTypeChange = (type: string) => {
    setTypeFilter(type);
    setPage(0);
  };

  const handleNsChange = (ns: string) => {
    setNsFilter(ns);
    setPage(0);
  };

  if (loading && allEvents.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-text-primary mb-4">Cluster Audit Log</h2>

      <div className="card-base overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Recent Kubernetes Events</h2>
          <div className="flex items-center gap-3">
            <AuditFilters
              typeFilter={typeFilter}
              nsFilter={nsFilter}
              namespaces={namespaces}
              onTypeChange={handleTypeChange}
              onNsChange={handleNsChange}
            />
            {lastChecked && (
              <span className="text-[11px] text-text-dim">Last checked: {lastChecked}</span>
            )}
          </div>
        </div>

        {/* Table */}
        <AuditTable events={pageEvents} />

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs">
          <span className="text-text-dim">
            {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </Button>
            <span className="text-text-dim px-2">{page + 1} / {totalPages}</span>
            <Button
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
