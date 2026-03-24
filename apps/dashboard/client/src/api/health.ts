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
