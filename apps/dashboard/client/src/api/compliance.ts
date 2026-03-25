import { apiFetch } from './client';
import type { ComplianceScore, ComplianceControlsResponse } from '../types/api';

export function fetchComplianceScore(): Promise<ComplianceScore> {
  return apiFetch<ComplianceScore>('/api/compliance/score');
}

export function fetchComplianceControls(): Promise<ComplianceControlsResponse> {
  return apiFetch<ComplianceControlsResponse>('/api/compliance/controls');
}
