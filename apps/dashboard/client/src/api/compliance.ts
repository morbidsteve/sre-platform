import { apiFetch } from './client';
import type { ComplianceScore, ComplianceControlsResponse } from '../types/api';

export function fetchComplianceScore(): Promise<ComplianceScore> {
  return apiFetch<ComplianceScore>('/api/compliance/score');
}

export function fetchComplianceControls(): Promise<ComplianceControlsResponse> {
  return apiFetch<ComplianceControlsResponse>('/api/compliance/controls');
}

export interface ComplianceReportControl {
  control: string;
  family: string;
  description: string;
  status: 'PASS' | 'PARTIAL' | 'FAIL';
  evidence: string;
}

export interface ComplianceReport {
  title: string;
  scanDate: string;
  summary: { total: number; pass: number; partial: number; fail: number; compliancePercentage: number };
  controls: ComplianceReportControl[];
}

export function generateComplianceReport(): Promise<{ report: ComplianceReport }> {
  return apiFetch<{ report: ComplianceReport }>('/api/compliance/report');
}
