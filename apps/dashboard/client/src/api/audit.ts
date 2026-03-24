import { apiFetch } from './client';
import type { AuditEvent } from '../types/api';

export function fetchAuditEvents(): Promise<AuditEvent[]> {
  return apiFetch<AuditEvent[]>('/api/audit');
}
