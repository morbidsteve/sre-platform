import { apiFetch } from './client';
import type { HealthResponse, Alert, ServiceStatus } from '../types/api';

export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/health');
}

export function fetchAlerts(): Promise<Alert[]> {
  return apiFetch<Alert[]>('/api/alerts');
}

export function fetchServiceStatus(): Promise<ServiceStatus[]> {
  return apiFetch<ServiceStatus[]>('/api/status');
}

// ── Health Check Dashboard ──────────────────────────────────────────────────

export interface HealthCheck {
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export interface HealthChecksResponse {
  timestamp: string;
  summary: { total: number; pass: number; warn: number; fail: number };
  checks: HealthCheck[];
}

export function fetchHealthChecks(): Promise<HealthChecksResponse> {
  return apiFetch<HealthChecksResponse>('/api/health/checks');
}
