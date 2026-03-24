import { useState, useMemo, useCallback } from 'react';
import { useInterval } from './useInterval';
import { fetchAuditEvents } from '../api/audit';
import type { AuditEvent } from '../types/api';

const PAGE_SIZE = 25;

export function useAudit(active = true) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [nsFilter, setNsFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAuditEvents();
      setEvents(data);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useInterval(refresh, 30000, active);

  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (typeFilter) {
      filtered = filtered.filter((e) => e.type === typeFilter);
    }
    if (nsFilter) {
      filtered = filtered.filter((e) => e.namespace === nsFilter);
    }
    return filtered;
  }, [events, typeFilter, nsFilter]);

  const pagedEvents = useMemo(
    () => filteredEvents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredEvents, page],
  );

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));

  const namespaces = useMemo(
    () => [...new Set(events.map((e) => e.namespace))].filter(Boolean).sort(),
    [events],
  );

  return {
    events: pagedEvents,
    allEvents: filteredEvents,
    typeFilter,
    setTypeFilter,
    nsFilter,
    setNsFilter,
    page,
    setPage,
    totalPages,
    namespaces,
    loading,
    refresh,
  };
}
